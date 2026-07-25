import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";

// Lookup data for client select inputs. Any authenticated user may read these.
export const referenceRouter = Router();
referenceRouter.use(requireAuth);

referenceRouter.get(
  "/classes",
  asyncHandler(async (_req, res) => {
    const classes = await prisma.class.findMany({
      orderBy: { id: "asc" },
      include: { teacher: true, categories: { orderBy: { name: "asc" } } },
    });
    res.json({ data: classes });
  })
);

referenceRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
    res.json({ data: categories });
  })
);

referenceRouter.get(
  "/academic-years",
  asyncHandler(async (_req, res) => {
    const years = await prisma.academicYear.findMany({ orderBy: { startDate: "asc" } });
    res.json({ data: years });
  })
);

referenceRouter.get(
  "/expense-categories",
  asyncHandler(async (_req, res) => {
    const categories = await prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
    res.json({ data: categories });
  })
);
