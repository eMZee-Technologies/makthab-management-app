import request from "supertest";
import { API, CREDS, bearer, describeApi, loadApp, login } from "./helpers";

/**
 * Automated authorization matrix (security redesign §4/A01 + §12).
 * Asserts per-role which high-value routes return 200 vs 403.
 */
describeApi("authorization matrix", () => {
  const app = () => loadApp()!;
  let admin = "";
  let accountant = "";
  let teacher = "";

  beforeAll(async () => {
    admin = await login(CREDS.admin.username, CREDS.admin.password);
    accountant = await login(CREDS.accountant.username, CREDS.accountant.password);
    teacher = await login(CREDS.teacher.username, CREDS.teacher.password);
  });

  type Case = {
    name: string;
    method: "get" | "post" | "patch" | "delete";
    path: string;
    /** Expected HTTP status by role */
    expect: { admin: number; accountant: number; teacher: number };
    body?: Record<string, unknown>;
  };

  const cases: Case[] = [
    {
      name: "list students",
      method: "get",
      path: `${API}/students`,
      expect: { admin: 200, accountant: 200, teacher: 200 },
    },
    {
      name: "list users (Admin-only module)",
      method: "get",
      path: `${API}/users`,
      expect: { admin: 200, accountant: 403, teacher: 403 },
    },
    {
      name: "list roles",
      method: "get",
      path: `${API}/roles`,
      expect: { admin: 200, accountant: 403, teacher: 403 },
    },
    {
      name: "admin backup",
      method: "post",
      path: `${API}/admin/backup`,
      expect: { admin: 201, accountant: 403, teacher: 403 },
      body: {},
    },
    {
      name: "audit logs list",
      method: "get",
      path: `${API}/admin/audit-logs`,
      expect: { admin: 200, accountant: 403, teacher: 403 },
    },
    {
      name: "list fees",
      method: "get",
      path: `${API}/fees`,
      expect: { admin: 200, accountant: 200, teacher: 403 },
    },
    {
      name: "list expenses",
      method: "get",
      path: `${API}/expenses`,
      expect: { admin: 200, accountant: 200, teacher: 403 },
    },
    {
      name: "attendance summary",
      method: "get",
      path: `${API}/attendance/summary`,
      expect: { admin: 200, accountant: 403, teacher: 200 },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: Admin/Accountant/Teacher status codes`, async () => {
      const tokens = { admin, accountant, teacher } as const;
      for (const role of ["admin", "accountant", "teacher"] as const) {
        let req = request(app())[c.method](c.path).set(bearer(tokens[role]));
        if (c.body) req = req.send(c.body);
        const r = await req;
        expect({ role, status: r.status }).toEqual({
          role,
          status: c.expect[role],
        });
      }
    });
  }

  it("Teacher cannot download a fee receipt (IDOR / module scope)", async () => {
    // Even with a guessed id, Teacher lacks fees module access → 403, not data.
    const r = await request(app()).get(`${API}/fees/1/receipt`).set(bearer(teacher));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("forbidden");
  });

  it("Accountant can access fees module; Teacher cannot mutate fees", async () => {
    const create = await request(app())
      .post(`${API}/fees`)
      .set(bearer(teacher))
      .send({
        studentId: 1,
        feeType: "monthly",
        feeYear: 2025,
        feeMonth: 1,
        amountDue: 100,
        amountPaid: 100,
        paymentDate: new Date().toISOString(),
        paymentMethod: "cash",
      });
    expect(create.status).toBe(403);

    const list = await request(app()).get(`${API}/fees`).set(bearer(accountant));
    expect(list.status).toBe(200);
  });

  it("unauthenticated requests get 401 (not 403)", async () => {
    const r = await request(app()).get(`${API}/students`);
    expect(r.status).toBe(401);
  });
});
