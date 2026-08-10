import { Router } from "express";
import {
  monthlyProgressCreateSchema,
  monthlyProgressUpdateSchema,
  monthlyProgressListQuery,
  progressBoardQuery,
  progressAttachmentDeleteSchema,
  type MonthlyProgressCreateDto,
  type MonthlyProgressUpdateDto,
  type MonthlyProgressListQuery,
  type ProgressBoardQuery,
  type ProgressAttachment,
  type ProgressLink,
  type MoodEngagement,
} from "@makthab/shared";
import {
  monthlyProgressRepository,
  studentRepository,
  isUniqueConstraintError,
} from "../db";
import {
  parseAttachments,
  parseLinks,
  serializeAttachments,
  serializeLinks,
} from "../db/repositories/monthly-progress.repository";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  requireAuth,
  requireResourcePermission,
  requireResourceReadOrMutate,
} from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";
import { MONTH_NAMES } from "../lib/monthNames";
import { buildWhatsAppLink } from "../lib/whatsapp";
import { recordAuditFromRequest } from "../lib/audit/auditLog";
import { deleteStoredFile } from "../lib/upload";
import {
  progressAttachmentKey,
  saveProgressAttachment,
  uploadProgressAttachment,
  assertProgressAttachmentBuffer,
} from "../lib/progressUpload";

export const progressRouter = Router();

progressRouter.use(requireAuth, requireResourceReadOrMutate("progress"));

function toDto(row: {
  id: number;
  studentId: number;
  month: number;
  year: number;
  hoursStudied: number;
  topicsCovered: string;
  assessments: string;
  attendanceDays: number;
  moodEngagement: string;
  goals: string;
  notes: string;
  previousMonthComparison: string | null;
  progressPercent: number | null;
  assignmentsCompleted: string | null;
  softSkills: string | null;
  reminders: string | null;
  nextSteps: string | null;
  linksJson: string | null;
  attachmentsJson: string | null;
  whatsappSent: boolean;
  editedById: number;
  createdAt: Date;
  updatedAt: Date;
  student?: unknown;
  editedBy?: unknown;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    month: row.month,
    year: row.year,
    hoursStudied: row.hoursStudied,
    topicsCovered: row.topicsCovered,
    assessments: row.assessments,
    attendanceDays: row.attendanceDays,
    moodEngagement: row.moodEngagement as MoodEngagement,
    goals: row.goals,
    notes: row.notes,
    previousMonthComparison: row.previousMonthComparison,
    progressPercent: row.progressPercent,
    assignmentsCompleted: row.assignmentsCompleted,
    softSkills: row.softSkills,
    reminders: row.reminders,
    nextSteps: row.nextSteps,
    links: parseLinks(row.linksJson) as ProgressLink[],
    attachments: parseAttachments(row.attachmentsJson) as ProgressAttachment[],
    whatsappSent: row.whatsappSent,
    editedById: row.editedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    student: row.student ?? undefined,
    editedBy: row.editedBy ?? undefined,
  };
}

function buildWhatsAppMessage(row: {
  month: number;
  year: number;
  hoursStudied: number;
  topicsCovered: string;
  assessments: string;
  attendanceDays: number;
  moodEngagement: string;
  goals: string;
  notes: string;
  progressPercent: number | null;
  nextSteps: string | null;
  student?: { fullName?: string; admissionNo?: string } | null;
}): string {
  const name = row.student?.fullName ?? "Student";
  const period = `${MONTH_NAMES[row.month - 1]} ${row.year}`;
  const pct =
    row.progressPercent != null ? `\nProgress: ${row.progressPercent}%` : "";
  const next = row.nextSteps?.trim() ? `\nNext steps: ${row.nextSteps.trim()}` : "";
  return (
    `Assalamu Alaikum.\n` +
    `Monthly study progress for ${name}` +
    (row.student?.admissionNo ? ` (${row.student.admissionNo})` : "") +
    ` — ${period}.\n` +
    `Topics / Portion: ${row.topicsCovered}\n` +
    `Hours studied: ${row.hoursStudied}\n` +
    `Present days: ${row.attendanceDays}\n` +
    `Assessments: ${row.assessments}\n` +
    `Engagement: ${row.moodEngagement.replace(/_/g, " ")}\n` +
    `Goals: ${row.goals}` +
    pct +
    next +
    `\nNotes: ${row.notes}\n` +
    `JazakAllah.`
  );
}

