import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

// Finance — Expenses, Staff, Salaries (doc §6.4)
describeApi("finance (expenses/staff/salaries)", () => {
  const app = () => loadApp()!;
  let token = "";
  let staffId = 0;
  let salaryId = 0;

  beforeAll(async () => {
    token = await login(CREDS.admin.username, CREDS.admin.password);
  });

  it("POST /expenses -> {data}, generates voucher PDF (voucherNo set)", async () => {
    const r = await request(app())
      .post(`${API}/expenses`)
      .set(bearer(token))
      .send({ categoryId: 1, cost: 600, quantity: 2, expenseDate: "2026-06-15", payee: "Stationery Co" });
    expect([200, 201]).toContain(r.status);
    expect(r.body.data).toHaveProperty("voucherNo");
    expect(r.body.data.amount).toBe(1200);
  });

  it("POST /expenses bad body -> 400 Zod", async () => {
    const r = await request(app()).post(`${API}/expenses`).set(bearer(token)).send({ amount: -5 });
    expect(r.status).toBe(400);
  });

  it("GET /expenses -> {data} (category_id/date_from/date_to/page/limit)", async () => {
    const r = await request(app()).get(`${API}/expenses?page=1&limit=10`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  it("GET /expenses/summary -> totals grouped by category", async () => {
    const r = await request(app()).get(`${API}/expenses/summary?period=2026`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  it("POST /staff -> {data} create profile (role is the Admin/Accountant/Teacher enum)", async () => {
    const r = await request(app())
      .post(`${API}/staff`)
      .set(bearer(token))
      .send({ fullName: "QA Staff", role: "Teacher", baseSalary: 15000, contactNo: "9990003333", whatsappNo: "9990003333" });
    expect([200, 201]).toContain(r.status);
    expect(r.body.data.role).toBe("Teacher");
    expect(r.body.data).toHaveProperty("photoPath", null);
    staffId = r.body?.data?.id ?? 0;
  });

  it("POST /staff with a non-enum role -> 400 Zod", async () => {
    const r = await request(app())
      .post(`${API}/staff`)
      .set(bearer(token))
      .send({ fullName: "Bad Role", role: "Cook", baseSalary: 100, contactNo: "9990003334", whatsappNo: "9990003334" });
    expect(r.status).toBe(400);
  });

  it("GET /staff -> {data} list", async () => {
    const r = await request(app()).get(`${API}/staff`).set(bearer(token));
    expect(r.status).toBe(200);
  });

  it("PATCH /staff/:id -> edits profile fields {data}", async () => {
    const r = await request(app())
      .patch(`${API}/staff/${staffId}`)
      .set(bearer(token))
      .send({ role: "Accountant", baseSalary: 18000 });
    expect(r.status).toBe(200);
    expect(r.body.data.role).toBe("Accountant");
    expect(r.body.data.baseSalary).toBe(18000);
    // untouched field preserved
    expect(r.body.data.fullName).toBe("QA Staff");
  });

  it("PATCH /staff/:id bad body -> 400 Zod", async () => {
    const r = await request(app()).patch(`${API}/staff/${staffId}`).set(bearer(token)).send({ role: "Cook" });
    expect(r.status).toBe(400);
  });

  it("PATCH /staff/:id missing -> 404", async () => {
    const r = await request(app()).patch(`${API}/staff/99999999`).set(bearer(token)).send({ baseSalary: 1 });
    expect(r.status).toBe(404);
  });

  it("POST /staff/:id/photo -> stores photo, sets photoPath {data}", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex"); // PNG magic bytes are enough (no image parsing)
    const r = await request(app())
      .post(`${API}/staff/${staffId}/photo`)
      .set(bearer(token))
      .attach("photo", png, { filename: "p.png", contentType: "image/png" });
    expect(r.status).toBe(200);
    expect(r.body.data.photoPath).toMatch(/^photos\/staff-/);
  });

  it("GET /staff/:id/photo -> streams the stored image", async () => {
    const r = await request(app()).get(`${API}/staff/${staffId}/photo`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^image\//);
  });

  it("POST /staff/:id/photo missing staff -> 404", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const r = await request(app())
      .post(`${API}/staff/99999999/photo`)
      .set(bearer(token))
      .attach("photo", png, { filename: "p.png", contentType: "image/png" });
    expect(r.status).toBe(404);
  });

  it("POST /staff/:id/signature -> stores signature, sets signaturePath {data}", async () => {
    const jpeg = Buffer.from("ffd8ffe0", "hex"); // JPEG magic bytes (upload doesn't parse the image)
    const r = await request(app())
      .post(`${API}/staff/${staffId}/signature`)
      .set(bearer(token))
      .attach("signature", jpeg, { filename: "s.jpg", contentType: "image/jpeg" });
    expect(r.status).toBe(200);
    expect(r.body.data.signaturePath).toMatch(/^photos\/staff-.*-sig-/);
  });

  it("GET /staff/:id/signature -> streams the stored image", async () => {
    const r = await request(app()).get(`${API}/staff/${staffId}/signature`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
  });

  it("POST /staff/:id/signature rejects non-JPEG -> 400", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const r = await request(app())
      .post(`${API}/staff/${staffId}/signature`)
      .set(bearer(token))
      .attach("signature", png, { filename: "s.png", contentType: "image/png" });
    expect(r.status).toBe(400);
  });

  it("POST /staff/:id/signature missing staff -> 404", async () => {
    const jpeg = Buffer.from("ffd8ffe0", "hex");
    const r = await request(app())
      .post(`${API}/staff/99999999/signature`)
      .set(bearer(token))
      .attach("signature", jpeg, { filename: "s.jpg", contentType: "image/jpeg" });
    expect(r.status).toBe(404);
  });

  it("POST /salaries -> creates a single payment, derives netAmount {data}", async () => {
    const r = await request(app())
      .post(`${API}/salaries`)
      .set(bearer(token))
      .send({ staffId, salaryMonth: 6, salaryYear: 2026, grossAmount: 20000, deductions: 500, paymentDate: "2026-06-30" });
    expect(r.status).toBe(201);
    expect(r.body.data.netAmount).toBe(19500);
    expect(r.body.data.staff.id).toBe(staffId);
    salaryId = r.body.data.id;
  });

  it("POST /salaries never trusts a client-sent netAmount", async () => {
    const r = await request(app())
      .post(`${API}/salaries`)
      .set(bearer(token))
      .send({ staffId, salaryMonth: 7, salaryYear: 2026, grossAmount: 10000, deductions: 1000, netAmount: 999999, paymentDate: "2026-07-30" });
    expect(r.status).toBe(201);
    expect(r.body.data.netAmount).toBe(9000);
  });

  it("POST /salaries duplicate staff/month/year -> 409", async () => {
    const r = await request(app())
      .post(`${API}/salaries`)
      .set(bearer(token))
      .send({ staffId, salaryMonth: 6, salaryYear: 2026, grossAmount: 20000, deductions: 0, paymentDate: "2026-06-30" });
    expect(r.status).toBe(409);
  });

  it("POST /salaries missing staff -> 404", async () => {
    const r = await request(app())
      .post(`${API}/salaries`)
      .set(bearer(token))
      .send({ staffId: 99999999, salaryMonth: 6, salaryYear: 2026, grossAmount: 100, paymentDate: "2026-06-30" });
    expect(r.status).toBe(404);
  });

  it("POST /salaries bad body -> 400 Zod", async () => {
    const r = await request(app()).post(`${API}/salaries`).set(bearer(token)).send({ staffId });
    expect(r.status).toBe(400);
  });

  it("GET /salaries -> {data} with totalNet aggregate", async () => {
    const r = await request(app()).get(`${API}/salaries?staff_id=${staffId}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty("totalNet");
    // sum of the two payments created above for this staff: 19500 + 9000
    expect(r.body.data.totalNet).toBe(28500);
  });

  it("PATCH /salaries/:id -> recomputes netAmount from effective gross/deductions {data}", async () => {
    const r = await request(app())
      .patch(`${API}/salaries/${salaryId}`)
      .set(bearer(token))
      .send({ deductions: 2000 });
    expect(r.status).toBe(200);
    // gross stays 20000, deductions now 2000 -> net 18000
    expect(r.body.data.netAmount).toBe(18000);
  });

  it("PATCH /salaries/:id missing -> 404", async () => {
    const r = await request(app()).patch(`${API}/salaries/99999999`).set(bearer(token)).send({ deductions: 1 });
    expect(r.status).toBe(404);
  });

  it("DELETE /salaries/:id -> hard delete {data:{id}}", async () => {
    const r = await request(app()).delete(`${API}/salaries/${salaryId}`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(salaryId);
  });

  it("DELETE /salaries/:id missing -> 404", async () => {
    const r = await request(app()).delete(`${API}/salaries/99999999`).set(bearer(token));
    expect(r.status).toBe(404);
  });

  it("DELETE /staff/:id -> soft delete (status=inactive), idempotent", async () => {
    const first = await request(app()).delete(`${API}/staff/${staffId}`).set(bearer(token));
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("inactive");
    // repeat call is a quiet no-op, not a 409
    const second = await request(app()).delete(`${API}/staff/${staffId}`).set(bearer(token));
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe("inactive");
  });

  it("PATCH /staff/:id -> can reactivate an inactive member via status", async () => {
    const r = await request(app())
      .patch(`${API}/staff/${staffId}`)
      .set(bearer(token))
      .send({ status: "active" });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("active");
  });

  it("DELETE /staff/:id missing -> 404", async () => {
    const r = await request(app()).delete(`${API}/staff/99999999`).set(bearer(token));
    expect(r.status).toBe(404);
  });

  it("Teacher role is blocked from staff + salary writes -> 403 (§6 roles)", async () => {
    const teacher = await login(CREDS.teacher.username, CREDS.teacher.password);
    const staffPost = await request(app())
      .post(`${API}/staff`)
      .set(bearer(teacher))
      .send({ fullName: "X", role: "Teacher", baseSalary: 1, contactNo: "9990003399", whatsappNo: "9990003399" });
    expect(staffPost.status).toBe(403);
    const salaryPost = await request(app())
      .post(`${API}/salaries`)
      .set(bearer(teacher))
      .send({ staffId: 1, salaryMonth: 5, salaryYear: 2026, grossAmount: 1, paymentDate: "2026-05-30" });
    expect(salaryPost.status).toBe(403);
  });

  it.todo("POST /salaries/:id/whatsapp -> dispatch payslip");
});
