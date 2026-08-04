import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

describeApi("roles permission matrix (Phase 1)", () => {
  const app = () => loadApp()!;

  it("GET /roles/resources returns the resource catalogue", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const r = await request(app()).get(`${API}/roles/resources`).set(bearer(token));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data.length).toBeGreaterThanOrEqual(11);
    expect(r.body.data[0]).toEqual(
      expect.objectContaining({
        key: expect.any(String),
        label: expect.any(String),
        actions: expect.any(Array),
      })
    );
  });

  it("GET /roles returns permissionMatrix + isFullAccess; Admin is locked full", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const r = await request(app()).get(`${API}/roles`).set(bearer(token));
    expect(r.status).toBe(200);
    const roles = r.body.data as Array<{
      name: string;
      permissions: string[];
      permissionMatrix: { mode: string };
      isFullAccess: boolean;
      isSystem: boolean;
    }>;
    const admin = roles.find((x) => x.name === "Admin");
    expect(admin).toBeTruthy();
    expect(admin!.isFullAccess).toBe(true);
    expect(admin!.permissionMatrix).toEqual({ mode: "all" });
    expect(admin!.permissions.length).toBeGreaterThanOrEqual(10);

    const teacher = roles.find((x) => x.name === "Teacher");
    expect(teacher).toBeTruthy();
    expect(teacher!.isFullAccess).toBe(false);
    expect(teacher!.permissionMatrix.mode).toBe("matrix");
    expect(teacher!.permissions).toEqual(["attendance.mark"]);
  });

  it("PATCH Admin permissions is rejected with admin_lock", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const admin = (list.body.data as Array<{ id: number; name: string }>).find(
      (x) => x.name === "Admin"
    );
    expect(admin).toBeTruthy();
    const r = await request(app())
      .patch(`${API}/roles/${admin!.id}`)
      .set(bearer(token))
      .send({ permissions: ["reports.access"] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("admin_lock");
  });
});
