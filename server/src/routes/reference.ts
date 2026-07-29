import { Router } from "express";
import { classRepository, categoryRepository, academicYearRepository, expenseCategoryRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";

// Lookup data for client select inputs. Any authenticated user may read these.
export const referenceRouter = Router();
referenceRouter.use(requireAuth);

referenceRouter.get(
  "/classes",
  asyncHandler(async (_req, res) => {
    const classes = await classRepository.listWithRelations();
    res.json({ data: classes });
  })
);

referenceRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await categoryRepository.findAll();
    res.json({ data: categories });
  })
);

referenceRouter.get(
  "/academic-years",
  asyncHandler(async (_req, res) => {
    const years = await academicYearRepository.findAll();
    res.json({ data: years });
  })
);

referenceRouter.get(
  "/expense-categories",
  asyncHandler(async (_req, res) => {
    const categories = await expenseCategoryRepository.findAllSortedByName();
    res.json({ data: categories });
  })
);
