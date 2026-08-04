import { Router } from "express";
import {
  feePaymentCreateSchema,
  feePaymentUpdateSchema,
  feeListQuery,
  defaultersQuery,
  defaulterUpdateSchema,
  feeStructureCreateSchema,
  type FeeListQuery,
  type DefaultersQuery,
} from "@makthab/shared";
import { feePaymentRepository, studentRepository, feeStructureRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requireModuleAccessOrReportsView, requireResourcePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";
import { nextReceiptNo } from "../lib/docNo";
import { renderReceiptPdf, parseJpegInfo, type EmbeddedImage } from "../lib/pdf";
import { getOrgHeader } from "../lib/orgProfile";
import { MONTH_NAMES, MONTH_ABBR } from "../lib/monthNames";
import { buildWhatsAppLink, sendWhatsAppDocumentViaBusinessApi } from "../lib/whatsapp";
import { env } from "../lib/env";
import { getStorage, readStoredFile, normalizeStoredKey } from "../lib/storage";
import { logger } from "../lib/logger";
import { recordAuditFromRequest } from "../lib/audit/auditLog";
export const feesRouter = Router();

// Reads also allow reports.view — Reports page tables call /fees list APIs.
feesRouter.use(requireAuth, requireModuleAccessOrReportsView("fees"));

type FeeWithStudent = Awaited<ReturnType<typeof loadFee>>;
async function loadFee(id: number) {
  return feePaymentRepository.findByIdWithStudentAndCollector(id);
}

// Load the collecting staff member's uploaded signature (if any) as an
// EmbeddedImage ready for the PDF writer. Signatures are JPEG-only (see
// upload.ts) so parseJpegInfo always applies here.
async function loadSignatureImage(signaturePath: string | null): Promise<EmbeddedImage | undefined> {
  if (!signaturePath) return undefined;
  const bytes = await readStoredFile(signaturePath);
  if (!bytes) return undefined;
  try {
    const info = parseJpegInfo(bytes);
    return { bytes, width: info.width, height: info.height, numComponents: info.numComponents };
  } catch {
    // Corrupt/unreadable signature file — fall back to the text-only
    // "Name (Role)" line rather than failing receipt generation entirely.
    return undefined;
  }
}

// "monthly" -> "Monthly Fee", "admission" -> "Admission Fee", etc.
function feeTypeLabel(feeType: string): string {
  return `${feeType.charAt(0).toUpperCase()}${feeType.slice(1)} Fee`;
}

// "July 2026" for a monthly fee; just the year ("2024") when there's no month
// (admission/annual/other fees aren't tied to a specific month).
function periodLabel(feeMonth: number | null, feeYear: number): string {
  return feeMonth ? `${MONTH_NAMES[feeMonth - 1]} ${feeYear}` : String(feeYear);
}

function formatReceiptDate(d: Date | string): string {
  const date = new Date(d);
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTH_ABBR[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

// The period clause of the WhatsApp caption, branched by fee type:
//   monthly   -> "for Period of June 2026"
//   admission -> "for Admission Year 2024"
//   annual/other/anything else -> "for Annual Fee 2026" (a coherent
//     type-labelled fallback the user didn't specify a wording for).
function captionPeriodClause(feeType: string, feeMonth: number | null, feeYear: number): string {
  if (feeType === "monthly") return `for Period of ${periodLabel(feeMonth, feeYear)}`;
  if (feeType === "admission") return `for Admission Year ${feeYear}`;
  return `for ${feeTypeLabel(feeType)} ${feeYear}`;
}

async function receiptPdf(fee: NonNullable<FeeWithStudent>): Promise<Buffer> {
  return renderReceiptPdf({
    org: await getOrgHeader(),
    receiptNo: fee.receiptNo,
    date: formatReceiptDate(fee.paymentDate),
    studentName: fee.student?.fullName ?? "-",
    admissionNo: fee.student?.admissionNo ?? "-",
    feeType: feeTypeLabel(fee.feeType),
    period: periodLabel(fee.feeMonth, fee.feeYear),
    amountPaid: fee.amountPaid,
    signature: fee.collectedBy
      ? {
        image: await loadSignatureImage(fee.collectedBy.signaturePath),
        staffName: fee.collectedBy.fullName,
        staffRole: fee.collectedBy.role,
      }
      : undefined,
  });
}

async function saveReceiptPdf(receiptNo: string, pdf: Buffer): Promise<string> {
  const key = `receipts/${receiptNo}.pdf`;
  try {
    await getStorage().save(key, pdf, { contentType: "application/pdf" });
    return key;
  } catch (err) {
    logger.error(`failed to store receipt ${key}: ${(err as Error).message}`);
    throw new AppError(500, "storage_error", "Failed to store receipt PDF");
  }
}

async function loadReceiptPdf(fee: NonNullable<FeeWithStudent>): Promise<Buffer> {
  if (fee.pdfPath) {
    const stored = await readStoredFile(fee.pdfPath);
    if (stored) return stored;
  }
  return receiptPdf(fee);
}

async function deleteReceiptPdf(pdfPath: string | null): Promise<void> {
  if (!pdfPath) return;
  try {
    const key = normalizeStoredKey(pdfPath);
    await getStorage().delete(key);
  } catch (err) {
    logger.debug(`receipt delete skipped for ${pdfPath}: ${(err as Error).message}`);
  }
}

// POST /fees — record a payment and generate the receipt PDF.
feesRouter.post(
  "/",
  requireResourcePermission("fees", "create"),
  validateBody(feePaymentCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof feePaymentCreateSchema._output;
    const student = await studentRepository.findById(dto.studentId);
    if (!student) throw new AppError(404, "not_found", "Student not found");

    const receiptNo = await nextReceiptNo({
      feeType: dto.feeType,
      admissionNo: student.admissionNo,
      feeYear: dto.feeYear,
      feeMonth: dto.feeMonth,
    });
    const created = await feePaymentRepository.create({
      receiptNo,
      studentId: dto.studentId,
      feeType: dto.feeType,
      feeMonth: dto.feeMonth ?? null,
      feeYear: dto.feeYear,
      amountDue: dto.amountDue,
      amountPaid: dto.amountPaid,
      paymentDate: dto.paymentDate,
      paymentMethod: dto.paymentMethod,
      waiverAmount: dto.waiverAmount ?? 0,
      collectedById: actorStaffId(req),
    });

    const pdfPath = await saveReceiptPdf(receiptNo, await receiptPdf(created));
    const fee = await feePaymentRepository.setPdfPath(created.id, pdfPath);

    await recordAuditFromRequest(req, {
      action: "create",
      entity: "fee",
      resourceId: fee.id,
      outcome: "success",
      additionalDetails: {
        receiptNo,
        studentId: dto.studentId,
        feeType: dto.feeType,
        amountPaid: dto.amountPaid,
      },
    });

    res.status(201).json({ data: fee });
  })
);

// A defaulter row: a student's outstanding monthly amount, where amountDue is
// the manual override (arrears) if set, else the class/category/year fee-structure amount.
type StudentWithClass = { id: number; fullName: string; admissionNo: string; classId: number; categoryId: number | null; academicYearId: number; whatsappNo: string; feeOverrideAmount: number | null; class: { name: string } | null };
function defaulterRow(s: StudentWithClass, structAmount: number) {
  return {
    studentId: s.id,
    fullName: s.fullName,
    admissionNo: s.admissionNo,
    className: s.class?.name,
    amountDue: s.feeOverrideAmount ?? structAmount,
    whatsappNo: s.whatsappNo,
  };
}

// GET /fees/defaulters — active students with no monthly payment for month/year,
// sorted + paginated server-side (default admissionNo asc).
feesRouter.get(
  "/defaulters",
  validateQuery(defaultersQuery),
  asyncHandler(async (_req, res) => {
    const { month, year, page, limit, sortBy, sortOrder } = res.locals.query as DefaultersQuery;
    const students = await studentRepository.findActiveWithClass();
    const paidSet = await feePaymentRepository.studentIdsPaidForPeriod("monthly", month, year);
    const structures = await feeStructureRepository.findByTypeWithYear("monthly");
    // Resolve a class(+category)'s monthly fee. Prefer an exact
    // classId+categoryId+academicYearId match, but a class's FeeStructure is
    // often configured under an older academic year than the student's
    // current one; an exact-only lookup silently returned 0 in that case even
    // though an amount genuinely exists. So fall back to that class+category's
    // structure with the latest academicYear.startDate; if there's no
    // category-specific structure at all, fall back again to the class-wide
    // (categoryId: null) structure the same way, and only return 0 when
    // neither exists in any year.
    const pickAmount = (classId: number, categoryId: number | null, yearId: number) => {
      const rows = structures.filter((s) => s.classId === classId && s.categoryId === categoryId);
      if (rows.length === 0) return null;
      const exact = rows.find((s) => s.academicYearId === yearId);
      if (exact) return exact.amount;
      return rows.reduce((a, b) => (a.academicYear.startDate >= b.academicYear.startDate ? a : b)).amount;
    };
    const structFor = (classId: number, categoryId: number | null, yearId: number) =>
      pickAmount(classId, categoryId, yearId) ??
      (categoryId != null ? pickAmount(classId, null, yearId) : null) ??
      0;

    const rows = students
      .filter((s) => !paidSet.has(s.id))
      .map((s) => defaulterRow(s, structFor(s.classId, s.categoryId, s.academicYearId)));

    const dir = sortOrder === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      if (sortBy === "amountDue") return (a.amountDue - b.amountDue) * dir;
      const av = String(a[sortBy] ?? "");
      const bv = String(b[sortBy] ?? "");
      return av.localeCompare(bv, undefined, { numeric: true }) * dir;
    });

    const total = rows.length;
    const skip = (page - 1) * limit;
    const items = rows.slice(skip, skip + limit);
    res.json({ data: { items, total, page, limit } });
  })
);

