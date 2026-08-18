import request from "supertest";
import ExcelJS from "exceljs";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

// Reports (doc §6.5) — each returns PDF or XLSX (financial-summary supports both)
const XLSX = /spreadsheetml\.sheet/;
const PDF = /application\/pdf/;

// A dedicated year for the financial-summary fixtures, untouched by any other
// test file (fees.test uses 2023-2026, students.test 2026, this file 2024/2027),
// so all five line items are deterministic regardless of cross-file run order.
// (ISO_YEAR is NOT safe here: fees.test also records a 2024 admission payment.)
const FS_YEAR = 2022;
const FS_MONTHLY = 500;
const FS_ADMISSION = 1000;
const FS_CONTRIBUTIONS = 250;
const FS_EXPENSES = 300;
const FS_SALARIES = 1800;
const FS_NET = FS_MONTHLY + FS_ADMISSION + FS_CONTRIBUTIONS - FS_EXPENSES - FS_SALARIES; // -350

// A year in which no other test file records a MONTHLY payment (fees.test uses
// 2025/2026), so monthly-fee aggregations here are deterministic: exactly one
// monthly payment (₹500, March) + one admission payment (₹1000), created in
// beforeAll. Must be <= the current year, since the yearly ("all") summary only
// spans the earliest present year through the current year.
const ISO_YEAR = 2024;

// A future-dated year (> current 2026) with a single monthly payment, used to
// verify the yearly ("all") summary extends its upper bound to include years
// beyond the current one when payments actually exist there. No other test
// records a monthly payment here.
const FUTURE_YEAR = 2027;

// superagent doesn't buffer unknown binary bodies by default; collect the raw
// bytes so we can load the .xlsx back with ExcelJS and inspect real cells.
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

// Flatten every cell's stringified value across the first worksheet.
async function xlsxCellValues(buf: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's bundled types expect its own Buffer nominal type; Node's global
  // Buffer is structurally identical but not assignable, so cast.
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  const values: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => values.push(String(cell.value ?? "")));
  });
  return values;
}

// Raw (un-stringified) cell values for the first `width` columns of every
// non-empty row, so tests can assert a cell's JS *type*, not just its text.
async function xlsxRawRows(buf: Buffer, width: number): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  const rows: unknown[][] = [];
  ws.eachRow((row) => {
    const cells: unknown[] = [];
    for (let c = 1; c <= width; c++) cells.push(row.getCell(c).value);
    rows.push(cells);
  });
  return rows;
}

