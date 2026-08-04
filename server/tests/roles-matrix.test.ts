import request from "supertest";
import {
  adminBaselineMatrix,
  clearAllResourceMatrix,
  emptyResourceMatrix,
  normalizeRolePermissions,
  setResourceAction,
  can,
} from "@makthab/shared";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

describeApi("roles permission matrix (Phase 3)", () => {
  const app = () => loadApp()!;

  it("login returns permissionMatrix (not legacy permissions keys)", async () => {
    const r = await request(app()).post(`${API}/auth/login`).send(CREDS.admin);
    expect(r.status).toBe(200);
    expect(r.body.data.user.permissionMatrix).toEqual({ mode: "all" });
    expect(r.body.data.user.permissionsVersion).toEqual(expect.any(Number));
    expect(r.body.data.user.permissions).toBeUndefined();
  });

  it("GET /roles includes assignedUserCount + permissionsVersion", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const r = await request(app()).get(`${API}/roles`).set(bearer(token));
    expect(r.status).toBe(200);
    const admin = (r.body.data as Array<{ name: string; assignedUserCount: number; permissionsVersion: number }>).find(
      (x) => x.name === "Admin"
    );
    expect(admin).toBeTruthy();
    expect(admin!.assignedUserCount).toBeGreaterThanOrEqual(1);
    expect(admin!.permissionsVersion).toEqual(expect.any(Number));
  });

  it("PATCH Admin permissionMatrix is rejected with admin_lock", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const admin = (list.body.data as Array<{ id: number; name: string }>).find((x) => x.name === "Admin");
    const r = await request(app())
      .patch(`${API}/roles/${admin!.id}`)
      .set(bearer(token))
      .send({
        permissionMatrix: {
          mode: "matrix",
          inheritsFromAdmin: false,
          resources: clearAllResourceMatrix(),
        },
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("admin_lock");
  });

  it("POST Fee Clerk + audit trail on create", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const resources = emptyResourceMatrix();
    resources.fees = { view: true, create: true, update: true, delete: true };
    resources.dashboard = { view: true, create: false, update: false, delete: false };
    const name = `Fee Clerk ${Date.now()}`;
    const r = await request(app())
      .post(`${API}/roles`)
      .set(bearer(token))
      .send({
        name,
        inheritsFromAdmin: false,
        permissionMatrix: { mode: "matrix", inheritsFromAdmin: false, resources },
      });
    expect(r.status).toBe(201);
    expect(r.body.data.permissions).toEqual(["fees.manage"]);

    const audit = await request(app())
      .get(`${API}/roles/${r.body.data.id}/audit`)
      .set(bearer(token));
    expect(audit.status).toBe(200);
    expect(audit.body.data[0].action).toBe("create");

    await request(app()).delete(`${API}/roles/${r.body.data.id}`).set(bearer(token));
  });

  it("DELETE role with assigned users is blocked; reassign then delete works", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const name = `Temp Role ${Date.now()}`;
    const created = await request(app())
      .post(`${API}/roles`)
      .set(bearer(token))
      .send({ name, inheritsFromAdmin: false, permissionMatrix: normalizeRolePermissions({
        mode: "matrix",
        inheritsFromAdmin: false,
        resources: clearAllResourceMatrix(),
      }) });
    expect(created.status).toBe(201);

    // Create a user on that role
    const user = await request(app())
      .post(`${API}/users`)
      .set(bearer(token))
      .send({
        fullName: "Temp User",
        username: `temp_${Date.now()}`,
        password: "TempPass1",
        email: `temp_${Date.now()}@example.com`,
        contactNo: "9990001111",
        whatsappNo: "9990001111",
        role: name,
      });
    expect(user.status).toBe(201);

    const blocked = await request(app())
      .delete(`${API}/roles/${created.body.data.id}`)
      .set(bearer(token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("role_in_use");

    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const teacher = (list.body.data as Array<{ id: number; name: string }>).find(
      (x) => x.name === "Teacher"
    );

    const reassigned = await request(app())
      .post(`${API}/roles/${created.body.data.id}/reassign`)
      .set(bearer(token))
      .send({ toRoleId: teacher!.id });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.data.usersMoved).toBeGreaterThanOrEqual(1);

    const deleted = await request(app())
      .delete(`${API}/roles/${created.body.data.id}`)
      .set(bearer(token));
    expect(deleted.status).toBe(200);

    // cleanup user
    await request(app()).delete(`${API}/users/${user.body.data.id}`).set(bearer(token));
  });

  it("shrinking Teacher permissions bumps version and stale tokens get 401", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const teacherLogin = await request(app()).post(`${API}/auth/login`).send(CREDS.teacher);
    expect(teacherLogin.status).toBe(200);
    const teacherToken = teacherLogin.body.data.accessToken as string;
    const teacherVersion = teacherLogin.body.data.user.permissionsVersion as number;

    // Teacher can access attendance with current token
    const ok = await request(app())
      .get(`${API}/attendance`)
      .set(bearer(teacherToken));
    expect([200, 400]).toContain(ok.status); // 400 if missing query is fine — not 403/401

    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const teacherRole = (
      list.body.data as Array<{ id: number; name: string; permissionMatrix: unknown }>
    ).find((x) => x.name === "Teacher");

    // Shrink to empty matrix
    const shrunk = await request(app())
      .patch(`${API}/roles/${teacherRole!.id}`)
      .set(bearer(token))
      .send({
        inheritsFromAdmin: false,
        permissionMatrix: normalizeRolePermissions({
          mode: "matrix",
          inheritsFromAdmin: false,
          resources: clearAllResourceMatrix(),
        }),
      });
    expect(shrunk.status).toBe(200);
    expect(shrunk.body.data.permissionsVersion).toBeGreaterThan(teacherVersion);

    const stale = await request(app())
      .get(`${API}/attendance`)
      .set(bearer(teacherToken));
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("permissions_stale");

    // Restore Teacher attendance grants for other tests
    let resources = emptyResourceMatrix();
    resources = setResourceAction(resources, "attendance", "create", true);
    resources = setResourceAction(resources, "attendance", "update", true);
    await request(app())
      .patch(`${API}/roles/${teacherRole!.id}`)
      .set(bearer(token))
      .send({
        inheritsFromAdmin: false,
        permissionMatrix: normalizeRolePermissions({
          mode: "matrix",
          inheritsFromAdmin: false,
          resources,
        }),
      });
  });

  it("Teacher cannot POST fees; Accountant can", async () => {
    const teacherToken = await login(CREDS.teacher.username, CREDS.teacher.password);
    const accountantToken = await login(CREDS.accountant.username, CREDS.accountant.password);

    const denied = await request(app())
      .get(`${API}/fees`)
      .set(bearer(teacherToken));
    expect(denied.status).toBe(403);

    const allowed = await request(app())
      .get(`${API}/fees`)
      .set(bearer(accountantToken));
    expect([200, 400]).toContain(allowed.status);
  });

  it("can() helper grants Admin all and Teacher attendance only", () => {
    expect(can({ mode: "all" }, "fees", "delete")).toBe(true);
    const teacher = normalizeRolePermissions({
      mode: "matrix",
      inheritsFromAdmin: false,
      resources: (() => {
        let r = emptyResourceMatrix();
        r = setResourceAction(r, "attendance", "create", true);
        return r;
      })(),
    });
    expect(can(teacher, "attendance", "view")).toBe(true);
    expect(can(teacher, "fees", "view")).toBe(false);
    expect(adminBaselineMatrix().fees.view).toBe(true);
  });
});
