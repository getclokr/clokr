/**
 * Issue #1079 (D-08, D-09, D-10) - the Betriebsurlaub routes carry and check the salons: every row
 * names its salons and `canManage`, `GET /scope` answers the nameable salons, a PATCH that changes
 * the salon set re-books open months like a changed period, and the whole-tenant answers of the
 * other write routes stay as they were.
 *
 * Fixture: tenant one with salon A (the seed salon), salon B and an inactive salon; persons pA
 * (homed in A) and pB (homed in B); the seeded admin (whole-tenant reach) and EMPLOYEE. Every
 * shutdown week is a Monday and Tuesday of one open month, at least 40 days ahead (tenant-local
 * today) with no holiday asserted. No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  seedEntitlementYears,
  soleAuditRow,
} from "./setup";
import { getTenantTimezone, monthRangeUtc, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000001";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

type Week = { day1: string; day2: string };

describe("Issue #1079 - the Betriebsurlaub routes carry and check the salons", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let salonA: string;
  let salonB: string;
  let inactiveSalon: string;
  let pA: string;
  let pB: string;
  let nextMonday: Date;

  function authed(token = data.adminToken) {
    return { authorization: `Bearer ${token}` };
  }

  async function rawPerson(label: string) {
    const user = await app.prisma.user.create({
      data: {
        email: `${label}-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: label,
        lastName: "Routes1079",
        hireDate: new Date("2024-01-01"),
      },
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        weeklyHours: 40,
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date("2024-01-01"),
      },
    });
    return employee.id;
  }

  async function home(employeeId: string, salonId: string) {
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: new Date("2024-01-01T00:00:00Z"),
        validUntil: null,
        weekdays: [],
      },
    });
  }

  async function freshWeek(): Promise<Week> {
    for (;;) {
      const monday = nextMonday;
      nextMonday = plusDays(nextMonday, 7);
      const tuesday = plusDays(monday, 1);
      const holidays = await getHolidayMap(app.prisma, data.tenant.id, null, monday, tuesday);
      if (monday.getUTCMonth() === tuesday.getUTCMonth() && holidays.size === 0) {
        return { day1: iso(monday), day2: iso(tuesday) };
      }
    }
  }

  function call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
    token?: string,
  ) {
    return app.inject({
      method,
      url: `/api/v1/company-shutdowns${url}`,
      headers: authed(token),
      ...(payload ? { payload } : {}),
    });
  }

  async function create(week: Week, salonIds?: string[], name = "Betriebsurlaub 1079 routes") {
    const res = await call("POST", "/", {
      name,
      startDate: week.day1,
      endDate: week.day2,
      ...(salonIds ? { salonIds } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; booking: Record<string, number> };
  }

  async function activeAbsences(employeeId: string, shutdownId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId, deletedAt: null },
    });
  }

  async function usedDays(employeeId: string, year: number): Promise<number> {
    const row = await app.prisma.leaveEntitlement.findFirstOrThrow({
      where: { employeeId, year, leaveType: { code: "VACATION" } },
    });
    return Number(row.usedDays);
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "csr1079");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Routes1079 B" })).id;
    inactiveSalon = (
      await createTestSalon(app.prisma, data.tenant.id, { name: "Routes1079 X", isActive: false })
    ).id;
    let monday = plusDays(todayInTz(tz), 40);
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    nextMonday = monday;

    pA = data.employee.id;
    pB = await rawPerson("rb");
    await home(pA, salonA);
    await home(pB, salonB);
    const year = monday.getUTCFullYear();
    for (const employeeId of [pA, pB, data.adminEmployee.id]) {
      await seedEntitlementYears(app, {
        employeeId,
        leaveTypeId: data.vacationType.id,
        years: [year, year + 1],
        totalDays: 30,
      });
    }
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("company-shutdown-salon-routes-1079 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("GET / names the salons per row and canManage: true for the admin, false for an employee", async () => {
    const week = await freshWeek();
    const wide = await create(week, undefined, "Betriebsurlaub 1079 list wide");
    const week2 = await freshWeek();
    const scoped = await create(week2, [salonB, salonA], "Betriebsurlaub 1079 list scoped");

    for (const token of [data.adminToken, data.empToken]) {
      const res = await call("GET", "/", undefined, token);
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<{
        id: string;
        salons: Array<{ id: string; name: string; isActive: boolean }>;
        canManage: boolean;
      }>;
      const wideRow = rows.find((row) => row.id === wide.id)!;
      const scopedRow = rows.find((row) => row.id === scoped.id)!;
      expect(wideRow.salons).toEqual([]);
      // Sorted like listSalons (oldest salon first): A was created before B.
      expect(scopedRow.salons.map((salon) => salon.id)).toEqual([salonA, salonB]);
      expect(scopedRow.salons.every((salon) => salon.isActive)).toBe(true);
      const expected = token === data.adminToken;
      expect(wideRow.canManage).toBe(expected);
      expect(scopedRow.canManage).toBe(expected);
    }
  });

  it("GET /scope answers the nameable salons for the admin, without the inactive one, and is 403 without the permission", async () => {
    const res = await call("GET", "/scope");
    expect(res.statusCode, res.body).toBe(200);
    const scope = res.json() as { canManageAllSalons: boolean; salons: Array<{ id: string }> };
    expect(scope.canManageAllSalons).toBe(true);
    expect(scope.salons.map((salon) => salon.id).sort()).toEqual([salonA, salonB].sort());
    expect(scope.salons.map((salon) => salon.id)).not.toContain(inactiveSalon);

    expect((await call("GET", "/scope", undefined, data.empToken)).statusCode).toBe(403);
  });

  it("PATCH [A] -> [A, B] books the person of B, audits old and new salonIds", async () => {
    const week = await freshWeek();
    const created = await create(week, [salonA]);
    expect(await activeAbsences(pB, created.id)).toHaveLength(0);

    const res = await call("PATCH", `/${created.id}`, { salonIds: [salonB, salonA] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.salons.map((salon: { id: string }) => salon.id)).toEqual([salonA, salonB]);
    expect(body.booking).toMatchObject({ persons: 2 });
    expect(await activeAbsences(pB, created.id)).toHaveLength(1);
    expect(await activeAbsences(pA, created.id)).toHaveLength(1);

    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: created.id, action: "UPDATE" },
    });
    expect(audit.oldValue).toMatchObject({ salonIds: [salonA] });
    expect(audit.newValue).toMatchObject({ salonIds: [salonA, salonB].sort() });
  });

  it("PATCH [A, B] -> [] makes it unternehmensweit and books every person", async () => {
    const week = await freshWeek();
    const created = await create(week, [salonA, salonB]);
    expect(await activeAbsences(data.adminEmployee.id, created.id)).toHaveLength(0);
    const res = await call("PATCH", `/${created.id}`, { salonIds: [] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().salons).toEqual([]);
    expect(await activeAbsences(data.adminEmployee.id, created.id)).toHaveLength(1);
    expect(await app.prisma.companyShutdownSalon.count({ where: { shutdownId: created.id } })).toBe(
      0,
    );
  });

  it("PATCH [A] -> [B] cancels the person of A (Urlaub booked back) in open months and books B; a closed month stays", async () => {
    const week = await freshWeek();
    const year = Number(week.day1.slice(0, 4));
    const created = await create(week, [salonA]);
    const usedBefore = await usedDays(pA, year);
    expect(usedBefore).toBeGreaterThanOrEqual(2);

    const res = await call("PATCH", `/${created.id}`, { salonIds: [salonB] });
    expect(res.statusCode, res.body).toBe(200);
    expect(await activeAbsences(pA, created.id)).toHaveLength(0);
    expect(await activeAbsences(pB, created.id)).toHaveLength(1);
    expect(await usedDays(pA, year)).toBe(usedBefore - 2);
    expect(res.json().booking).toMatchObject({ reversedAbsences: 1, reversedRequests: 1 });

    // A closed month is never changed: close pB's month, then move the closure back to A.
    const month = Number(week.day1.slice(5, 7));
    const { start, end } = monthRangeUtc(year, month, tz);
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId: pB,
        periodType: "MONTHLY",
        periodStart: start,
        periodEnd: end,
        workedMinutes: 0,
        expectedMinutes: 0,
        balanceMinutes: 0,
        carryOver: 0,
        closedAt: new Date(),
        closedBy: "test-system",
      },
    });
    const back = await call("PATCH", `/${created.id}`, { salonIds: [salonA] });
    expect(back.statusCode, back.body).toBe(200);
    expect(await activeAbsences(pB, created.id)).toHaveLength(1);
    expect(back.json().booking.skippedClosedMonths).toBeGreaterThanOrEqual(1);
    expect(await activeAbsences(pA, created.id)).toHaveLength(1);
  });

  it("PATCH with the same set in another order or with duplicates books nothing", async () => {
    const week = await freshWeek();
    const created = await create(week, [salonA, salonB]);
    const res = await call("PATCH", `/${created.id}`, {
      name: "Betriebsurlaub 1079 renamed",
      salonIds: [salonB, salonA, salonB],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().name).toBe("Betriebsurlaub 1079 renamed");
    expect(res.json().booking).toMatchObject({
      persons: 0,
      absencesWritten: 0,
      reversedAbsences: 0,
    });
    expect(await activeAbsences(pA, created.id)).toHaveLength(1);
  });

  it("PATCH adding a foreign, unknown or inactive salon is one 404 and changes nothing", async () => {
    const week = await freshWeek();
    const created = await create(week, [salonA]);
    const other = await seedTestData(app, "csr1079x");
    try {
      const bodies = new Set<string>();
      for (const salonId of [other.salonId, UNKNOWN_ID, inactiveSalon]) {
        const res = await call("PATCH", `/${created.id}`, { salonIds: [salonA, salonId] });
        expect(res.statusCode).toBe(404);
        bodies.add(res.body);
      }
      expect(bodies).toEqual(new Set([JSON.stringify({ error: "Salon nicht gefunden" })]));
      const stored = await app.prisma.companyShutdownSalon.findMany({
        where: { shutdownId: created.id },
      });
      expect(stored.map((row) => row.salonId)).toEqual([salonA]);
    } finally {
      await cleanupTestData(app, other.tenant.id);
    }
  });

  it("PATCH keeps a since-deactivated salon", async () => {
    const week = await freshWeek();
    const parked = (await createTestSalon(app.prisma, data.tenant.id, { name: "Routes1079 P" })).id;
    const created = await create(week, [parked]);
    await app.prisma.salon.update({
      where: { id: parked },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    const res = await call("PATCH", `/${created.id}`, {
      salonIds: [parked],
      name: "Betriebsurlaub 1079 kept",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().salons).toEqual([{ id: parked, name: "Routes1079 P", isActive: false }]);
  });

  it("PATCH to a scope that collides with another Betriebsurlaub is 409 and changes nothing", async () => {
    const week = await freshWeek();
    await create(week, [salonA], "Betriebsurlaub 1079 collide A");
    const b = await create(week, [salonB], "Betriebsurlaub 1079 collide B");
    const res = await call("PATCH", `/${b.id}`, { salonIds: [salonA, salonB] });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("COMPANY_SHUTDOWN_OVERLAP");
    const stored = await app.prisma.companyShutdownSalon.findMany({ where: { shutdownId: b.id } });
    expect(stored.map((row) => row.salonId)).toEqual([salonB]);
  });

  it("DELETE and the exception routes answer for a whole-tenant caller as before", async () => {
    const week = await freshWeek();
    const created = await create(week, [salonA]);

    const exception = await call("POST", `/${created.id}/exceptions`, {
      employeeId: pA,
      reason: "x",
    });
    expect(exception.statusCode, exception.body).toBe(201);
    expect(await activeAbsences(pA, created.id)).toHaveLength(0);
    const removed = await call("DELETE", `/${created.id}/exceptions/${pA}`);
    expect(removed.statusCode).toBe(204);
    expect(await activeAbsences(pA, created.id)).toHaveLength(1);

    const unknown = await call("POST", `/${UNKNOWN_ID}/exceptions`, { employeeId: pA });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ message: "Betriebsurlaub nicht gefunden" });

    const deleted = await call("DELETE", `/${created.id}`);
    expect(deleted.statusCode).toBe(204);
    expect(await activeAbsences(pA, created.id)).toHaveLength(0);
    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: created.id, action: "DELETE" },
    });
    expect(audit.oldValue).toMatchObject({ salonIds: [salonA] });
    expect((await call("DELETE", `/${created.id}`)).json()).toEqual({ message: "Nicht gefunden" });
  });
});
