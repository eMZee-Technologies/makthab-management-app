import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

// superagent doesn't buffer unknown binary bodies by default; collect the raw
// bytes so the PDF's own text can be inspected (same pattern as fees.test.ts).
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

// Contributions — income receipts gated by fees.* permissions
describeApi("contributions", () => {
  const app = () => loadApp()!;
  let token = "";
  let contributionId = 0;

  beforeAll(async () => {
    token = await login(CREDS.accountant.username, CREDS.accountant.password);
  });

  it("POST /contributions -> creates with CON-<dd-mm-yyyy>-<seq> receiptNo", async () => {
    const r = await request(app()).post(`${API}/contributions`).set(bearer(token)).send({
      amount: 1000,
      contributorName: "Donor One",
      contributorType: "individual",
      date: "2026-08-09",
      notes: "Zakat",
      whatsappNo: "9990004444",
    });
    expect([200, 201]).toContain(r.status);
    expect(r.body.data.receiptNo).toMatch(/^CON-\d{2}-\d{2}-\d{4}-\d{4}$/);
    // Date segment must match the contribution date (2026-08-09 → 09-08-2026).
    expect(r.body.data.receiptNo).toMatch(/^CON-09-08-2026-\d{4}$/);
    expect(r.body.data.pdfPath).toMatch(/^receipts\/.+\.pdf$/);
    contributionId = r.body.data.id;
  });

  it("accountant can list / get / patch contributions but not delete", async () => {
    const list = await request(app()).get(`${API}/contributions`).set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);

    const one = await request(app())
      .get(`${API}/contributions/${contributionId}`)
      .set(bearer(token));
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(contributionId);

    const patched = await request(app())
      .patch(`${API}/contributions/${contributionId}`)
      .set(bearer(token))
      .send({ amount: 1500, notes: "Updated zakat" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.amount).toBe(1500);
    // receiptNo immutable
    expect(patched.body.data.receiptNo).toBe(one.body.data.receiptNo);

    const created = await request(app()).post(`${API}/contributions`).set(bearer(token)).send({
      amount: 50,
      contributorType: "anonymous",
      date: "2026-08-09",
    });
    expect([200, 201]).toContain(created.status);
    expect(created.body.data.contributorName).toBe("Anonymous");

    // Deletion is Admin-only — an Accountant (who otherwise holds fees.delete) is refused.
    const deniedDelete = await request(app())
      .delete(`${API}/contributions/${created.body.data.id}`)
      .set(bearer(token));
    expect(deniedDelete.status).toBe(403);

    const admin = await login(CREDS.admin.username, CREDS.admin.password);
    const del = await request(app())
      .delete(`${API}/contributions/${created.body.data.id}`)
      .set(bearer(admin));
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(created.body.data.id);
  });

  it("Teacher cannot create contributions -> 403", async () => {
    const teacher = await login(CREDS.teacher.username, CREDS.teacher.password);
    const r = await request(app()).post(`${API}/contributions`).set(bearer(teacher)).send({
      amount: 100,
      contributorName: "Teacher Donor",
      contributorType: "individual",
      date: "2026-08-09",
    });
    expect(r.status).toBe(403);
  });

  it("GET /contributions/:id/receipt -> bordered receipt card with contributor fields", async () => {
    const created = await request(app()).post(`${API}/contributions`).set(bearer(token)).send({
      amount: 300,
      contributorName: "Receipt Template Donor",
      contributorType: "individual",
      date: "2026-08-09",
    });
    expect([200, 201]).toContain(created.status);

    const r = await request(app())
      .get(`${API}/contributions/${created.body.data.id}/receipt`)
      .set(bearer(token))
      .buffer()
      .parse(binaryParser);
    const pdfText = (r.body as Buffer).toString("latin1");
    expect(pdfText).toContain("CONTRIBUTIONS RECEIPT");
    expect(pdfText).toContain("Contributor Name");
    expect(pdfText).toContain("Receipt Template Donor");
    expect(pdfText).toContain("Thank you for your Contribution.");
    // Same "Name above the rule, Role below the rule" signature block as fee
    // receipts (see fees.test.ts) — the seeded accountant's fullName and role
    // are both literally "Accountant", each on its own text operator.
    const staffLines = pdfText.match(/\(Accountant\) Tj/g) ?? [];
    expect(staffLines.length).toBeGreaterThanOrEqual(2);
  });

  it("POST /contributions/:id/whatsapp without number -> 400 no_whatsapp_number", async () => {
    const created = await request(app()).post(`${API}/contributions`).set(bearer(token)).send({
      amount: 200,
      contributorName: "No WhatsApp",
      contributorType: "individual",
      date: "2026-08-09",
    });
    expect([200, 201]).toContain(created.status);
    const r = await request(app())
      .post(`${API}/contributions/${created.body.data.id}/whatsapp`)
      .set(bearer(token))
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("no_whatsapp_number");
  });
});
