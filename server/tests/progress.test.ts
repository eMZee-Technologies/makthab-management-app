import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

describeApi("progress", () => {
  const app = () => loadApp()!;
  let teacherToken = "";
  let accountantToken = "";
  let progressId = 0;
  let studentId = 0;

  beforeAll(async () => {
    teacherToken = await login(CREDS.teacher.username, CREDS.teacher.password);
    accountantToken = await login(CREDS.accountant.username, CREDS.accountant.password);
    const adminToken = await login(CREDS.admin.username, CREDS.admin.password);
    const s = await request(app())
      .post(`${API}/students`)
      .set(bearer(adminToken))
      .send({
        admissionNo: `QA-PROG-${Date.now()}`,
        fullName: "Progress Student",
        fatherName: "Father",
        gender: "male",
        contactNo: "9990003333",
        whatsappNo: "919990003333",
        classId: 1,
        academicYearId: 2,
      });
    studentId = s.body?.data?.id ?? 0;
  });

  const basePayload = () => ({
    studentId,
    month: 7,
    year: 2026,
    hoursStudied: 12.5,
    topicsCovered: "Surah Al-Mutaffifin to Surah An-Naas (Hifz)",
    assessments: "Oral recitation complete",
    attendanceDays: 24,
    moodEngagement: "good",
    goals: "Complete next Juz Nazirah",
    notes: "Steady progress this month",
    progressPercent: 80,
    nextSteps: "Start Surah Abasa",
    links: [{ url: "https://example.com/portion", label: "Portion sheet" }],
  });

  it("Accountant cannot access progress board -> 403", async () => {
    const r = await request(app())
      .get(`${API}/progress/board?month=7&year=2026`)
      .set(bearer(accountantToken));
    expect(r.status).toBe(403);
  });

  it("POST /progress (teacher) -> {data}", async () => {
    expect(studentId).toBeGreaterThan(0);
    const r = await request(app())
      .post(`${API}/progress`)
      .set(bearer(teacherToken))
      .send(basePayload());
    expect([200, 201]).toContain(r.status);
    expect(r.body?.data?.topicsCovered).toContain("Surah");
    progressId = r.body?.data?.id ?? progressId;
  });

  it("POST /progress duplicate month -> 409", async () => {
    const r = await request(app())
      .post(`${API}/progress`)
      .set(bearer(teacherToken))
      .send(basePayload());
    expect(r.status).toBe(409);
  });

  it("POST /progress bad body -> 400", async () => {
    const r = await request(app())
      .post(`${API}/progress`)
      .set(bearer(teacherToken))
      .send({ studentId, month: 13, year: 2026 });
    expect(r.status).toBe(400);
  });

  it("GET /progress/board -> students with snapshots", async () => {
    const r = await request(app())
      .get(`${API}/progress/board?month=7&year=2026`)
      .set(bearer(teacherToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.data?.items)).toBe(true);
  });

  it("PATCH /progress/:id -> updates fields", async () => {
    if (!progressId) return;
    const r = await request(app())
      .patch(`${API}/progress/${progressId}`)
      .set(bearer(teacherToken))
      .send({ hoursStudied: 14, notes: "Updated notes" });
    expect(r.status).toBe(200);
    expect(r.body?.data?.hoursStudied).toBe(14);
  });

  it("POST /progress/:id/whatsapp -> walink", async () => {
    if (!progressId) return;
    const r = await request(app())
      .post(`${API}/progress/${progressId}/whatsapp`)
      .set(bearer(teacherToken));
    expect(r.status).toBe(200);
    expect(r.body?.data?.mode).toBe("walink");
    expect(String(r.body?.data?.link ?? "")).toContain("wa.me");
  });

  it("DELETE /progress/:id", async () => {
    if (!progressId) return;
    const r = await request(app())
      .delete(`${API}/progress/${progressId}`)
      .set(bearer(teacherToken));
    expect(r.status).toBe(200);
  });
});
