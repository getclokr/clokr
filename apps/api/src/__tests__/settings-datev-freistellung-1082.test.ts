/**
 * Issue #1082 (D-08/D-09) - the write path of the optional Lohnart "Bezahlte Freistellung":
 * `PUT /api/v1/settings/work { datevFreistellungNr }` stores a whole number 1-9999 or null, every
 * change writes ONE `UPDATE TenantConfig` audit row with the old and the new value, invalid numbers
 * are refused in German and nothing is written, and the unchanged guard (`tenant-settings:update`)
 * stays. No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  auditRowChangingField,
  auditRowsChangingField,
  auditRowsFor,
} from "./setup";

describe("Issue #1082 - PUT /settings/work and the Lohnart Bezahlte Freistellung", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let configId: string;
  const auth = () => ({ authorization: `Bearer ${data.adminToken}` });

  async function put(payload: Record<string, unknown>, headers = auth()) {
    return app.inject({ method: "PUT", url: "/api/v1/settings/work", headers, payload });
  }
  async function stored(): Promise<number | null> {
    return (
      await app.prisma.tenantConfig.findUniqueOrThrow({ where: { tenantId: data.tenant.id } })
    ).datevFreistellungNr;
  }
  async function got(): Promise<unknown> {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/settings/work",
      headers: auth(),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as Record<string, unknown>).datevFreistellungNr;
  }
  async function changes() {
    return auditRowsChangingField(
      await auditRowsFor(app, "TenantConfig", configId, "UPDATE"),
      "datevFreistellungNr",
    );
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "dv1082w");
    expect((await put({ defaultBreakOver6h: 30, defaultBreakOver9h: 45 })).statusCode).toBe(200); // the config row exists
    configId = (
      await app.prisma.tenantConfig.findUniqueOrThrow({ where: { tenantId: data.tenant.id } })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("settings-datev-freistellung-1082 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("starts empty: the stored value and the GET answer are null", async () => {
    expect(await stored()).toBeNull();
    expect(await got()).toBeNull();
  });

  it("stores 305, GET answers it, and exactly one UPDATE audit row carries old null and new 305", async () => {
    const res = await put({ datevFreistellungNr: 305 });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored()).toBe(305);
    expect(await got()).toBe(305);

    const row = await auditRowChangingField(
      app,
      "TenantConfig",
      configId,
      "UPDATE",
      "datevFreistellungNr",
    );
    expect(row.userId).toBe(data.adminUser.id);
    expect(row.oldValue).toMatchObject({ datevFreistellungNr: null });
    expect(row.newValue).toMatchObject({ datevFreistellungNr: 305 });
  });

  it("an unchanged PUT writes no further change of the field", async () => {
    expect((await put({ datevFreistellungNr: 305 })).statusCode).toBe(200);
    expect(await changes()).toHaveLength(1);
  });

  it("null clears it: GET answers null and the audit row carries old 305 and new null", async () => {
    const res = await put({ datevFreistellungNr: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored()).toBeNull();
    expect(await got()).toBeNull();

    const rows = await changes();
    expect(rows).toHaveLength(2);
    const clearing = rows.find(
      (r) => (r.newValue as Record<string, unknown>).datevFreistellungNr === null,
    );
    expect(clearing).toBeDefined();
    expect(clearing!.oldValue).toMatchObject({ datevFreistellungNr: 305 });
  });

  it("a body without the field leaves it as stored", async () => {
    expect((await put({ datevFreistellungNr: 306 })).statusCode).toBe(200);
    expect((await put({ defaultBreakOver6h: 30 })).statusCode).toBe(200);
    expect(await stored()).toBe(306);
    await put({ datevFreistellungNr: null });
  });

  it.each([0, 10000, 3.5, -1])(
    "refuses %s with a German 400 that names the field and writes nothing",
    async (invalid) => {
      const before = (await changes()).length;
      const res = await put({ datevFreistellungNr: invalid });
      expect(res.statusCode, res.body).toBe(400);
      const body = JSON.parse(res.body) as {
        message: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(body.details.some((d) => d.field === "datevFreistellungNr")).toBe(true);
      expect(body.message).toContain("Bezahlte Freistellung");
      expect(body.message).not.toContain("datevFreistellungNr");
      expect(body.message).not.toMatch(/too (big|small)|invalid input|expected number/i);
      expect(await stored()).toBeNull();
      expect((await changes()).length).toBe(before);
    },
  );

  it("a caller without tenant-settings:update gets the existing 403 and nothing is written", async () => {
    const res = await put(
      { datevFreistellungNr: 777 },
      { authorization: `Bearer ${data.empToken}` },
    );
    expect(res.statusCode).toBe(403);
    expect(await stored()).toBeNull();
  });

  it("without a config row the GET default carries null", async () => {
    const other = await seedTestData(app, "dv1082d");
    try {
      await app.prisma.tenantConfig.deleteMany({ where: { tenantId: other.tenant.id } });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/settings/work",
        headers: { authorization: `Bearer ${other.adminToken}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect("datevFreistellungNr" in body).toBe(true);
      expect(body.datevFreistellungNr).toBeNull();
    } finally {
      await cleanupTestData(app, other.tenant.id);
    }
  });
});