// PATCH /fees/defaulters/:studentId — override a student's amount due (arrears)
// by persisting feeOverrideAmount; returns the recomputed defaulter row.
feesRouter.patch(
  "/defaulters/:studentId",
  requireResourcePermission("fees", "update"),
  validateBody(defaulterUpdateSchema),
  asyncHandler(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const existing = await studentRepository.findById(studentId);
    if (!existing) throw new AppError(404, "not_found", "Student not found");

    const dto = req.body as typeof defaulterUpdateSchema._output;
    const student = await studentRepository.updateFeeOverride(studentId, dto.amountDue);
    // The override takes precedence, so the row's amountDue echoes what was set.
    res.json({ data: defaulterRow(student, 0) });
  })
);

// GET /fees/structures — list; POST /fees/structures — upsert.
feesRouter.get(
  "/structures",
  asyncHandler(async (_req, res) => {
    const items = await feeStructureRepository.findAll();
    res.json({ data: items });
  })
);

feesRouter.post(
  "/structures",
  requireResourcePermission("fees", "create"),
  validateBody(feeStructureCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof feeStructureCreateSchema._output;
    // Prisma's generated compound-unique key type doesn't accept null for a
    // nullable field (categoryId), so upsert-by-compound-key isn't usable here
    // — look the row up as a plain filter (which does accept null) instead.
    const categoryId = dto.categoryId ?? null;
    const existing = await feeStructureRepository.findMatch(dto.classId, categoryId, dto.academicYearId, dto.feeType);
    const item = existing
      ? await feeStructureRepository.updateAmount(existing.id, dto.amount)
      : await feeStructureRepository.create({ ...dto, categoryId });
    res.status(201).json({ data: item });
  })
);