// GET /progress/board — students + optional progress for month/year
progressRouter.get(
  "/board",
  validateQuery(progressBoardQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as ProgressBoardQuery;
    const { items, total } = await monthlyProgressRepository.board({
      month: q.month,
      year: q.year,
      classId: q.class_id,
      search: q.q,
      sortOrder: q.sortOrder,
      page: q.page,
      limit: q.limit,
    });
    res.json({
      data: {
        items: items.map((row) => ({
          student: row.student,
          progress: row.progress ? toDto(row.progress) : null,
        })),
        total,
        page: q.page,
        limit: q.limit,
      },
    });
  })
);

// GET /progress
progressRouter.get(
  "/",
  validateQuery(monthlyProgressListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as MonthlyProgressListQuery;
    const { items, total } = await monthlyProgressRepository.list({
      studentId: q.student_id,
      classId: q.class_id,
      month: q.month,
      year: q.year,
      q: q.q,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      page: q.page,
      limit: q.limit,
    });
    res.json({
      data: {
        items: items.map(toDto),
        total,
        page: q.page,
        limit: q.limit,
      },
    });
  })
);

// POST /progress
progressRouter.post(
  "/",
  requireResourcePermission("progress", "create"),
  validateBody(monthlyProgressCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as MonthlyProgressCreateDto;
    const student = await studentRepository.findById(dto.studentId);
    if (!student) throw new AppError(404, "not_found", "Student not found");
    const editedById = actorStaffId(req);
    try {
      const row = await monthlyProgressRepository.create({
        studentId: dto.studentId,
        month: dto.month,
        year: dto.year,
        hoursStudied: dto.hoursStudied,
        topicsCovered: dto.topicsCovered,
        assessments: dto.assessments,
        attendanceDays: dto.attendanceDays,
        moodEngagement: dto.moodEngagement,
        goals: dto.goals,
        notes: dto.notes,
        previousMonthComparison: dto.previousMonthComparison ?? null,
        progressPercent: dto.progressPercent ?? null,
        assignmentsCompleted: dto.assignmentsCompleted ?? null,
        softSkills: dto.softSkills ?? null,
        reminders: dto.reminders ?? null,
        nextSteps: dto.nextSteps ?? null,
        linksJson: serializeLinks(dto.links ?? null),
        editedById,
      });
      await recordAuditFromRequest(req, {
        action: "create",
        entity: "progress",
        resourceId: String(row.id),
        outcome: "success",
        additionalDetails: {
          studentId: dto.studentId,
          month: dto.month,
          year: dto.year,
        },
      });
      res.status(201).json({ data: toDto(row) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(
          409,
          "duplicate_progress",
          "A progress report already exists for this student and month"
        );
      }
      throw err;
    }
  })
);

// GET /progress/:id
progressRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = await monthlyProgressRepository.findById(Number(req.params.id));
    if (!row) throw new AppError(404, "not_found", "Progress record not found");
    res.json({ data: toDto(row) });
  })
);

// PATCH /progress/:id
progressRouter.patch(
  "/:id",
  requireResourcePermission("progress", "update"),
  validateBody(monthlyProgressUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await monthlyProgressRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Progress record not found");
    const dto = req.body as MonthlyProgressUpdateDto;
    const editedById = actorStaffId(req);
    const data: Record<string, unknown> = { editedById, whatsappSent: false };
    for (const key of [
      "hoursStudied",
      "topicsCovered",
      "assessments",
      "attendanceDays",
      "moodEngagement",
      "goals",
      "notes",
      "previousMonthComparison",
      "progressPercent",
      "assignmentsCompleted",
      "softSkills",
      "reminders",
      "nextSteps",
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.links !== undefined) data.linksJson = serializeLinks(dto.links);
    const row = await monthlyProgressRepository.update(id, data);
    await recordAuditFromRequest(req, {
      action: "update",
      entity: "progress",
      resourceId: String(id),
      outcome: "success",
    });
    res.json({ data: toDto(row) });
  })
);

