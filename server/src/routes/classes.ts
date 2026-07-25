import { Router } from "express";
import { classCreateSchema, classUpdateSchema } from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export const classesRouter = Router();

classesRouter.use(requireAuth);

// POST /classes — create a class (Admin only).
classesRouter.post(
  "/",
  requirePermission("classes.manage"),
  validateBody(classCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof classCreateSchema._output;
    const exists = await prisma.class.findUnique({ where: { name: dto.name } });
    if (exists) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    const cls = await prisma.class.create({
      data: { name: dto.name, teacherId: dto.teacherId ?? null },
      include: { teacher: true },
    });
    res.status(201).json({ data: cls });
  })
);

// PATCH /classes/:id — update name/teacherId (Admin only).
classesRouter.patch(
  "/:id",
  requirePermission("classes.manage"),
  validateBody(classUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.class.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Class not found");
    const dto = req.body as typeof classUpdateSchema._output;
    if (dto.name && dto.name !== exists.name) {
      const dup = await prisma.class.findUnique({ where: { name: dto.name } });
      if (dup) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    }
    const cls = await prisma.class.update({
      where: { id },
      data: dto,
      include: { teacher: true },
    });
    res.json({ data: cls });
  })
);

// DELETE /classes/:id — hard delete, blocked if any student references it.
classesRouter.delete(
  "/:id",
  requirePermission("classes.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.class.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Class not found");
    const inUse = await prisma.student.count({ where: { classId: id } });
    if (inUse > 0) {
      throw new AppError(409, "in_use", `Class is referenced by ${inUse} student(s) and cannot be deleted`);
    }
    await prisma.class.delete({ where: { id } });
    res.json({ data: { id } });
  })
);
