import { prisma } from "../client";
import type { AcademicYear } from "../types";

export const academicYearRepository = {
  findAll() {
    return prisma.academicYear.findMany({ orderBy: { startDate: "asc" } });
  },
};

export type { AcademicYear };
