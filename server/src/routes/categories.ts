import { Router } from "express";
import { Prisma } from "@prisma/client";
import { categoryCreateSchema, categoryUpdateSchema } from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Global category master list (e.g. Noorani Qaida, Naazira Quran, Hifz
// Quran). Reads live at GET /reference/categories (any authed role); writes
// here are gated by classes.manage since categories only matter in the
// context of what a class offers.
export const categoriesRouter = Router();
categoriesRouter.use(requireAuth, requirePermission("classes.manage"));

categoriesRouter.post(
  "/",
  validateBody(categoryCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof categoryCreateSchema._output;
    try {
      const category = await prisma.category.create({ data: dto });
      res.status(201).json({ data: category });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "duplicate", `Category ${dto.name} already exists`);
      }
      throw err;
    }
  })
);

categoriesRouter.patch(
  "/:id",
  validateBody(categoryUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.category.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Category not found");
    const dto = req.body as typeof categoryUpdateSchema._output;
    try {
      const category = await prisma.category.update({ where: { id }, data: dto });
      res.json({ data: category });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "duplicate", `Category ${dto.name} already exists`);
      }
      throw err;
    }
  })
);

// DELETE /categories/:id — hard delete, blocked if any class offers it, or any
// student/fee-structure references it.
categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.category.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Category not found");

    const [classCount, studentCount, feeStructureCount] = await Promise.all([
      prisma.class.count({ where: { categories: { some: { id } } } }),
      prisma.student.count({ where: { categoryId: id } }),
      prisma.feeStructure.count({ where: { categoryId: id } }),
    ]);
    if (classCount > 0) {
      throw new AppError(409, "in_use", `Category is offered by ${classCount} class(es) and cannot be deleted`);
    }
    if (studentCount > 0) {
      throw new AppError(409, "in_use", `Category is referenced by ${studentCount} student(s) and cannot be deleted`);
    }
    if (feeStructureCount > 0) {
      throw new AppError(409, "in_use", `Category is referenced by ${feeStructureCount} fee structure(s) and cannot be deleted`);
    }

    await prisma.category.delete({ where: { id } });
    res.json({ data: { id } });
  })
);
