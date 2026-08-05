import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

/**
 * Refresh-token revocation (security redesign §3.2 / §12).
 * Login issues a server-side RefreshSession; logout/admin revoke make
 * subsequent /auth/refresh fail even if the JWT has not expired.
 */
describeApi("refresh token revocation", () => {
  const app = () => loadApp()!;

  async function loginFull(username: string, password: string) {
    const r = await request(app()).post(`${API}/auth/login`).send({ username, password });
    expect(r.status).toBe(200);
    return r.body.data as {
      accessToken: string;
      refreshToken: string;
      user: { id: number; username: string };
    };
  }

  it("POST /auth/refresh with valid refresh token -> new access + rotated refresh", async () => {
    const session = await loginFull(CREDS.admin.username, CREDS.admin.password);
    const r = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: session.refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.data.accessToken).toBeTruthy();
    expect(r.body.data.refreshToken).toBeTruthy();
    expect(r.body.data.refreshToken).not.toBe(session.refreshToken);
  });

  it("old refresh token fails after rotation", async () => {
    const session = await loginFull(CREDS.teacher.username, CREDS.teacher.password);
    const first = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: session.refreshToken });
    expect(first.status).toBe(200);

    const reused = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: session.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe("invalid_token");
  });

  it("logout revokes refresh token → subsequent refresh fails", async () => {
    const session = await loginFull(CREDS.accountant.username, CREDS.accountant.password);
    const logout = await request(app())
      .post(`${API}/auth/logout`)
      .send({ refreshToken: session.refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.data.ok).toBe(true);

    const refresh = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("admin revoke-sessions force-logouts the target user", async () => {
    const victim = await loginFull(CREDS.teacher.username, CREDS.teacher.password);
    const adminToken = await login(CREDS.admin.username, CREDS.admin.password);

    const revoke = await request(app())
      .post(`${API}/users/${victim.user.id}/revoke-sessions`)
      .set(bearer(adminToken));
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const refresh = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: victim.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("logout allDevices with access token revokes every session", async () => {
    const a = await loginFull(CREDS.admin.username, CREDS.admin.password);
    const b = await loginFull(CREDS.admin.username, CREDS.admin.password);

    const logout = await request(app())
      .post(`${API}/auth/logout`)
      .set(bearer(a.accessToken))
      .send({ allDevices: true });
    expect(logout.status).toBe(200);

    const refreshA = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: a.refreshToken });
    const refreshB = await request(app())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: b.refreshToken });
    expect(refreshA.status).toBe(401);
    expect(refreshB.status).toBe(401);
  });
});
