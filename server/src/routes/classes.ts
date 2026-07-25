import { Router } from "express";
import { classCreateSchema, classUpdateSchema } from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export const classesRouter = Router();

classesRouter.use(requireAuth);

const classInclude = { teacher: true, categories: { orderBy: { name: "asc" as const } } };

// POST /classes — create a class (Admin only). categoryIds is the subset of
// the global Category master list this class offers.
classesRouter.post(
  "/",
  requirePermission("classes.manage"),
  validateBody(classCreateSchema),
  asyncHandler(async (req, res) => {
    const { categoryIds, ...dto } = req.body as typeof classCreateSchema._output;
    const exists = await prisma.class.findUnique({ where: { name: dto.name } });
    if (exists) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    const cls = await prisma.class.create({
      data: {
        name: dto.name,
        teacherId: dto.teacherId ?? null,
        ...(categoryIds ? { categories: { connect: categoryIds.map((id) => ({ id })) } } : {}),
      },
      include: classInclude,
    });
    res.status(201).json({ data: cls });
  })
);

// PATCH /classes/:id — update name/teacherId/categoryIds (Admin only).
// Removing a category the class currently offers is blocked while any
// student in this class still has that category set, so a student's
// category assignment can never dangle onto an un-offered category.
classesRouter.patch(
  "/:id",
  requirePermission("classes.manage"),
  validateBody(classUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.class.findUnique({ where: { id }, include: { categories: true } });
    if (!existing) throw new AppError(404, "not_found", "Class not found");
    const { categoryIds, ...dto } = req.body as typeof classUpdateSchema._output;
    if (dto.name && dto.name !== existing.name) {
      const dup = await prisma.class.findUnique({ where: { name: dto.name } });
      if (dup) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    }

    if (categoryIds) {
      const removedIds = existing.categories.map((c) => c.id).filter((cid) => !categoryIds.includes(cid));
      if (removedIds.length > 0) {
        const inUse = await prisma.student.count({ where: { classId: id, categoryId: { in: removedIds } } });
        if (inUse > 0) {
          throw new AppError(
            409,
            "in_use",
            `${inUse} student(s) in this class still use a category being removed`
          );
        }
      }
    }

    const cls = await prisma.class.update({
      where: { id },
      data: {
        ...dto,
        ...(categoryIds ? { categories: { set: categoryIds.map((cid) => ({ id: cid })) } } : {}),
      },
      include: classInclude,
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
