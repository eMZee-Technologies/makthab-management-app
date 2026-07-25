import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import {
  studentCreateSchema,
  studentUpdateSchema,
  studentListQuery,
  type StudentListQuery,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { renderPdf } from "../lib/pdf";
import { getOrgHeader } from "../lib/orgProfile";
import { FILES_DIR } from "../lib/paths";
import { uploadStudentPhoto, photoContentType } from "../lib/upload";

export const studentsRouter = Router();

studentsRouter.use(requireAuth);

// A category is only valid for a student if their class actually offers it;
// it's required once the class offers 1+ categories (so classes that don't
// use categories at all need no extra data entry), and rejected outright for
// classes that offer none.
async function validateCategoryForClass(classId: number, categoryId: number | null | undefined) {
  const cls = await prisma.class.findUnique({ where: { id: classId }, include: { categories: true } });
  if (!cls) throw new AppError(400, "invalid_class", "Class not found");
  if (cls.categories.length > 0) {
    if (categoryId == null) {
      throw new AppError(400, "category_required", `Class ${cls.name} requires a category`);
    }
    if (!cls.categories.some((c) => c.id === categoryId)) {
      throw new AppError(400, "invalid_category", `Category is not offered by class ${cls.name}`);
    }
  } else if (categoryId != null) {
    throw new AppError(400, "invalid_category", `Class ${cls.name} does not offer categories`);
  }
}

// GET /students — paginated list with q / class_id / status filters.
studentsRouter.get(
  "/",
  validateQuery(studentListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as StudentListQuery;
    const where: Record<string, unknown> = {};
    if (q.class_id) where.classId = q.class_id;
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { fullName: { contains: q.q } },
        { admissionNo: { contains: q.q } },
        { fatherName: { contains: q.q } },
      ];
    }
    const orderBy = q.sortBy
      ? q.sortBy === "class"
        ? { class: { name: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { admissionNo: "asc" as const };
    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          class: true,
          category: true,
          academicYear: true,
          feePayments: {
            where: { feeType: "admission" },
            orderBy: { paymentDate: "asc" },
            take: 1,
          },
        },
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.student.count({ where }),
    ]);
    const items = rows.map(({ feePayments, ...student }) => ({
      ...student,
      admissionDate: feePayments[0]?.paymentDate ?? null,
    }));
    res.json({ data: { items, total, page: q.page, limit: q.limit } });
  })
);

// POST /students — admit a student (Admin only; §6 roles).
studentsRouter.post(
  "/",
  requirePermission("students.manage"),
  validateBody(studentCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof studentCreateSchema._output;
    const exists = await prisma.student.findUnique({ where: { admissionNo: dto.admissionNo } });
    if (exists) throw new AppError(409, "duplicate", `Admission number ${dto.admissionNo} already exists`);
    await validateCategoryForClass(dto.classId, dto.categoryId);
    const student = await prisma.student.create({
      data: {
        admissionNo: dto.admissionNo,
        fullName: dto.fullName,
        fatherName: dto.fatherName,
        dateOfBirth: dto.dateOfBirth ?? null,
        gender: dto.gender,
        contactNo: dto.contactNo,
        whatsappNo: dto.whatsappNo,
        address: dto.address ?? null,
        classId: dto.classId,
        categoryId: dto.categoryId ?? null,
        academicYearId: dto.academicYearId,
        photoPath: dto.photoPath ?? null,
        notes: dto.notes ?? null,
        status: dto.status ?? "active",
      },
      include: { class: true, category: true, academicYear: true },
    });
    res.status(201).json({ data: student });
  })
);

// GET /students/:id — profile + fee summary + attendance stats (§6.1).
studentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await prisma.student.findUnique({
      where: { id },
      include: { class: true, category: true, academicYear: true },
    });
    if (!student) throw new AppError(404, "not_found", "Student not found");

    const fees = await prisma.feePayment.findMany({ where: { studentId: id } });
    const attendance = await prisma.attendance.groupBy({
      by: ["status"],
      where: { studentId: id },
      _count: { _all: true },
    });
    const attCounts = Object.fromEntries(attendance.map((a) => [a.status, a._count._all]));
    const totalMarked = attendance.reduce((s, a) => s + a._count._all, 0);
    const present = (attCounts.present ?? 0) + (attCounts.late ?? 0);

    res.json({
      data: {
        ...student,
        feeSummary: {
          totalPaid: fees.reduce((s, f) => s + f.amountPaid, 0),
          totalDue: fees.reduce((s, f) => s + f.amountDue, 0),
          payments: fees.length,
        },
        attendanceStats: {
          totalMarked,
          present: attCounts.present ?? 0,
          absent: attCounts.absent ?? 0,
          late: attCounts.late ?? 0,
          leave: attCounts.leave ?? 0,
          percentage: totalMarked ? Math.round((present / totalMarked) * 100) : 0,
        },
      },
    });
  })
);

