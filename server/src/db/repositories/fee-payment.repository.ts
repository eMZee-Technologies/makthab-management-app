import { prisma } from "../client";
import type { Prisma, FeePayment } from "../types";

export const feePaymentRepository = {
  findById(id: number) {
    return prisma.feePayment.findUnique({ where: { id } });
  },

  findByIdWithStudentAndCollector(id: number) {
    return prisma.feePayment.findUnique({
      where: { id },
      include: { student: true, collectedBy: true },
    });
  },

  findByStudent(studentId: number) {
    return prisma.feePayment.findMany({ where: { studentId } });
  },

  create(data: Prisma.FeePaymentUncheckedCreateInput) {
    return prisma.feePayment.create({ data, include: { student: true, collectedBy: true } });
  },

  setPdfPath(id: number, pdfPath: string) {
    return prisma.feePayment.update({ where: { id }, data: { pdfPath }, include: { student: true } });
  },

  edit(id: number, data: Prisma.FeePaymentUncheckedUpdateInput) {
    return prisma.feePayment.update({ where: { id }, data, include: { student: true } });
  },

  markWhatsappSent(id: number) {
    return prisma.feePayment.update({ where: { id }, data: { whatsappSent: true } });
  },

  async delete(id: number): Promise<void> {
    await prisma.feePayment.delete({ where: { id } });
  },

  async findReceiptNosStartingWith(prefix: string): Promise<string[]> {
    const rows = await prisma.feePayment.findMany({
      where: { receiptNo: { startsWith: prefix } },
      select: { receiptNo: true },
    });
    return rows.map((r) => r.receiptNo);
  },

  // Ids of students who have a payment matching feeType/feeMonth/feeYear —
  // used for the "paid" set when computing defaulters.
  async studentIdsPaidForPeriod(feeType: string, feeMonth: number, feeYear: number): Promise<Set<number>> {
    const rows = await prisma.feePayment.findMany({
      where: { feeType, feeMonth, feeYear },
      select: { studentId: true },
    });
    return new Set(rows.map((r) => r.studentId));
  },

  async studentIdsPaidInDateRange(feeType: string, dateRange: { gte: Date; lt: Date }): Promise<Set<number>> {
    const rows = await prisma.feePayment.findMany({
      where: { feeType, paymentDate: dateRange },
      select: { studentId: true },
    });
    return new Set(rows.map((r) => r.studentId));
  },

  // Generic sum(amountPaid) under an arbitrary filter — covers dashboard's
  // month-collection total, fees.ts list's totalPaid, and the financial
  // summary's monthly/admission fee totals.
  async sumAmountPaid(where: Prisma.FeePaymentWhereInput): Promise<number> {
    const agg = await prisma.feePayment.aggregate({ _sum: { amountPaid: true }, where });
    return agg._sum.amountPaid ?? 0;
  },

  count(where: Prisma.FeePaymentWhereInput) {
    return prisma.feePayment.count({ where });
  },

  findRecentWithStudent(limit: number) {
    return prisma.feePayment.findMany({ take: limit, orderBy: { id: "desc" }, include: { student: true } });
  },

  // GET /fees list — DB skip/take when no status filter; when status is
  // active (paid/unpaid compares amountPaid vs amountDue, not expressible in
  // a Prisma `where`), the full filtered set is fetched and paginated
  // in-memory instead. Verbatim behavior preserved from the original route.
  async list(q: {
    student_id?: number;
    feeType?: string;
    month?: number;
    year?: number;
    status?: "paid" | "unpaid";
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (q.student_id) where.studentId = q.student_id;
    if (q.feeType) where.feeType = q.feeType;
    if (q.month) where.feeMonth = q.month;
    if (q.year) where.feeYear = q.year;
    const orderBy = q.sortBy
      ? q.sortBy === "student"
        ? { student: { fullName: q.sortOrder } }
        : q.sortBy === "admissionNo"
          ? { student: { admissionNo: q.sortOrder } }
          : { [q.sortBy]: q.sortOrder }
      : { student: { admissionNo: "asc" as const } };
    const skip = (q.page - 1) * q.limit;
    const rows = await prisma.feePayment.findMany({
      where,
      include: { student: true },
      orderBy: orderBy as Prisma.FeePaymentOrderByWithRelationInput,
      ...(q.status ? {} : { skip, take: q.limit }),
    });
    const filtered =
      q.status === "paid"
        ? rows.filter((r) => r.amountPaid >= r.amountDue)
        : q.status === "unpaid"
          ? rows.filter((r) => r.amountPaid < r.amountDue)
          : rows;
    const items = q.status ? filtered.slice(skip, skip + q.limit) : filtered;
    const total = q.status ? filtered.length : await prisma.feePayment.count({ where });
    const totalPaid = await this.sumAmountPaid(where as Prisma.FeePaymentWhereInput);
    return { items, total, totalPaid };
  },

  findForReport(filters: { feeType: string; feeMonth?: number; feeYear?: number }) {
    return prisma.feePayment.findMany({
      where: {
        feeType: filters.feeType,
        ...(filters.feeMonth !== undefined ? { feeMonth: filters.feeMonth } : {}),
        ...(filters.feeYear !== undefined ? { feeYear: filters.feeYear } : {}),
      },
      include: { student: true },
      orderBy: { id: "asc" },
    });
  },

  async groupByMonth(feeType: string, feeYear: number) {
    return prisma.feePayment.groupBy({
      by: ["feeMonth"],
      where: { feeType, feeYear },
      _sum: { amountPaid: true },
      _count: { _all: true },
    });
  },

  async groupByYear(feeType: string) {
    return prisma.feePayment.groupBy({
      by: ["feeYear"],
      where: { feeType },
      _sum: { amountPaid: true },
      _count: { _all: true },
    });
  },
};

export type { FeePayment };