describeApi("reports", () => {
  const app = () => loadApp()!;
  let token = "";
  let monthlyReceipt = "";
  let admissionReceipt = "";
  // The suite's fixture student: active, with no monthly payment in 7/2026, so
  // it is guaranteed to appear as a row in the July-2026 defaulters export.
  let studentAdmissionNo = "";
  const STUDENT_WHATSAPP = "9990003333";
  // Ids of every fixture row this suite creates, hard-deleted in afterAll so a
  // second `npx jest` run (without an intervening `prisma migrate reset`)
  // doesn't double up ISO_YEAR/FS_YEAR/FUTURE_YEAR totals and break the
  // exact-equality assertions below (see task #23).
  const feePaymentIds: number[] = [];
  let expenseId: number | undefined;
  let salaryId: number | undefined;
  let contributionId: number | undefined;

  beforeAll(async () => {
    token = await login(CREDS.admin.username, CREDS.admin.password);
    // A dedicated student for this suite's fee fixtures.
    const admissionNo = `QA-RPT-${Date.now()}`;
    const s = await request(app())
      .post(`${API}/students`)
      .set(bearer(token))
      .send({
        admissionNo,
        fullName: "Report Student",
        fatherName: "Father",
        gender: "male",
        contactNo: STUDENT_WHATSAPP,
        whatsappNo: STUDENT_WHATSAPP,
        classId: 1,
        academicYearId: 1,
      });
    const studentId = s.body?.data?.id;
    studentAdmissionNo = admissionNo;

    // One monthly and one admission payment in the SAME month/year, so the
    // fee-collection report (monthly-scoped) must include the first, exclude
    // the second.
    const monthly = await request(app()).post(`${API}/fees`).set(bearer(token)).send({
      studentId,
      feeType: "monthly",
      feeMonth: 3,
      feeYear: ISO_YEAR,
      amountDue: 500,
      amountPaid: 500,
      paymentDate: `${ISO_YEAR}-03-05`,
      paymentMethod: "cash",
    });
    monthlyReceipt = monthly.body?.data?.receiptNo;
    feePaymentIds.push(monthly.body?.data?.id);

    const admission = await request(app()).post(`${API}/fees`).set(bearer(token)).send({
      studentId,
      feeType: "admission",
      feeYear: ISO_YEAR,
      amountDue: 1000,
      amountPaid: 1000,
      paymentDate: `${ISO_YEAR}-03-10`,
      paymentMethod: "cash",
    });
    admissionReceipt = admission.body?.data?.receiptNo;
    feePaymentIds.push(admission.body?.data?.id);

    // A future-dated monthly payment (feeYear > current year): must surface in
    // the yearly ("all") summary now that its upper bound extends past the
    // current year when such rows exist.
    const future = await request(app()).post(`${API}/fees`).set(bearer(token)).send({
      studentId,
      feeType: "monthly",
      feeMonth: 1,
      feeYear: FUTURE_YEAR,
      amountDue: 700,
      amountPaid: 700,
      paymentDate: `${FUTURE_YEAR}-01-05`,
      paymentMethod: "cash",
    });
    feePaymentIds.push(future.body?.data?.id);

    // Self-contained fixtures for FS_YEAR so all financial-summary line items
    // are non-zero and deterministic: monthly fee 500, admission fee 1000,
    // contribution 250, expense 300 (cost*quantity), salary net 1800
    // (gross - deductions). Fees window by feeYear, salaries by salaryYear,
    // expenses/contributions by their date fields' year.
    const fsMonthly = await request(app()).post(`${API}/fees`).set(bearer(token)).send({
      studentId,
      feeType: "monthly",
      feeMonth: 4,
      feeYear: FS_YEAR,
      amountDue: FS_MONTHLY,
      amountPaid: FS_MONTHLY,
      paymentDate: `${FS_YEAR}-04-05`,
      paymentMethod: "cash",
    });
    feePaymentIds.push(fsMonthly.body?.data?.id);
    const fsAdmission = await request(app()).post(`${API}/fees`).set(bearer(token)).send({
      studentId,
      feeType: "admission",
      feeYear: FS_YEAR,
      amountDue: FS_ADMISSION,
      amountPaid: FS_ADMISSION,
      paymentDate: `${FS_YEAR}-04-10`,
      paymentMethod: "cash",
    });
    feePaymentIds.push(fsAdmission.body?.data?.id);
    const contribution = await request(app()).post(`${API}/contributions`).set(bearer(token)).send({
      amount: FS_CONTRIBUTIONS,
      contributorName: "QA Report Donor",
      contributorType: "individual",
      date: `${FS_YEAR}-04-15`,
    });
    contributionId = contribution.body?.data?.id;
    const expense = await request(app()).post(`${API}/expenses`).set(bearer(token)).send({
      categoryId: 1,
      cost: FS_EXPENSES,
      quantity: 1,
      expenseDate: `${FS_YEAR}-05-10`,
      payee: "QA Report Expense",
    });
    expenseId = expense.body?.data?.id;
    const staff = await request(app()).post(`${API}/staff`).set(bearer(token)).send({
      fullName: "QA Report Staff",
      role: "Teacher",
      baseSalary: 2000,
      contactNo: "9990004444",
      whatsappNo: "9990004444",
    });
    const salary = await request(app()).post(`${API}/salaries`).set(bearer(token)).send({
      staffId: staff.body?.data?.id,
      salaryMonth: 6,
      salaryYear: FS_YEAR,
      grossAmount: 2000,
      deductions: 200,
      paymentDate: `${FS_YEAR}-06-30`,
    });
    salaryId = salary.body?.data?.id;
  });

  // Hard-delete every fixture row so a second `npx jest` run against the same
  // (non-reset) test.db doesn't double the ISO_YEAR/FS_YEAR/FUTURE_YEAR totals
  // and break the exact-equality assertions below (task #23). The fixture
  // student and staff row are left in place (soft-deletable only via the API,
  // and — unlike the fee/expense/salary rows — nothing here asserts an exact
  // count of them), matching how other suites in this file already leave
  // their student fixtures behind.
  afterAll(async () => {
    for (const id of feePaymentIds) {
      if (id != null) await request(app()).delete(`${API}/fees/${id}`).set(bearer(token));
    }
    if (expenseId != null) await request(app()).delete(`${API}/expenses/${expenseId}`).set(bearer(token));
    if (salaryId != null) await request(app()).delete(`${API}/salaries/${salaryId}`).set(bearer(token));
    if (contributionId != null) {
      await request(app()).delete(`${API}/contributions/${contributionId}`).set(bearer(token));
    }
  });

  // --- existing coverage (unchanged) -------------------------------------

  it("GET /reports/fee-collection?month&year -> PDF", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection?month=6&year=2026`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(PDF);
  });

  it("GET /reports/fee-collection?...&format=xlsx -> XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection?month=6&year=2026&format=xlsx`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
  });

  it("GET /reports/defaulters?month&year -> PDF/XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/defaulters?month=6&year=2026`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(new RegExp(`${PDF.source}|${XLSX.source}`));
  });

  // Contact rename + numeric cell + blank template columns. Uses month=7/2026,
  // where the fixture student (created above, no monthly payment that month)
  // is guaranteed to appear as a defaulter row.
  it("GET /reports/defaulters?...&format=xlsx -> Contact column is numeric, Date/Amount/Mode are blank", async () => {
    const r = await request(app())
      .get(`${API}/reports/defaulters?month=7&year=2026&format=xlsx`)
      .buffer()
      .parse(binaryParser)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
    const rows = await xlsxRawRows(r.body, 7);
    const headerRow = rows.find((row) => row[0] === "Admission");
    expect(headerRow).toEqual(["Admission", "Student", "Class", "Contact", "Date", "Amount", "Mode"]);
    const dataRow = rows.find((row) => row[0] === studentAdmissionNo);
    expect(dataRow).toBeDefined();
    expect(typeof dataRow?.[3]).toBe("number");
    expect(dataRow?.[3]).toBe(Number(STUDENT_WHATSAPP));
    expect(dataRow?.[4]).toBe(""); // Date
    expect(dataRow?.[5]).toBe(""); // Amount
    expect(dataRow?.[6]).toBe(""); // Mode
  });

  it.each([
    ["?month=7&year=2026", "inline", "Defaulters-Report-July-2026.pdf"],
    ["?month=7&year=2026&format=xlsx", "attachment", "Defaulters-Report-July-2026.xlsx"],
  ])("GET /reports/defaulters%s -> %s filename %s", async (query, disposition, filename) => {
    const r = await request(app()).get(`${API}/reports/defaulters${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toBe(`${disposition}; filename="${filename}"`);
  });

  it("GET /reports/attendance?class_id&month&year -> PDF/XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/attendance?class_id=1&month=6&year=2026`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  it("GET /reports/student-progress/summary?year -> JSON table", async () => {
    const r = await request(app())
      .get(`${API}/reports/student-progress/summary?year=2026`)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.data?.items)).toBe(true);
  });

  it.each([
    ["?year=2026", "inline", "Student-Progress-2026.pdf"],
    ["?year=2026&month=7&format=xlsx", "attachment", "Student-Progress-July-2026.xlsx"],
  ])("GET /reports/student-progress%s -> %s filename %s", async (query, disposition, filename) => {
    const r = await request(app()).get(`${API}/reports/student-progress${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toBe(`${disposition}; filename="${filename}"`);
  });

  it("GET /reports/expenses?period -> PDF/XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/expenses?period=2026`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  it("GET /reports/salary-register?month&year -> PDF/XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/salary-register?month=6&year=2026`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  // Backward-compat: bare ?year (no view) still defaults to the year view and
  // returns a PDF, now under the capitalized Financial-Summary-<year> stem.
  it("GET /reports/financial-summary?year (no view) -> PDF, year view default", async () => {
    const r = await request(app()).get(`${API}/reports/financial-summary?year=2026`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(PDF);
    expect(r.headers["content-disposition"]).toBe('inline; filename="Financial-Summary-2026.pdf"');
  });

  // --- (1) fee-collection is now scoped to feeType='monthly' -------------

  it("GET /reports/fee-collection (list) excludes admission payments", async () => {
    const r = await request(app())
      .get(`${API}/reports/fee-collection?month=3&year=${ISO_YEAR}&format=xlsx`)
      .buffer()
      .parse(binaryParser)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
    const cells = await xlsxCellValues(r.body);
    // The monthly payment must appear; the admission payment must not.
    expect(cells).toContain(monthlyReceipt);
    expect(cells).not.toContain(admissionReceipt);
    // No data row should carry the 'admission' fee type.
    expect(cells.map((c) => c.toLowerCase())).not.toContain("admission");
  });

  // --- (2) fee-collection view=year download -----------------------------

  it("GET /reports/fee-collection?view=year -> PDF (default)", async () => {
    const r = await request(app())
      .get(`${API}/reports/fee-collection?view=year&year=${ISO_YEAR}`)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(PDF);
  });

  it("GET /reports/fee-collection?view=year&format=xlsx -> XLSX", async () => {
    const r = await request(app())
      .get(`${API}/reports/fee-collection?view=year&year=${ISO_YEAR}&format=xlsx`)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
  });

  // --- (3) fee-collection view=all download ------------------------------

  it("GET /reports/fee-collection?view=all -> PDF (default)", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection?view=all`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(PDF);
  });

  it("GET /reports/fee-collection?view=all&format=xlsx -> XLSX", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection?view=all&format=xlsx`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
  });

  // --- (4) fee-collection/summary?view=year JSON -------------------------

  it("GET /reports/fee-collection/summary?view=year -> 12-month zero-filled JSON", async () => {
    const r = await request(app())
      .get(`${API}/reports/fee-collection/summary?view=year&year=${ISO_YEAR}`)
      .set(bearer(token));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.view).toBe("year");
    expect(typeof d.year).toBe("number");
    expect(d.year).toBe(ISO_YEAR);
    expect(Array.isArray(d.months)).toBe(true);
    expect(d.months).toHaveLength(12);
    d.months.forEach((m: { month: number; totalPaid: number; count: number }, i: number) => {
      expect(m.month).toBe(i + 1);
      expect(typeof m.totalPaid).toBe("number");
      expect(typeof m.count).toBe("number");
    });
    // March (index 2) holds exactly our one monthly payment; admission excluded.
    expect(d.months[2]).toEqual({ month: 3, totalPaid: 500, count: 1 });
    // totalPaid is the sum over months (only the March ₹500 in this isolated year).
    expect(d.totalPaid).toBe(500);
    expect(d.totalPaid).toBe(d.months.reduce((s: number, m: { totalPaid: number }) => s + m.totalPaid, 0));
  });

  it("GET /reports/fee-collection/summary?view=year with no year -> 400", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection/summary?view=year`).set(bearer(token));
    expect(r.status).toBe(400);
  });

  // --- (5) fee-collection/summary?view=all JSON --------------------------

  it("GET /reports/fee-collection/summary?view=all -> yearly JSON", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection/summary?view=all`).set(bearer(token));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.view).toBe("all");
    expect(Array.isArray(d.years)).toBe(true);
    expect(d.years.length).toBeGreaterThan(0);
    d.years.forEach((y: { year: number; totalPaid: number; count: number }) => {
      expect(typeof y.year).toBe("number");
      expect(typeof y.totalPaid).toBe("number");
      expect(typeof y.count).toBe("number");
    });
    // Our isolated year is present with exactly the one monthly payment.
    const isoRow = d.years.find((y: { year: number }) => y.year === ISO_YEAR);
    expect(isoRow).toEqual({ year: ISO_YEAR, totalPaid: 500, count: 1 });
    expect(d.totalPaid).toBe(d.years.reduce((s: number, y: { totalPaid: number }) => s + y.totalPaid, 0));
  });

  it("GET /reports/fee-collection/summary?view=all -> includes future-dated years", async () => {
    const r = await request(app()).get(`${API}/reports/fee-collection/summary?view=all`).set(bearer(token));
    expect(r.status).toBe(200);
    const d = r.body.data;
    // A payment dated beyond the current year must not be dropped from the range.
    const futureRow = d.years.find((y: { year: number }) => y.year === FUTURE_YEAR);
    expect(futureRow).toEqual({ year: FUTURE_YEAR, totalPaid: 700, count: 1 });
    // ...and it must contribute to the grand total.
    expect(d.totalPaid).toBe(d.years.reduce((s: number, y: { totalPaid: number }) => s + y.totalPaid, 0));
  });

  // --- (6) admission-fee-collection --------------------------------------

  it("GET /reports/admission-fee-collection (all years) -> PDF/XLSX", async () => {
    const pdf = await request(app()).get(`${API}/reports/admission-fee-collection`).set(bearer(token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(PDF);
    const xlsx = await request(app())
      .get(`${API}/reports/admission-fee-collection?format=xlsx`)
      .set(bearer(token));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toMatch(XLSX);
  });

  it("GET /reports/admission-fee-collection?year -> PDF/XLSX, scoped to admission", async () => {
    const pdf = await request(app())
      .get(`${API}/reports/admission-fee-collection?year=${ISO_YEAR}`)
      .set(bearer(token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(PDF);

    const xlsx = await request(app())
      .get(`${API}/reports/admission-fee-collection?year=${ISO_YEAR}&format=xlsx`)
      .buffer()
      .parse(binaryParser)
      .set(bearer(token));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toMatch(XLSX);
    const cells = await xlsxCellValues(xlsx.body);
    // Mirror image of the monthly report: admission present, monthly absent.
    expect(cells).toContain(admissionReceipt);
    expect(cells).not.toContain(monthlyReceipt);
  });

  // --- (7) download filenames (Content-Disposition) ----------------------
  // The stem is set explicitly per endpoint/view (not slugified). PDF is
  // inline, XLSX is attachment; the stem is identical across both.

  it.each([
    ["?month=1&year=2026", "inline", "Monthly-Fee-Report-Jan-2026.pdf"],
    ["?month=1&year=2026&format=xlsx", "attachment", "Monthly-Fee-Report-Jan-2026.xlsx"],
    ["?view=year&year=2026", "inline", "Monthly-Fee-Report-2026.pdf"],
    ["?view=year&year=2026&format=xlsx", "attachment", "Monthly-Fee-Report-2026.xlsx"],
    ["?view=all", "inline", "Monthly-Fee-Report-All.pdf"],
    ["?view=all&format=xlsx", "attachment", "Monthly-Fee-Report-All.xlsx"],
  ])("GET /reports/fee-collection%s -> %s filename %s", async (query, disposition, filename) => {
    const r = await request(app()).get(`${API}/reports/fee-collection${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toBe(`${disposition}; filename="${filename}"`);
  });

  it.each([
    ["?year=2026", "inline", "Admission-Fee-Report-2026.pdf"],
    ["?year=2026&format=xlsx", "attachment", "Admission-Fee-Report-2026.xlsx"],
    ["", "inline", "Admission-Fee-Report-All.pdf"],
    ["?format=xlsx", "attachment", "Admission-Fee-Report-All.xlsx"],
  ])("GET /reports/admission-fee-collection%s -> %s filename %s", async (query, disposition, filename) => {
    const r = await request(app()).get(`${API}/reports/admission-fee-collection${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toBe(`${disposition}; filename="${filename}"`);
  });

  // --- (8) in-document title row (month ABBREVIATION, not number) ---------
  // The .xlsx first row merges title+subtitle as "<title> — <subtitle>".

  it.each([
    ["/fee-collection?month=1&year=2026&format=xlsx", "Monthly Fee Collection Report — Jan-2026", "1/2026"],
    ["/fee-collection?view=year&year=2026&format=xlsx", "Monthly Fee Collection Report — 2026", ""],
    ["/fee-collection?view=all&format=xlsx", "Monthly Fee Collection Report — All", ""],
    ["/admission-fee-collection?year=2026&format=xlsx", "Admission Fee Collection Report — 2026", ""],
    ["/admission-fee-collection?format=xlsx", "Admission Fee Collection Report — All", ""],
  ])("title row for GET /reports%s reads %s", async (path, expectedTitle, forbidden) => {
    const r = await request(app())
      .get(`${API}/reports${path}`)
      .buffer()
      .parse(binaryParser)
      .set(bearer(token));
    expect(r.status).toBe(200);
    const cells = await xlsxCellValues(r.body);
    expect(cells).toContain(expectedTitle);
    // The old numeric subtitle form (e.g. "1/2026") must be gone.
    if (forbidden) expect(cells.join("")).not.toContain(forbidden);
  });

  // --- (9) financial-summary JSON summary --------------------------------

  it("GET /reports/financial-summary/summary?view=year -> line items + net balance", async () => {
    const r = await request(app())
      .get(`${API}/reports/financial-summary/summary?view=year&year=${FS_YEAR}`)
      .set(bearer(token));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.view).toBe("year");
    expect(d.year).toBe(FS_YEAR);
    expect(d.monthlyFee).toBe(FS_MONTHLY);
    expect(d.admissionFee).toBe(FS_ADMISSION);
    expect(d.contributions).toBe(FS_CONTRIBUTIONS);
    expect(d.expenses).toBe(FS_EXPENSES);
    expect(d.salaries).toBe(FS_SALARIES);
    expect(d.netBalance).toBe(FS_NET);
    // netBalance is the derived identity, not an independent field.
    expect(d.netBalance).toBe(
      d.monthlyFee + d.admissionFee + d.contributions - d.expenses - d.salaries
    );
  });

  it("GET /reports/financial-summary/summary?view=year with no year -> 400", async () => {
    const r = await request(app()).get(`${API}/reports/financial-summary/summary?view=year`).set(bearer(token));
    expect(r.status).toBe(400);
  });

  it("GET /reports/financial-summary/summary?view=all -> years array + totals", async () => {
    const r = await request(app()).get(`${API}/reports/financial-summary/summary?view=all`).set(bearer(token));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.view).toBe("all");
    expect(Array.isArray(d.years)).toBe(true);
    // Our isolated year carries every line item exactly.
    const isoRow = d.years.find((y: { year: number }) => y.year === FS_YEAR);
    expect(isoRow).toEqual({
      year: FS_YEAR,
      monthlyFee: FS_MONTHLY,
      admissionFee: FS_ADMISSION,
      contributions: FS_CONTRIBUTIONS,
      expenses: FS_EXPENSES,
      salaries: FS_SALARIES,
      netBalance: FS_NET,
    });
    // A future-dated monthly payment must not be dropped from the range (mirrors
    // the sibling fee-collection/salary "all" reports).
    const futureRow = d.years.find((y: { year: number }) => y.year === FUTURE_YEAR);
    expect(futureRow?.year).toBe(FUTURE_YEAR);
    expect(futureRow?.monthlyFee).toBe(700);
    // totals are the column-wise sum of the years array.
    const sum = (k: string) => d.years.reduce((s: number, y: Record<string, number>) => s + y[k], 0);
    (
      ["monthlyFee", "admissionFee", "contributions", "expenses", "salaries", "netBalance"] as const
    ).forEach((k) => {
      expect(d.totals[k]).toBe(sum(k));
    });
  });

  // --- (10) financial-summary download: both views x both formats --------

  it.each([
    [`?view=year&year=${FS_YEAR}`, "inline", PDF, `Financial-Summary-${FS_YEAR}.pdf`],
    [`?view=year&year=${FS_YEAR}&format=xlsx`, "attachment", XLSX, `Financial-Summary-${FS_YEAR}.xlsx`],
    ["?view=all", "inline", PDF, "Financial-Summary-All.pdf"],
    ["?view=all&format=xlsx", "attachment", XLSX, "Financial-Summary-All.xlsx"],
  ])("GET /reports/financial-summary%s -> %s file", async (query, disposition, ctype, filename) => {
    const r = await request(app()).get(`${API}/reports/financial-summary${query}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(ctype as RegExp);
    expect(r.headers["content-disposition"]).toBe(`${disposition}; filename="${filename}"`);
  });

  it("financial-summary view=year xlsx carries the 6 labels and their amounts", async () => {
    const r = await request(app())
      .get(`${API}/reports/financial-summary?view=year&year=${FS_YEAR}&format=xlsx`)
      .buffer()
      .parse(binaryParser)
      .set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(XLSX);
    const cells = await xlsxCellValues(r.body);
    ["Monthly Fee", "Admission Fee", "Contributions", "Expenses", "Salaries", "Net Balance"].forEach(
      (label) => expect(cells).toContain(label)
    );
    // Each amount is stored as a real number cell (formatting is display-only).
    expect(cells).toContain(String(FS_MONTHLY));
    expect(cells).toContain(String(FS_ADMISSION));
    expect(cells).toContain(String(FS_CONTRIBUTIONS));
    expect(cells).toContain(String(FS_EXPENSES));
    expect(cells).toContain(String(FS_SALARIES));
    expect(cells).toContain(String(FS_NET));
  });
});
