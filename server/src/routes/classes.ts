import { Router } from "express";
import { classCreateSchema, classUpdateSchema } from "@makthab/shared";
import { classRepository, studentRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requireResourcePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export const classesRouter = Router();

classesRouter.use(requireAuth);

// POST /classes — create a class (Admin only). categoryIds is the subset of
// the global Category master list this class offers.
classesRouter.post(
  "/",
  requireResourcePermission("classes", "create"),
  validateBody(classCreateSchema),
  asyncHandler(async (req, res) => {
    const { categoryIds, ...dto } = req.body as typeof classCreateSchema._output;
    const exists = await classRepository.findByName(dto.name);
    if (exists) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    const cls = await classRepository.create({
      name: dto.name,
      teacherId: dto.teacherId ?? null,
      ...(categoryIds ? { categories: { connect: categoryIds.map((id) => ({ id })) } } : {}),
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
  requireResourcePermission("classes", "update"),
  validateBody(classUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await classRepository.findByIdWithCategories(id);
    if (!existing) throw new AppError(404, "not_found", "Class not found");
    const { categoryIds, ...dto } = req.body as typeof classUpdateSchema._output;
    if (dto.name && dto.name !== existing.name) {
      const dup = await classRepository.findByName(dto.name);
      if (dup) throw new AppError(409, "duplicate", `Class ${dto.name} already exists`);
    }

    if (categoryIds) {
      const removedIds = existing.categories.map((c) => c.id).filter((cid) => !categoryIds.includes(cid));
      if (removedIds.length > 0) {
        const inUse = await studentRepository.countByClassAndCategories(id, removedIds);
        if (inUse > 0) {
          throw new AppError(
            409,
            "in_use",
            `${inUse} student(s) in this class still use a category being removed`
          );
        }
      }
    }

    const cls = await classRepository.update(id, {
      ...dto,
      ...(categoryIds ? { categories: { set: categoryIds.map((cid) => ({ id: cid })) } } : {}),
    });
    res.json({ data: cls });
  })
);

// DELETE /classes/:id — hard delete, blocked if any student references it.
classesRouter.delete(
  "/:id",
  requireResourcePermission("classes", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await classRepository.findById(id);
    if (!exists) throw new AppError(404, "not_found", "Class not found");
    const inUse = await studentRepository.countByClass(id);
    if (inUse > 0) {
      throw new AppError(409, "in_use", `Class is referenced by ${inUse} student(s) and cannot be deleted`);
    }
    await classRepository.delete(id);
    res.json({ data: { id } });
  })
);
