/**
 * Issue #962 - GET /api/v1/leave/entitlements/missing-count?year=
 *
 * The Verwalten overview shows „Ohne Urlaubsanspruch N“. The count is ONE query over the persons
 * of the #613 population rule (employed in the year, never anonymised) that hold no VACATION
 * entitlement with days in that year, narrowed to the caller's leave-entitlement:read reach.
 *
 * Covered: no row and a zero-day row count, a usable row does not, an anonymised person, a person
 * who left before the year and one hired after it are excluded, the Stammsalon reach of a scoped
 * caller, the permission refusal, tenant isolation and input validation. The year is explicit and
 * far from "now", so nothing depends on the clock.
 */
import type { FastifyInstance } from "fastify";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, createTestSalon } from "./setup";
import { normalizeRolePermissions, roleNameKey } from "../contexts/platform";

const YEAR = 2031;

describe("Issue #962 - GET /leave/entitlements/missing-count", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let other: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: string;
  let salonB: string;
  const ids: Record<string, string> = {};

  async function countAs(token: string, query = `year=${YEAR}`) {
    return app.inject({
      method: "GET",
      url: `/api/v1/leave/entitlements/missing-count?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function person(
    key: string,
    salonId: string | null,
    extra: Record<string, unknown> = {},
    tenantId = data.tenant.id,
  ) {
    const s = randomBytes(3).toString("hex");
    const user = await app.prisma.user.create({
      data: { email: `m962-${s}@example.invalid`, passwordHash: "x", isActive: true },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: `M962${s}`.toUpperCase().slice(0, 20),
        firstName: key,
        lastName: "Missing962",
        hireDate: new Date("2020-01-01T00:00:00Z"),
        ...extra,
      },
    });
    if (salonId) {
      await app.prisma.employeeSalonAssignment.create({
        data: {
          tenantId,
          employeeId: employee.id,
          salonId,
          kind: "HOME",
          validFrom: new Date("2019-01-01T00:00:00Z"),
          validUntil: null,
          weekdays: [],
        },
      });
    }
    ids[key] = employee.id;
    return employee;
  }

  async function entitlement(employeeId: string, totalDays: number, typeId: string) {
    await app.prisma.leaveEntitlement.create({
      data: { employeeId, leaveTypeId: typeId, year: YEAR, totalDays, usedDays: 0 },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "miss962");
    other = await seedTestData(app, "miss962o");
    salonA = (await createTestSalon(app.prisma, data.tenant.id, { name: "Miss962 A" })).id;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Miss962 B" })).id;

    // The two fixture employees get a usable entitlement of the year, so the baseline is 0.
    await entitlement(data.adminEmployee.id, 30, data.vacationType.id);
    await entitlement(data.employee.id, 30, data.vacationType.id);

    const ok = await person("ok", salonA);
    await entitlement(ok.id, 28, data.vacationType.id);
    await person("none", salonA); // no row -> counted
    const zero = await person("zero", salonB); // zero placeholder row -> counted
    await entitlement(zero.id, 0, data.vacationType.id);
    // Not part of the population of the year:
    await person("anon", salonA, { firstName: "Gelöscht", lastName: "GELÖSCHT-X962" });
    await person("left", salonA, { exitDate: new Date("2030-12-31T00:00:00Z") });
    await person("late", salonA, { hireDate: new Date("2032-01-01T00:00:00Z") });
    // A foreign tenant's person without an entitlement must never show up here.
    await person("foreign", null, {}, other.tenant.id);
  });

  afterAll(async () => {
    try {
      await app.prisma.roleAssignment.deleteMany({
        where: { tenantId: data.tenant.id, accessRole: { name: { startsWith: "Miss962" } } },
      });
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, other.tenant.id);
    } catch (err) {
      console.error("cleanup failed", err);
    }
    await closeTestApp();
  });

  it("counts persons employed in the year with no entitlement or a zero-day row", async () => {
    const res = await countAs(data.adminToken);
    expect(res.statusCode, res.body).toBe(200);
    // none + zero; ok, the anonymised, the early leaver and the late hire are not counted
    expect(JSON.parse(res.body)).toEqual({ year: YEAR, count: 2 });
  });

  it("counts only the own tenant (a foreign tenant's person never shows)", async () => {
    const own = JSON.parse((await countAs(data.adminToken)).body) as { count: number };
    const foreignAdmin = JSON.parse((await countAs(other.adminToken)).body) as { count: number };
    // `other` has its two seed employees without an entitlement of YEAR plus the "foreign" person
    expect(foreignAdmin.count).toBe(3);
    expect(own.count).toBe(2);
  });

  it("narrows a scoped caller to the Stammsalon persons of its reach", async () => {
    const name = `Miss962 scoped ${randomBytes(3).toString("hex")}`;
    const user = await app.prisma.user.create({
      data: {
        email: `miss962-${randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `M962C${randomBytes(2).toString("hex")}`.toUpperCase(),
        firstName: "Caller",
        lastName: "Missing962",
        hireDate: new Date("2033-01-01T00:00:00Z"),
      },
    });
    const role = await app.prisma.accessRole.create({
      data: {
        tenantId: data.tenant.id,
        name,
        nameKey: roleNameKey(name),
        permissions: normalizeRolePermissions(["leave-entitlement:read:ZUGEWIESEN"]),
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        accessRoleId: role.id,
        scopeType: "SALONS",
        salonIds: [salonA],
        employeeIds: [],
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "test1234" },
    });
    const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;

    const res = await countAs(token);
    expect(res.statusCode, res.body).toBe(200);
    // only "none" lives in salon A; "zero" lives in salon B
    expect(JSON.parse(res.body)).toEqual({ year: YEAR, count: 1 });
  });

  it("refuses a caller without the ZUGEWIESEN entitlement permission", async () => {
    const res = await countAs(data.empToken);
    expect(res.statusCode).toBe(403);
  });

  it("validates the year", async () => {
    const res = await countAs(data.adminToken, "year=abc");
    expect(res.statusCode).toBe(400);
  });

  it("defaults to the current year when none is given", async () => {
    const res = await countAs(data.adminToken, "");
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).year).toBe(new Date().getFullYear());
  });
});
