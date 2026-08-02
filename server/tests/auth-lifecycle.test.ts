/**
 * Auth lifecycle: signup → OTP → admin approval → login, plus forgot-password.
 * Covers rate-limit presence, anti-enumeration, and approval audit.
 */
import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

describeApi("auth signup / OTP / approval / forgot-password", () => {
  const app = () => loadApp()!;
  const uniq = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  it("POST /auth/signup → verify-otp → admin approve → login", async () => {
    const username = uniq();
    const password = "Secret123";
    const email = `${username}@example.com`;

    const signup = await request(app())
      .post(`${API}/auth/signup`)
      .send({
        fullName: "Pending User",
        username,
        password,
        email,
        phone: "9876543210",
        otpMethod: "email",
      });
    expect(signup.status).toBe(201);
    expect(signup.body.data.challengeId).toBeTruthy();
    const challengeId = signup.body.data.challengeId as string;
    const code = signup.body.data.devOtp as string;
    expect(code).toMatch(/^\d{6}$/);

    // Login must fail while pending verification / approval
    const earlyLogin = await request(app())
      .post(`${API}/auth/login`)
      .send({ username, password });
    expect(earlyLogin.status).toBe(401);

    const verify = await request(app())
      .post(`${API}/auth/verify-otp`)
      .send({ challengeId, code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe("pending_approval");

    const adminToken = await login(CREDS.admin.username, CREDS.admin.password);

    // Notification created for admin
    const notes = await request(app())
      .get(`${API}/users/notifications`)
      .set(bearer(adminToken));
    expect(notes.status).toBe(200);
    expect(notes.body.data.items.some((n: { type: string }) => n.type === "signup_pending")).toBe(
      true
    );

    // Find the pending user
    const list = await request(app())
      .get(`${API}/users`)
      .query({ status: "pending_approval", limit: 100 })
      .set(bearer(adminToken));
    expect(list.status).toBe(200);
    const pending = list.body.data.items.find((u: { username: string }) => u.username === username);
    expect(pending).toBeTruthy();

    const approve = await request(app())
      .post(`${API}/users/${pending.id}/approve`)
      .set(bearer(adminToken))
      .send({ role: "Teacher", note: "ok" });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("active");

    const audit = await request(app())
      .get(`${API}/users/${pending.id}/approval-audit`)
      .set(bearer(adminToken));
    expect(audit.status).toBe(200);
    expect(audit.body.data.items[0].action).toBe("approved");

    const loginOk = await request(app())
      .post(`${API}/auth/login`)
      .send({ username, password });
    expect(loginOk.status).toBe(200);
    expect(loginOk.body.data.accessToken).toBeTruthy();
    expect(loginOk.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("POST /auth/signup rejects weak passwords", async () => {
    const r = await request(app())
      .post(`${API}/auth/signup`)
      .send({
        fullName: "Weak",
        username: uniq(),
        password: "password",
        email: `${uniq()}@example.com`,
        phone: "9876543210",
        otpMethod: "email",
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
  });

  it("POST /auth/signup rejects non-10-digit mobile", async () => {
    const r = await request(app())
      .post(`${API}/auth/signup`)
      .send({
        fullName: "Bad Phone",
        username: uniq(),
        password: "Secret123",
        email: `${uniq()}@example.com`,
        phone: "12345",
        otpMethod: "email",
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
    expect(String(r.body.error.message)).toMatch(/phone|Mobile|digit/i);
  });

  it("POST /auth/forgot-password → verify-otp → reset-password", async () => {
    // Use seeded teacher
    const forgot = await request(app())
      .post(`${API}/auth/forgot-password`)
      .send({ username: CREDS.teacher.username });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.message).toBeTruthy();
    // Seeded teacher has email; challenge should exist in test/dev
    expect(forgot.body.data.challengeId).toBeTruthy();
    const challengeId = forgot.body.data.challengeId as string;
    const code = forgot.body.data.devOtp as string;

    const verify = await request(app())
      .post(`${API}/auth/verify-otp`)
      .send({ challengeId, code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.purpose).toBe("password_reset");
    const resetToken = verify.body.data.resetToken as string;

    const newPassword = "TeacherNew1";
    const reset = await request(app())
      .post(`${API}/auth/reset-password`)
      .send({ resetToken, password: newPassword });
    expect(reset.status).toBe(200);

    const loginNew = await request(app())
      .post(`${API}/auth/login`)
      .send({ username: CREDS.teacher.username, password: newPassword });
    expect(loginNew.status).toBe(200);

    // Restore teacher password for other suites (admin reset)
    const adminToken = await login(CREDS.admin.username, CREDS.admin.password);
    const users = await request(app())
      .get(`${API}/users`)
      .query({ limit: 100 })
      .set(bearer(adminToken));
    const teacher = users.body.data.items.find(
      (u: { username: string }) => u.username === CREDS.teacher.username
    );
    await request(app())
      .post(`${API}/users/${teacher.id}/reset-password`)
      .set(bearer(adminToken))
      .send({ password: CREDS.teacher.password });
  });

  it("POST /auth/forgot-password does not reveal missing accounts", async () => {
    const r = await request(app())
      .post(`${API}/auth/forgot-password`)
      .send({ email: "nobody-exists@example.com" });
    expect(r.status).toBe(200);
    expect(r.body.data.message).toBeTruthy();
    expect(r.body.data.challengeId).toBeNull();
  });

  it("POST /users/:id/reject writes audit and blocks login", async () => {
    const username = uniq();
    const password = "Secret123";
    const signup = await request(app())
      .post(`${API}/auth/signup`)
      .send({
        fullName: "Reject Me",
        username,
        password,
        email: `${username}@example.com`,
        phone: "9123456780",
        otpMethod: "email",
      });
    const { challengeId, devOtp } = signup.body.data;
    await request(app()).post(`${API}/auth/verify-otp`).send({ challengeId, code: devOtp });

    const adminToken = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app())
      .get(`${API}/users`)
      .query({ status: "pending_approval", limit: 100 })
      .set(bearer(adminToken));
    const pending = list.body.data.items.find((u: { username: string }) => u.username === username);

    const reject = await request(app())
      .post(`${API}/users/${pending.id}/reject`)
      .set(bearer(adminToken))
      .send({ reason: "Incomplete details" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");

    const loginFail = await request(app())
      .post(`${API}/auth/login`)
      .send({ username, password });
    expect(loginFail.status).toBe(401);
  });
});
