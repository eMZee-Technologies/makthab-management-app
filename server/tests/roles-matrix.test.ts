import request from "supertest";
import {
  adminBaselineMatrix,
  clearAllResourceMatrix,
  emptyResourceMatrix,
  normalizeRolePermissions,
  setResourceAction,
} from "@makthab/shared";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

describeApi("roles permission matrix (Phase 2)", () => {
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

  it("PATCH Admin permissions (legacy or matrix) is rejected with admin_lock", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const admin = (list.body.data as Array<{ id: number; name: string }>).find(
      (x) => x.name === "Admin"
    );
    expect(admin).toBeTruthy();

    const legacy = await request(app())
      .patch(`${API}/roles/${admin!.id}`)
      .set(bearer(token))
      .send({ permissions: ["reports.access"] });
    expect(legacy.status).toBe(400);
    expect(legacy.body.error.code).toBe("admin_lock");

    const matrix = await request(app())
      .patch(`${API}/roles/${admin!.id}`)
      .set(bearer(token))
      .send({
        permissionMatrix: {
          mode: "matrix",
          inheritsFromAdmin: false,
          resources: clearAllResourceMatrix(),
        },
      });
    expect(matrix.status).toBe(400);
    expect(matrix.body.error.code).toBe("admin_lock");
  });

  it("POST creates Fee Clerk with fees CRUD only via permissionMatrix", async () => {
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
        permissionMatrix: {
          mode: "matrix",
          inheritsFromAdmin: false,
          resources,
        },
      });
    expect(r.status).toBe(201);
    expect(r.body.data.name).toBe(name);
    expect(r.body.data.isFullAccess).toBe(false);
    expect(r.body.data.permissionMatrix.mode).toBe("matrix");
    expect(r.body.data.permissionMatrix.resources.fees).toMatchObject({
      view: true,
      create: true,
      update: true,
      delete: true,
    });
    expect(r.body.data.permissionMatrix.resources.attendance.view).toBe(false);
    expect(r.body.data.permissions).toEqual(["fees.manage"]);

    // cleanup
    await request(app()).delete(`${API}/roles/${r.body.data.id}`).set(bearer(token));
  });

  it("PATCH Teacher matrix persists and maps to attendance.mark", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const list = await request(app()).get(`${API}/roles`).set(bearer(token));
    const teacher = (
      list.body.data as Array<{ id: number; name: string; permissionMatrix: unknown }>
    ).find((x) => x.name === "Teacher");
    expect(teacher).toBeTruthy();

    let resources = emptyResourceMatrix();
    resources = setResourceAction(resources, "attendance", "create", true);
    resources = setResourceAction(resources, "attendance", "update", true);
    // implication should keep view

    const r = await request(app())
      .patch(`${API}/roles/${teacher!.id}`)
      .set(bearer(token))
      .send({
        inheritsFromAdmin: false,
        permissionMatrix: normalizeRolePermissions({
          mode: "matrix",
          inheritsFromAdmin: false,
          resources,
        }),
      });
    expect(r.status).toBe(200);
    expect(r.body.data.permissions).toEqual(["attendance.mark"]);
    expect(r.body.data.permissionMatrix.resources.attendance).toMatchObject({
      view: true,
      create: true,
      update: true,
      delete: false,
    });
  });

  it("create with inheritsFromAdmin defaults to Admin baseline snapshot", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const name = `Inherited ${Date.now()}`;
    const r = await request(app())
      .post(`${API}/roles`)
      .set(bearer(token))
      .send({ name, inheritsFromAdmin: true });
    expect(r.status).toBe(201);
    expect(r.body.data.permissionMatrix.inheritsFromAdmin).toBe(true);
    expect(r.body.data.permissionMatrix.resources).toEqual(adminBaselineMatrix());
    expect(r.body.data.permissions.length).toBeGreaterThanOrEqual(10);
    await request(app()).delete(`${API}/roles/${r.body.data.id}`).set(bearer(token));
  });

  it("implication: create without view is auto-enabled on write", async () => {
    const token = await login(CREDS.admin.username, CREDS.admin.password);
    const resources = emptyResourceMatrix();
    resources.students = { view: false, create: true, update: false, delete: false };
    const name = `Implied View ${Date.now()}`;
    const r = await request(app())
      .post(`${API}/roles`)
      .set(bearer(token))
      .send({
        name,
        permissionMatrix: {
          mode: "matrix",
          inheritsFromAdmin: false,
          resources,
        },
      });
    expect(r.status).toBe(201);
    expect(r.body.data.permissionMatrix.resources.students.view).toBe(true);
    expect(r.body.data.permissionMatrix.resources.students.create).toBe(true);
    await request(app()).delete(`${API}/roles/${r.body.data.id}`).set(bearer(token));
  });
});