// PATCH /students/:id — update fields (Admin only).
studentsRouter.patch(
  "/:id",
  requirePermission("students.manage"),
  validateBody(studentUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.student.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Student not found");
    const dto = req.body as typeof studentUpdateSchema._output;
    const effectiveClassId = dto.classId ?? exists.classId;
    const effectiveCategoryId = "categoryId" in dto ? dto.categoryId : exists.categoryId;
    await validateCategoryForClass(effectiveClassId, effectiveCategoryId);
    const student = await prisma.student.update({
      where: { id },
      data: dto,
      include: { class: true, category: true, academicYear: true },
    });
    res.json({ data: student });
  })
);

// DELETE /students/:id — soft delete (status = inactive). Admin only.
// Deleting an already-inactive student is a deliberate idempotent no-op that
// still returns 200 with the same shape (not a 409): the confirm-then-delete
// UX never shows a delete action on an already-deleted row, so a repeat call
// (double-click, retry) should succeed quietly rather than surface an error.
studentsRouter.delete(
  "/:id",
  requirePermission("students.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.student.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Student not found");
    await prisma.student.update({ where: { id }, data: { status: "inactive" } });
    res.json({ data: { id, status: "inactive" } });
  })
);

// GET /students/:id/receipt — admission letter PDF.
studentsRouter.get(
  "/:id/receipt",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await prisma.student.findUnique({
      where: { id },
      include: { class: true, academicYear: true },
    });
    if (!student) throw new AppError(404, "not_found", "Student not found");

    const pdf = renderPdf({
      org: await getOrgHeader(),
      title: "Admission Letter",
      lines: [
        ["Admission No", student.admissionNo],
        ["Name", student.fullName],
        ["Father's Name", student.fatherName],
        ["Class", student.class?.name ?? "-"],
        ["Academic Year", student.academicYear?.name ?? "-"],
        ["Gender", student.gender],
        ["Contact", student.contactNo],
        ["Status", student.status],
        "",
        "This letter confirms the admission of the above student.",
      ],
      footer: "Generated by Makthab",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="admission-${student.admissionNo}.pdf"`);
    res.end(pdf);
  })
);

// POST /students/:id/photo — upload/replace the student photo (Admin only).
studentsRouter.post(
  "/:id/photo",
  requirePermission("students.manage"),
  uploadStudentPhoto,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No photo uploaded (form field must be 'photo')");
    }
    const id = Number(req.params.id);
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) {
      // Defensive: the upload middleware already 404s unknown ids before writing.
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Student not found");
    }

    // Remove the previous photo file so we don't leave orphans on disk.
    if (existing.photoPath) {
      await fs.promises.rm(path.join(FILES_DIR, existing.photoPath), { force: true });
    }

    const photoPath = `photos/${req.file.filename}`;
    const student = await prisma.student.update({
      where: { id },
      data: { photoPath },
      include: { class: true, category: true, academicYear: true },
    });
    res.json({ data: student });
  })
);

// GET /students/:id/photo — stream the stored student photo.
studentsRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const student = await prisma.student.findUnique({
      where: { id },
      select: { photoPath: true },
    });
    if (!student) throw new AppError(404, "not_found", "Student not found");
    if (!student.photoPath) throw new AppError(404, "not_found", "Student has no photo");

    const abs = path.join(FILES_DIR, student.photoPath);
    if (!fs.existsSync(abs)) throw new AppError(404, "not_found", "Photo file missing");

    res.setHeader("Content-Type", photoContentType(abs));
    const stream = fs.createReadStream(abs);
    stream.on("error", (err) => res.destroy(err));
    stream.pipe(res);
  })
);
