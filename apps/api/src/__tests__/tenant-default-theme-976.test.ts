// Issue #976: the tenant default Farbwelt (TenantConfig.defaultUiTheme) is set through the existing
// PUT /settings/work under tenant-settings:update (audited old/new), and GET/PUT /me/preferences
// answer the RESOLVED theme (own choice, else tenant default, else pflaume) next to the own choice
// and the tenant default. The API serves the lowercase web theme ids; the stored enum values (and
// so the audit values) are UPPER_SNAKE.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  auditRowChangingField,
  auditRowsFor,
  auditRowsChangingField,
} from "./setup";

type Fixture = Awaited<ReturnType<typeof seedTestData>>;

describe("tenant default Farbwelt (Issue #976)", () => {
  let app: FastifyInstance;
  let a: Fixture;
  let b: Fixture;
  let configId = "";

  const put = (token: string, url: string, payload: unknown) =>
    app.inject({
      method: "PUT",
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as object,
    });
  const get = (token: string, url: string) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = await getTestApp();
    a = await seedTestData(app, "tdt976a");
    b = await seedTestData(app, "tdt976b");
  });

  afterAll(async () => {
    for (const fixture of [a, b]) {
      try {
        await cleanupTestData(app, fixture.tenant.id);
      } catch (err) {
        console.error("Test cleanup failed:", err);
      }
    }
    await closeTestApp();
  });

  it("GET /settings/work answers defaultUiTheme pflaume for a fresh tenant", async () => {
    const res = await get(a.adminToken, "/api/v1/settings/work");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).defaultUiTheme).toBe("pflaume");
  });

  it("an admin sets salz: stored, served as a web id and audited old/new", async () => {
    const res = await put(a.adminToken, "/api/v1/settings/work", { defaultUiTheme: "salz" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).defaultUiTheme).toBe("salz");

    const row = await app.prisma.tenantConfig.findUniqueOrThrow({
      where: { tenantId: a.tenant.id },
    });
    configId = row.id;
    expect(row.defaultUiTheme).toBe("SALZ");

    const audit = await auditRowChangingField(
      app,
      "TenantConfig",
      configId,
      "UPDATE",
      "defaultUiTheme",
    );
    expect((audit.oldValue as Record<string, unknown>).defaultUiTheme).toBe("PFLAUME");
    expect((audit.newValue as Record<string, unknown>).defaultUiTheme).toBe("SALZ");

    const read = await get(a.adminToken, "/api/v1/settings/work");
    expect(JSON.parse(read.body).defaultUiTheme).toBe("salz");
  });

  it("an employee gets 403, the row stays salz and no further audit row changes it", async () => {
    const before = auditRowsChangingField(
      await auditRowsFor(app, "TenantConfig", configId, "UPDATE"),
      "defaultUiTheme",
    ).length;
    expect(before).toBe(1);
    const res = await put(a.empToken, "/api/v1/settings/work", { defaultUiTheme: "petrol" });
    expect(res.statusCode).toBe(403);
    const row = await app.prisma.tenantConfig.findUniqueOrThrow({
      where: { tenantId: a.tenant.id },
    });
    expect(row.defaultUiTheme).toBe("SALZ");
    const after = auditRowsChangingField(
      await auditRowsFor(app, "TenantConfig", configId, "UPDATE"),
      "defaultUiTheme",
    ).length;
    expect(after).toBe(before);
  });

  it.each(["lila", "wald", "SALZ"])("PUT defaultUiTheme %s is a 400", async (value) => {
    const res = await put(a.adminToken, "/api/v1/settings/work", { defaultUiTheme: value });
    expect(res.statusCode).toBe(400);
    const row = await app.prisma.tenantConfig.findUniqueOrThrow({
      where: { tenantId: a.tenant.id },
    });
    expect(row.defaultUiTheme).toBe("SALZ");
  });

  it("an employee without an own choice sees the tenant default", async () => {
    const res = await get(a.empToken, "/api/v1/me/preferences");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.theme).toBe("salz");
    expect(body.themeChoice).toBeNull();
    expect(body.tenantDefaultTheme).toBe("salz");
  });

  it("an own choice wins, and null goes back to the tenant default (stored as JSON null)", async () => {
    const own = await put(a.empToken, "/api/v1/me/preferences", { theme: "petrol" });
    expect(own.statusCode).toBe(200);
    expect(JSON.parse(own.body)).toMatchObject({
      theme: "petrol",
      themeChoice: "petrol",
      tenantDefaultTheme: "salz",
    });

    const back = await put(a.empToken, "/api/v1/me/preferences", { theme: null });
    expect(back.statusCode).toBe(200);
    expect(JSON.parse(back.body)).toMatchObject({
      theme: "salz",
      themeChoice: null,
      tenantDefaultTheme: "salz",
    });
    const stored = await app.prisma.user.findUniqueOrThrow({
      where: { id: a.empUser.id },
      select: { uiPreferences: true },
    });
    expect((stored.uiPreferences as Record<string, unknown>).theme).toBeNull();
  });

  it("another tenant is untouched", async () => {
    const res = await get(b.empToken, "/api/v1/me/preferences");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.theme).toBe("pflaume");
    expect(body.tenantDefaultTheme).toBe("pflaume");
  });
});
