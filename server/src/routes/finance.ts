import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  expenseCreateSchema,
  expenseUpdateSchema,
  expenseListQuery,
  staffCreateSchema,
  staffUpdateSchema,
  staffListQuery,
  salaryPaymentCreateSchema,
  salaryPaymentUpdateSchema,
  salaryListQuery,
  type ExpenseListQuery,
  type StaffListQuery,
  type SalaryListQuery,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requireRole, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";
import { nextVoucherNo } from "../lib/docNo";
import { FILES_DIR } from "../lib/paths";
import { uploadStaffPhoto, uploadStaffSignature, photoContentType } from "../lib/upload";

// ---- Expenses (Admin, Accountant) ------------------------------------------
export const expensesRouter = Router();
expensesRouter.use(requireAuth, requirePermission("finance.manage"));

expensesRouter.post(
  "/",
  validateBody(expenseCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof expenseCreateSchema._output;
    const voucherNo = await nextVoucherNo();
    const expense = await prisma.expense.create({
      data: {
        voucherNo,
        categoryId: dto.categoryId,
        cost: dto.cost,
        quantity: dto.quantity,
        amount: dto.cost * dto.quantity,
        expenseDate: dto.expenseDate,
        payee: dto.payee,
        description: dto.description ?? null,
        receiptScanPath: dto.receiptScanPath ?? null,
        approvedById: actorStaffId(req),
      },
      include: { category: true },
    });
    res.status(201).json({ data: expense });
  })
);

// PATCH /expenses/:id — edit an entry (Admin only). amount is re-derived from
// the effective cost * quantity; a client-sent amount is never trusted.
expensesRouter.patch(
  "/:id",
  requireRole("Admin"),
  validateBody(expenseUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Expense not found");

    const dto = req.body as typeof expenseUpdateSchema._output;
    const cost = dto.cost ?? existing.cost;
    const quantity = dto.quantity ?? existing.quantity;
    const amount =
      cost !== null && quantity !== null ? cost * quantity : existing.amount;

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
        amount,
        ...(dto.expenseDate !== undefined ? { expenseDate: dto.expenseDate } : {}),
        ...(dto.payee !== undefined ? { payee: dto.payee } : {}),
        ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
        ...(dto.receiptScanPath !== undefined
          ? { receiptScanPath: dto.receiptScanPath ?? null }
          : {}),
      },
      include: { category: true },
    });
    res.json({ data: expense });
  })
);

// DELETE /expenses/:id — hard delete (Admin only). No model FKs onto Expense.
expensesRouter.delete(
  "/:id",
  requireRole("Admin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Expense not found");
    await prisma.expense.delete({ where: { id } });
    res.json({ data: { id } });
  })
);

expensesRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const period = req.query.period ? Number(req.query.period) : undefined;
    const where = period
      ? { expenseDate: { gte: new Date(period, 0, 1), lt: new Date(period + 1, 0, 1) } }
      : {};
    const grouped = await prisma.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const categories = await prisma.expenseCategory.findMany();
    const byName = new Map(categories.map((c) => [c.id, c.name]));
    res.json({
      data: grouped.map((g) => ({
        categoryId: g.categoryId,
        category: byName.get(g.categoryId) ?? String(g.categoryId),
        total: g._sum.amount ?? 0,
        count: g._count._all,
      })),
    });
  })
);

expensesRouter.get(
  "/",
  validateQuery(expenseListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as ExpenseListQuery;
    const where: Record<string, unknown> = {};
    if (q.category_id) where.categoryId = q.category_id;
    if (q.date_from || q.date_to) {
      where.expenseDate = {
        ...(q.date_from ? { gte: new Date(q.date_from) } : {}),
        ...(q.date_to ? { lte: new Date(q.date_to) } : {}),
      };
    }
    const orderBy = q.sortBy
      ? q.sortBy === "category"
        ? { category: { name: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { id: "desc" as const };
    const [items, total, agg] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { category: true },
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ _sum: { amount: true }, where }),
    ]);
    const totalAmount = agg._sum.amount ?? 0;
    res.json({ data: { items, total, page: q.page, limit: q.limit, totalAmount } });
  })
);

// ---- Staff (Admin, Accountant) ---------------------------------------------
export const staffRouter = Router();
staffRouter.use(requireAuth, requirePermission("finance.manage"));

