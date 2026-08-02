import fs from "node:fs";
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
import { requireAuth, requireRole, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";
import { nextVoucherNo } from "../lib/docNo";
import { resolveUnderFilesDir } from "../lib/paths";
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

// PATCH /expenses/:id — edit an entry (Admin only). amount is re-derived from
// the effective cost * quantity; a client-sent amount is never trusted.
expensesRouter.patch(
  "/:id",
  requireRole("Admin"),
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

// DELETE /expenses/:id — hard delete (Admin only). No model FKs onto Expense.
expensesRouter.delete(
  "/:id",
  requireRole("Admin"),
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
staffRouter.use(requireAuth, requirePermission("finance.manage"));

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
  requireRole("Admin"),
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
  uploadStaffPhoto,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, "no_file", "No photo uploaded (form field must be 'photo')");
    }
    const id = Number(req.params.id);
    const existing = await staffRepository.findById(id);
    if (!existing) {
      // Defensive: the upload middleware already 404s unknown ids before writing.
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Staff not found");
    }

    // Remove the previous photo file so we don't leave orphans on disk.
    if (existing.photoPath) {
      try {
        await fs.promises.rm(resolveUnderFilesDir(existing.photoPath), { force: true });
      } catch {
        /* ignore invalid stored paths */
      }
    }

    const photoPath = `photos/${req.file.filename}`;
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

    let abs: string;
    try {
      abs = resolveUnderFilesDir(staff.photoPath);
    } catch {
      throw new AppError(404, "not_found", "Photo file missing");
    }
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
    const existing = await staffRepository.findById(id);
    if (!existing) {
      await fs.promises.rm(req.file.path, { force: true });
      throw new AppError(404, "not_found", "Staff not found");
    }

    if (existing.signaturePath) {
      try {
        await fs.promises.rm(resolveUnderFilesDir(existing.signaturePath), { force: true });
      } catch {
        /* ignore */
      }
    }

    const signaturePath = `photos/${req.file.filename}`;
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

    let abs: string;
    try {
      abs = resolveUnderFilesDir(staff.signaturePath);
    } catch {
      throw new AppError(404, "not_found", "Signature file missing");
    }
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
    const { items, total, totalNet } = await salaryPaymentRepository.list(q);
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
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await salaryPaymentRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Salary payment not found");
    await salaryPaymentRepository.delete(id);
    res.json({ data: { id } });
  })
);
