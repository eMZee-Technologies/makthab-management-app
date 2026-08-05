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
import { expenseRepository, expenseCategoryRepository, staffRepository, userRepository, salaryPaymentRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requireResourcePermission, requireResourceAny, requireModuleAccessOrReportsView, requireResourceReadOrMutate } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";
import { nextVoucherNo } from "../lib/docNo";
import {
  uploadStaffPhoto,
  uploadStaffSignature,
  photoContentType,
  staffPhotoKey,
  staffSignatureKey,
  saveUploadedFile,
  deleteStoredFile,
} from "../lib/upload";
import { streamStoredFile } from "../lib/storage";
// ---- Expenses (Admin, Accountant) ------------------------------------------
export const expensesRouter = Router();
// Reads also allow reports.view — Reports expense tab lists via /expenses.
expensesRouter.use(requireAuth, requireModuleAccessOrReportsView("finance"));

expensesRouter.post(
  "/",
  requireResourcePermission("finance", "create"),
  validateBody(expenseCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof expenseCreateSchema._output;
    const voucherNo = await nextVoucherNo();
    const expense = await expenseRepository.create({
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
    });
    res.status(201).json({ data: expense });
  })
);

// PATCH /expenses/:id — edit an entry (requires finance.update).
expensesRouter.patch(
  "/:id",
  requireResourcePermission("finance", "update"),
  validateBody(expenseUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await expenseRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Expense not found");

    const dto = req.body as typeof expenseUpdateSchema._output;
    const cost = dto.cost ?? existing.cost;
    const quantity = dto.quantity ?? existing.quantity;
    const amount =
      cost !== null && quantity !== null ? cost * quantity : existing.amount;

    const expense = await expenseRepository.update(id, {
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
    });
    res.json({ data: expense });
  })
);

// DELETE /expenses/:id — hard delete (requires finance.delete).
expensesRouter.delete(
  "/:id",
  requireResourcePermission("finance", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await expenseRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Expense not found");
    await expenseRepository.delete(id);
    res.json({ data: { id } });
  })
);

expensesRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const period = req.query.period ? Number(req.query.period) : undefined;
    const grouped = await expenseRepository.summaryByCategory(period);
    const categories = await expenseCategoryRepository.findAll();
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
    const { items, total, totalAmount } = await expenseRepository.list(q);
    res.json({ data: { items, total, page: q.page, limit: q.limit, totalAmount } });
  })
);

// ---- Staff (Admin, Accountant) ---------------------------------------------
export const staffRouter = Router();
staffRouter.use(requireAuth, requireResourceReadOrMutate("finance"));

staffRouter.get(
  "/",
  validateQuery(staffListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as StaffListQuery;
    const { items, total } = await staffRepository.list(q);
    res.json({ data: { items, total, page: q.page, limit: q.limit } });
  })
);

staffRouter.post(
  "/",
  requireResourcePermission("finance", "create"),
  validateBody(staffCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof staffCreateSchema._output;
    const staff = await staffRepository.create({
      fullName: dto.fullName,
      role: dto.role,
      baseSalary: dto.baseSalary,
      contactNo: dto.contactNo,
      whatsappNo: dto.whatsappNo,
    });
    // Optionally provision an app login for this staff member. email is required
    // and unique on User; derive it from the username (same convention as seed).
    if (dto.username && dto.password && dto.appRole) {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      await userRepository.create({
        username: dto.username,
        passwordHash,
        email: `${dto.username}@makthab.local`,
        role: dto.appRole,
        staffId: staff.id,
      });
    }
    res.status(201).json({ data: staff });
  })
);

// PATCH /staff/:id — edit profile fields (Admin + Accountant; broader than the
// Students page, which is Admin-only). Login provisioning is not edited here.
staffRouter.patch(
  "/:id",
  requireResourcePermission("finance", "update"),
  validateBody(staffUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await staffRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Staff not found");
    const staff = await staffRepository.update(id, req.body);
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
  requireResourcePermission("finance", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await staffRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Staff not found");
    await staffRepository.softDelete(id);
    res.json({ data: { id, status: "inactive" } });
  })
);

// POST /staff/:id/photo — upload/replace the staff photo.
staffRouter.post(
  "/:id/photo",
  requireResourcePermission("finance", "update"),
  uploadStaffPhoto,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No photo uploaded (form field must be 'photo')");
    }
    const id = Number(req.params.id);
    const existing = await staffRepository.findById(id);
    if (!existing) {
      throw new AppError(404, "not_found", "Staff not found");
    }

    await deleteStoredFile(existing.photoPath);

    const photoPath = await saveUploadedFile(staffPhotoKey(existing.id, req.file), req.file);
    const staff = await staffRepository.updatePhoto(id, photoPath);
    res.json({ data: staff });
  })
);

// GET /staff/:id/photo — stream the stored staff photo.
staffRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const staff = await staffRepository.findPhotoPath(id);
    if (!staff) throw new AppError(404, "not_found", "Staff not found");
    if (!staff.photoPath) throw new AppError(404, "not_found", "Staff has no photo");

    await streamStoredFile(
      res,
      staff.photoPath,
      photoContentType(staff.photoPath),
      "Photo file missing"
    );
  })
);