// DELETE /fees/structures/:id — remove a fee structure entry (Admin + Accountant).
feesRouter.delete(
  "/structures/:id",
  requireResourcePermission("fees", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await feeStructureRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Fee structure not found");
    await feeStructureRepository.delete(id);
    res.json({ data: { id } });
  })
);

// GET /fees — list with student_id / month / year / status filters.
feesRouter.get(
  "/",
  validateQuery(feeListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as FeeListQuery;
    const { items, total, totalPaid } = await feePaymentRepository.list(q);
    res.json({ data: { items, total, page: q.page, limit: q.limit, totalPaid } });
  })
);

// GET /fees/:id — one payment record.
feesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const fee = await loadFee(Number(req.params.id));
    if (!fee) throw new AppError(404, "not_found", "Payment not found");
    res.json({ data: fee });
  })
);

// PATCH /fees/:id — edit a payment (Admin + Accountant). receiptNo is immutable
// (it's not part of the update schema, so there's no way to change it here).
feesRouter.patch(
  "/:id",
  requireResourcePermission("fees", "update"),
  validateBody(feePaymentUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await feePaymentRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Payment not found");

    const dto = req.body as typeof feePaymentUpdateSchema._output;
    if (dto.studentId !== undefined) {
      const student = await studentRepository.findById(dto.studentId);
      if (!student) throw new AppError(404, "not_found", "Student not found");
    }

    // Prisma skips `undefined` fields, so only the keys the client sent are
    // written; feeMonth can be set to null to clear a monthly period.
    const fee = await feePaymentRepository.edit(id, {
      studentId: dto.studentId,
      feeType: dto.feeType,
      feeMonth: dto.feeMonth,
      feeYear: dto.feeYear,
      amountDue: dto.amountDue,
      amountPaid: dto.amountPaid,
      paymentDate: dto.paymentDate,
      paymentMethod: dto.paymentMethod,
      waiverAmount: dto.waiverAmount,
    });
    res.json({ data: fee });
  })
);

