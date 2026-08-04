import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";
import { redactDetails, verifyAuditIntegrity } from "../src/lib/audit/auditLog";

describe("audit redactDetails", () => {
  it("redacts password and token keys", () => {
    const out = redactDetails({
      username: "alice",
      password: "secret",
      accessToken: "abc",
      nested: { otp: "123456", admissionNo: "A-1" },
    }) as Record<string, unknown>;
    expect(out.username).toBe("alice");
    expect(out.password).toBe("[REDACTED]");
    expect(out.accessToken).toBe("[REDACTED]");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.otp).toBe("[REDACTED]");
    expect(nested.admissionNo).toBe("A-1");
  });
});

describeApi("audit logs API", () => {
  const app = () => loadApp()!;

  it("login writes a success audit entry visible to admin", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app())
      .get(`${API}/admin/audit-logs`)
      .query({ action: "login", entity: "auth", outcome: "success", limit: 5 })
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);
    expect(list.body.data.items[0].action).toBe("login");
    expect(list.body.data.items[0].contentHash).toEqual(expect.any(String));
  });

  it("teacher cannot list audit logs", async () => {
    const token = await login(CREDS.teacher.username, CREDS.teacher.password);
    const list = await request(app()).get(`${API}/admin/audit-logs`).set(bearer(token));
    expect(list.status).toBe(403);
  });

  it("failed login is recorded and integrity check passes", async () => {
    await request(app())
      .post(`${API}/auth/login`)
      .send({ username: CREDS.admin.username, password: "wrong-password" });

    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app())
      .get(`${API}/admin/audit-logs`)
      .query({ action: "login", outcome: "failure", limit: 5 })
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);

    const integrity = await request(app())
      .get(`${API}/admin/audit-logs/integrity`)
      .set(bearer(token));
    expect(integrity.status).toBe(200);
    expect(integrity.body.data.ok).toBe(true);
    expect(integrity.body.data.checked).toBeGreaterThan(0);

    // Same helper used by the route.
    const direct = await verifyAuditIntegrity();
    expect(direct.ok).toBe(true);
  });

  it("student create is audited and detail endpoint works", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    // Pick an existing class / year from reference endpoints.
    const classes = await request(app()).get(`${API}/classes`).set(bearer(token));
    const years = await request(app()).get(`${API}/academic-years`).set(bearer(token));
    expect(classes.status).toBe(200);
    expect(years.status).toBe(200);
    const classId = (classes.body.data as Array<{ id: number }>)[0]?.id;
    const academicYearId = (years.body.data as Array<{ id: number }>)[0]?.id;
    expect(classId).toBeTruthy();
    expect(academicYearId).toBeTruthy();

    const admissionNo = `AUD-${Date.now()}`;
    const created = await request(app())
      .post(`${API}/students`)
      .set(bearer(token))
      .send({
        admissionNo,
        fullName: "Audit Student",
        fatherName: "Father",
        gender: "male",
        contactNo: "9876543210",
        whatsappNo: "9876543210",
        classId,
        academicYearId,
      });
    expect(created.status).toBe(201);

    const list = await request(app())
      .get(`${API}/admin/audit-logs`)
      .query({ entity: "student", action: "create", resourceId: String(created.body.data.id) })
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);
    const entryId = list.body.data.items[0].id;

    const detail = await request(app())
      .get(`${API}/admin/audit-logs/${entryId}`)
      .set(bearer(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.resourceId).toBe(String(created.body.data.id));
    expect(detail.body.data.additionalDetails.admissionNo).toBe(admissionNo);
  });
});