staffRouter.get(
  "/",
  validateQuery(staffListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as StaffListQuery;
    const orderBy = q.sortBy
      ? { [q.sortBy]: q.sortOrder }
      : { fullName: "asc" as const };
    const [items, total] = await Promise.all([
      prisma.staff.findMany({
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.staff.count(),
    ]);
    res.json({ data: { items, total, page: q.page, limit: q.limit } });
  })
);

staffRouter.post(
  "/",
  requireRole("Admin"),
  validateBody(staffCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof staffCreateSchema._output;
    const staff = await prisma.staff.create({
      data: {
        fullName: dto.fullName,
        role: dto.role,
        baseSalary: dto.baseSalary,
        contactNo: dto.contactNo,
        whatsappNo: dto.whatsappNo,
      },
    });
    // Optionally provision an app login for this staff member. email is required
    // and unique on User; derive it from the username (same convention as seed).
    if (dto.username && dto.password && dto.appRole) {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      await prisma.user.create({
        data: {
          username: dto.username,
          passwordHash,
          email: `${dto.username}@makthab.local`,
          role: dto.appRole,
          staffId: staff.id,
        },
      });
    }
    res.status(201).json({ data: staff });
  })
);

// PATCH /staff/:id — edit profile fields (Admin + Accountant; broader than the
// Students page, which is Admin-only). Login provisioning is not edited here.
staffRouter.patch(
  "/:id",
  validateBody(staffUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Staff not found");
    const staff = await prisma.staff.update({ where: { id }, data: req.body });
    res.json({ data: staff });
  })
);

// DELETE /staff/:id — soft delete (status = inactive). Admin + Accountant.
// Deleting an already-inactive staff member is a deliberate idempotent no-op that
// still returns 200 with the same shape (not a 409): the confirm-then-delete
// UX never shows a delete action on an already-deleted row, so a repeat call
// (double-click, retry) should succeed quietly rather than surface an error.
staffRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Staff not found");
    await prisma.staff.update({ where: { id }, data: { status: "inactive" } });
    res.json({ data: { id, status: "inactive" } });
  })
);

// POST /staff/:id/photo — upload/replace the staff photo.
staffRouter.post(
  "/:id/photo",
  uploadStaffPhoto,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No photo uploaded (form field must be 'photo')");
    }
    const id = Number(req.params.id);
    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) {
      // Defensive: the upload middleware already 404s unknown ids before writing.
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Staff not found");
    }

    // Remove the previous photo file so we don't leave orphans on disk.
    if (existing.photoPath) {
      await fs.promises.rm(path.join(FILES_DIR, existing.photoPath), { force: true });
    }

    const photoPath = `photos/${req.file.filename}`;
    const staff = await prisma.staff.update({ where: { id }, data: { photoPath } });
    res.json({ data: staff });
  })
);

// GET /staff/:id/photo — stream the stored staff photo.
staffRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const staff = await prisma.staff.findUnique({
      where: { id },
      select: { photoPath: true },
    });
    if (!staff) throw new AppError(404, "not_found", "Staff not found");
    if (!staff.photoPath) throw new AppError(404, "not_found", "Staff has no photo");

    const abs = path.join(FILES_DIR, staff.photoPath);
    if (!fs.existsSync(abs)) throw new AppError(404, "not_found", "Photo file missing");

    res.setHeader("Content-Type", photoContentType(abs));
    const stream = fs.createReadStream(abs);
    stream.on("error", (err) => res.destroy(err));
    stream.pipe(res);
  })
);

// POST /staff/:id/signature — upload/replace the staff member's signature
// image (JPEG only — stamped onto fee receipts, see lib/pdf.ts).
staffRouter.post(
  "/:id/signature",
  uploadStaffSignature,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No signature uploaded (form field must be 'signature')");
    }
    const id = Number(req.params.id);
    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing) {
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Staff not found");
    }

    if (existing.signaturePath) {
      await fs.promises.rm(path.join(FILES_DIR, existing.signaturePath), { force: true });
    }

    const signaturePath = `photos/${req.file.filename}`;
    const staff = await prisma.staff.update({ where: { id }, data: { signaturePath } });
    res.json({ data: staff });
  })
);

// GET /staff/:id/signature — stream the stored signature image.
staffRouter.get(
  "/:id/signature",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const staff = await prisma.staff.findUnique({
      where: { id },
      select: { signaturePath: true },
    });
    if (!staff) throw new AppError(404, "not_found", "Staff not found");
    if (!staff.signaturePath) throw new AppError(404, "not_found", "Staff has no signature");

    const abs = path.join(FILES_DIR, staff.signaturePath);
    if (!fs.existsSync(abs)) throw new AppError(404, "not_found", "Signature file missing");

    res.setHeader("Content-Type", "image/jpeg");
    const stream = fs.createReadStream(abs);
    stream.on("error", (err) => res.destroy(err));
    stream.pipe(res);
  })
);