// POST /staff/:id/signature — upload/replace the staff member's signature
// image (JPEG only — stamped onto fee receipts, see lib/pdf.ts).
staffRouter.post(
  "/:id/signature",
  requireResourcePermission("finance", "update"),
  uploadStaffSignature,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No signature uploaded (form field must be 'signature')");
    }
    const id = Number(req.params.id);
    const existing = await staffRepository.findById(id);
    if (!existing) {
      throw new AppError(404, "not_found", "Staff not found");
    }

    await deleteStoredFile(existing.signaturePath);

    const signaturePath = await saveUploadedFile(staffSignatureKey(existing.id, req.file), req.file);
    const staff = await staffRepository.updateSignature(id, signaturePath);
    res.json({ data: staff });
  })
);

// GET /staff/:id/signature — stream the stored signature image.
staffRouter.get(
  "/:id/signature",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const staff = await staffRepository.findSignaturePath(id);
    if (!staff) throw new AppError(404, "not_found", "Staff not found");
    if (!staff.signaturePath) throw new AppError(404, "not_found", "Staff has no signature");

    await streamStoredFile(res, staff.signaturePath, "image/jpeg", "Signature file missing");
  })
);

// ---- Salaries (Admin, Accountant) ------------------------------------------
export const salariesRouter = Router();
// Reads also allow reports.view — Reports salaries tab lists via /salaries.
salariesRouter.use(requireAuth, requireModuleAccessOrReportsView("finance"));

salariesRouter.get(
  "/",
  validateQuery(salaryListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as SalaryListQuery;
    const { items, total, totalNet } = await salaryPaymentRepository.list(q);
    res.json({ data: { items, total, page: q.page, limit: q.limit, totalNet } });
  })
);

// POST /salaries — record a single salary payment. netAmount is derived
// server-side as max(0, gross - deductions); a client-sent value is never trusted.
salariesRouter.post(
  "/",
  requireResourcePermission("finance", "create"),
  validateBody(salaryPaymentCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof salaryPaymentCreateSchema._output;
    const staff = await staffRepository.findById(dto.staffId);
    if (!staff) throw new AppError(404, "not_found", "Staff not found");

    // Pre-check the (staffId, month, year) uniqueness so we return a clean 409
    // rather than relying on the DB constraint to throw.
    const duplicate = await salaryPaymentRepository.findDuplicate(dto.staffId, dto.salaryMonth, dto.salaryYear);
    if (duplicate) {
      throw new AppError(409, "duplicate", "A salary payment already exists for this staff/month/year");
    }

    const netAmount = Math.max(0, dto.grossAmount - dto.deductions);
    const payment = await salaryPaymentRepository.create({
      staffId: dto.staffId,
      salaryMonth: dto.salaryMonth,
      salaryYear: dto.salaryYear,
      grossAmount: dto.grossAmount,
      deductions: dto.deductions,
      netAmount,
      paymentDate: dto.paymentDate,
    });
    res.status(201).json({ data: payment });
  })
);

// PATCH /salaries/:id — edit an entry (Admin + Accountant). netAmount is
// re-derived from the effective gross/deductions; a client-sent net is ignored.
salariesRouter.patch(
  "/:id",
  requireResourcePermission("finance", "update"),
  validateBody(salaryPaymentUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await salaryPaymentRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Salary payment not found");

    const dto = req.body as typeof salaryPaymentUpdateSchema._output;
    if (dto.staffId !== undefined) {
      const staff = await staffRepository.findById(dto.staffId);
      if (!staff) throw new AppError(404, "not_found", "Staff not found");
    }

    // Same (staffId, month, year) pre-check as POST, so a colliding edit
    // returns a clean 409 rather than an uncaught Prisma unique-constraint
    // error. Only needed when one of the three actually changes.
    const staffId = dto.staffId ?? existing.staffId;
    const salaryMonth = dto.salaryMonth ?? existing.salaryMonth;
    const salaryYear = dto.salaryYear ?? existing.salaryYear;
    if (
      staffId !== existing.staffId ||
      salaryMonth !== existing.salaryMonth ||
      salaryYear !== existing.salaryYear
    ) {
      const duplicate = await salaryPaymentRepository.findDuplicate(staffId, salaryMonth, salaryYear);
      if (duplicate && duplicate.id !== id) {
        throw new AppError(409, "duplicate", "A salary payment already exists for this staff/month/year");
      }
    }

    const grossAmount = dto.grossAmount ?? existing.grossAmount;
    const deductions = dto.deductions ?? existing.deductions;
    const netAmount = Math.max(0, grossAmount - deductions);

    const payment = await salaryPaymentRepository.update(id, {
      ...(dto.staffId !== undefined ? { staffId: dto.staffId } : {}),
      ...(dto.salaryMonth !== undefined ? { salaryMonth: dto.salaryMonth } : {}),
      ...(dto.salaryYear !== undefined ? { salaryYear: dto.salaryYear } : {}),
      ...(dto.grossAmount !== undefined ? { grossAmount: dto.grossAmount } : {}),
      ...(dto.deductions !== undefined ? { deductions: dto.deductions } : {}),
      netAmount,
      ...(dto.paymentDate !== undefined ? { paymentDate: dto.paymentDate } : {}),
    });
    res.json({ data: payment });
  })
);

// DELETE /salaries/:id — hard delete (Admin + Accountant). No model FKs onto it.
salariesRouter.delete(
  "/:id",
  requireResourcePermission("finance", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await salaryPaymentRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Salary payment not found");
    await salaryPaymentRepository.delete(id);
    res.json({ data: { id } });
  })
);