// DELETE /progress/:id
progressRouter.delete(
  "/:id",
  requireResourcePermission("progress", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await monthlyProgressRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Progress record not found");
    const attachments = parseAttachments(existing.attachmentsJson);
    await monthlyProgressRepository.delete(id);
    await Promise.all(attachments.map((a) => deleteStoredFile(a.key)));
    await recordAuditFromRequest(req, {
      action: "delete",
      entity: "progress",
      resourceId: String(id),
      outcome: "success",
    });
    res.json({ data: { id } });
  })
);

// POST /progress/:id/whatsapp
progressRouter.post(
  "/:id/whatsapp",
  requireResourcePermission("progress", "update"),
  asyncHandler(async (req, res) => {
    const row = await monthlyProgressRepository.findById(Number(req.params.id));
    if (!row) throw new AppError(404, "not_found", "Progress record not found");
    const phone = row.student?.whatsappNo;
    if (!phone) {
      throw new AppError(400, "no_whatsapp_number", "Student has no WhatsApp number on file");
    }
    const message = buildWhatsAppMessage(row);
    const link = buildWhatsAppLink(phone, message);
    await monthlyProgressRepository.markWhatsappSent(row.id);
    await recordAuditFromRequest(req, {
      action: "update",
      entity: "progress",
      resourceId: String(row.id),
      outcome: "success",
      additionalDetails: { whatsapp: true },
    });
    res.json({ data: { mode: "walink" as const, link, whatsappSent: true, message } });
  })
);

// POST /progress/:id/attachments
progressRouter.post(
  "/:id/attachments",
  requireResourcePermission("progress", "update"),
  uploadProgressAttachment,
  asyncHandler(async (req, res) => {
    const row = (req as typeof req & {
      uploadProgress?: Awaited<ReturnType<typeof monthlyProgressRepository.findById>>;
    }).uploadProgress;
    if (!row) throw new AppError(404, "not_found", "Progress record not found");
    const file = req.file;
    if (!file?.buffer) throw new AppError(400, "missing_file", "Attachment file is required");
    const { mime, ext } = assertProgressAttachmentBuffer(file.buffer);
    const key = progressAttachmentKey(row.id, ext);
    await saveProgressAttachment(key, file, mime);
    const attachments = parseAttachments(row.attachmentsJson);
    if (attachments.length >= 10) {
      await deleteStoredFile(key);
      throw new AppError(400, "too_many_attachments", "Maximum of 10 attachments per report");
    }
    const meta: ProgressAttachment = {
      key,
      filename: file.originalname || `attachment${ext}`,
      mime,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };
    attachments.push(meta);
    const updated = await monthlyProgressRepository.update(row.id, {
      attachmentsJson: serializeAttachments(attachments),
      editedById: actorStaffId(req),
    });
    await recordAuditFromRequest(req, {
      action: "update",
      entity: "progress",
      resourceId: String(row.id),
      outcome: "success",
      additionalDetails: { attachment: meta.filename },
    });
    res.status(201).json({ data: toDto(updated) });
  })
);

// DELETE /progress/:id/attachments
progressRouter.delete(
  "/:id/attachments",
  requireResourcePermission("progress", "update"),
  validateBody(progressAttachmentDeleteSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await monthlyProgressRepository.findById(id);
    if (!row) throw new AppError(404, "not_found", "Progress record not found");
    const { key } = req.body as { key: string };
    const attachments = parseAttachments(row.attachmentsJson);
    const next = attachments.filter((a) => a.key !== key);
    if (next.length === attachments.length) {
      throw new AppError(404, "not_found", "Attachment not found");
    }
    await deleteStoredFile(key);
    const updated = await monthlyProgressRepository.update(id, {
      attachmentsJson: serializeAttachments(next),
      editedById: actorStaffId(req),
    });
    res.json({ data: toDto(updated) });
  })
);