// DELETE /fees/:id — hard-delete a payment (Admin + Accountant) and best-effort
// remove its receipt PDF from disk.
feesRouter.delete(
  "/:id",
  requireResourcePermission("fees", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const fee = await feePaymentRepository.findById(id);
    if (!fee) throw new AppError(404, "not_found", "Payment not found");

    await feePaymentRepository.delete(id);
    await deleteReceiptPdf(fee.pdfPath);
    res.json({ data: { id } });
  })
);

// GET /fees/:id/receipt — stream the receipt PDF.
feesRouter.get(
  "/:id/receipt",
  asyncHandler(async (req, res) => {
    const fee = await loadFee(Number(req.params.id));
    if (!fee) throw new AppError(404, "not_found", "Payment not found");
    const pdf = await loadReceiptPdf(fee);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fee.receiptNo}.pdf"`);
    res.end(pdf);
  })
);

// POST /fees/:id/whatsapp — send the receipt to the student's registered
// WhatsApp number and mark it sent. Idempotent-guarded (not idempotent-quiet
// like the soft-delete endpoints elsewhere): a repeat call is a genuine user
// mistake (double-click, forgot they already sent it), so it 409s with a
// clear message instead of silently re-sending.
//
// Two gateways, switched by WHATSAPP_GATEWAY (see lib/env.ts):
//   walink (default): can't attach files (it's a URL scheme, not an API), so
//     the client downloads the PDF itself and opens the returned wa.me link
//     for the staff member to manually attach it.
//   business-api: the server sends the PDF directly via the Meta Cloud API —
//     fully automatic, no client-side download/open needed.
feesRouter.post(
  "/:id/whatsapp",
  requireResourcePermission("fees", "update"),
  asyncHandler(async (req, res) => {
    const fee = await loadFee(Number(req.params.id));
    if (!fee) throw new AppError(404, "not_found", "Payment not found");
    if (fee.whatsappSent) {
      throw new AppError(409, "already_sent", "Receipt already sent via WhatsApp");
    }
    if (!fee.student?.whatsappNo) {
      throw new AppError(400, "no_whatsapp_number", "Student has no WhatsApp number on file");
    }
    const caption =
      `Assalamu Alaikum. Fee receipt ${fee.receiptNo} for ${fee.student.fullName} ` +
      `${captionPeriodClause(fee.feeType, fee.feeMonth, fee.feeYear)}: ` +
      `₹ ${fee.amountPaid.toFixed(2)}/- paid on ${formatReceiptDate(fee.paymentDate)}. JazakAllah.`;

    if (env.whatsappGateway === "business-api") {
      const pdf = await loadReceiptPdf(fee);
      await sendWhatsAppDocumentViaBusinessApi(fee.student.whatsappNo, pdf, `${fee.receiptNo}.pdf`, caption);
      await feePaymentRepository.markWhatsappSent(fee.id);
      res.json({ data: { mode: "business-api", whatsappSent: true } });
      return;
    }

    const link = buildWhatsAppLink(fee.student.whatsappNo, caption);
    await feePaymentRepository.markWhatsappSent(fee.id);
    res.json({ data: { mode: "walink", link, whatsappSent: true } });
  })
);