// ---- Salaries (Admin, Accountant) ------------------------------------------
export const salariesRouter = Router();
salariesRouter.use(requireAuth, requirePermission("finance.manage"));

salariesRouter.get(
  "/",
  validateQuery(salaryListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as SalaryListQuery;
    const where: Record<string, unknown> = {};
    if (q.month) where.salaryMonth = q.month;
    if (q.year) where.salaryYear = q.year;
    if (q.staff_id) where.staffId = q.staff_id;
    const orderBy = q.sortBy
      ? q.sortBy === "staff"
        ? { staff: { fullName: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { id: "desc" as const };
    const [items, total, agg] = await Promise.all([
      prisma.salaryPayment.findMany({
        where,
        include: { staff: true },
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.salaryPayment.count({ where }),
      prisma.salaryPayment.aggregate({ _sum: { netAmount: true }, where }),
    ]);
    const totalNet = agg._sum.netAmount ?? 0;
    res.json({ data: { items, total, page: q.page, limit: q.limit, totalNet } });
  })
);

// POST /salaries — record a single salary payment. netAmount is derived
// server-side as max(0, gross - deductions); a client-sent value is never trusted.
salariesRouter.post(
  "/",
  validateBody(salaryPaymentCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof salaryPaymentCreateSchema._output;
    const staff = await prisma.staff.findUnique({ where: { id: dto.staffId } });
    if (!staff) throw new AppError(404, "not_found", "Staff not found");

    // Pre-check the (staffId, month, year) uniqueness so we return a clean 409
    // rather than relying on the DB constraint to throw.
    const duplicate = await prisma.salaryPayment.findUnique({
      where: {
        staffId_salaryMonth_salaryYear: {
          staffId: dto.staffId,
          salaryMonth: dto.salaryMonth,
          salaryYear: dto.salaryYear,
        },
      },
    });
    if (duplicate) {
      throw new AppError(409, "duplicate", "A salary payment already exists for this staff/month/year");
    }

    const netAmount = Math.max(0, dto.grossAmount - dto.deductions);
    const payment = await prisma.salaryPayment.create({
      data: {
        staffId: dto.staffId,
        salaryMonth: dto.salaryMonth,
        salaryYear: dto.salaryYear,
        grossAmount: dto.grossAmount,
        deductions: dto.deductions,
        netAmount,
        paymentDate: dto.paymentDate,
      },
      include: { staff: true },
    });
    res.status(201).json({ data: payment });
  })
);

// PATCH /salaries/:id — edit an entry (Admin + Accountant). netAmount is
// re-derived from the effective gross/deductions; a client-sent net is ignored.
salariesRouter.patch(
  "/:id",
  validateBody(salaryPaymentUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.salaryPayment.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Salary payment not found");

    const dto = req.body as typeof salaryPaymentUpdateSchema._output;
    if (dto.staffId !== undefined) {
      const staff = await prisma.staff.findUnique({ where: { id: dto.staffId } });
      if (!staff) throw new AppError(404, "not_found", "Staff not found");
    }
    const grossAmount = dto.grossAmount ?? existing.grossAmount;
    const deductions = dto.deductions ?? existing.deductions;
    const netAmount = Math.max(0, grossAmount - deductions);

    const payment = await prisma.salaryPayment.update({
      where: { id },
      data: {
        ...(dto.staffId !== undefined ? { staffId: dto.staffId } : {}),
        ...(dto.salaryMonth !== undefined ? { salaryMonth: dto.salaryMonth } : {}),
        ...(dto.salaryYear !== undefined ? { salaryYear: dto.salaryYear } : {}),
        ...(dto.grossAmount !== undefined ? { grossAmount: dto.grossAmount } : {}),
        ...(dto.deductions !== undefined ? { deductions: dto.deductions } : {}),
        netAmount,
        ...(dto.paymentDate !== undefined ? { paymentDate: dto.paymentDate } : {}),
      },
      include: { staff: true },
    });
    res.json({ data: payment });
  })
);

// DELETE /salaries/:id — hard delete (Admin + Accountant). No model FKs onto it.
salariesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.salaryPayment.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Salary payment not found");
    await prisma.salaryPayment.delete({ where: { id } });
    res.json({ data: { id } });
  })
);
