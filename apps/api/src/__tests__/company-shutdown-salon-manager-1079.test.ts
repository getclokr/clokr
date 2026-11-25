/**
 * Issue #1079 (AC2, owner decision 25.11.2026, A2) - a Salonmanager with a SALONS assignment on salon A
 * manages the Betriebsurlaub of her own salon, proven against the REAL Salonmanager template (never an
 * ad-hoc role): she creates, edits and deletes a Betriebsurlaub that names only A, cannot touch B's or
 * the Unternehmen's one, cannot grant paid release without Urlaub, and sees only the persons of A.
 *
 * Fixture: tenant one with salons A (the seed salon) and B; persons pA (homed in A), pB (homed in B)
 * and the Salonmanager SM (homed in A, assignment SALONS [A] on the system template). The seeded admin
 * has whole-tenant reach and creates the shutdowns the scoped caller must not touch. Every shutdown
 * week is a Monday and Tuesday of one open month, at least 40 days ahead, no holiday asserted. No
 * person names.
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
  tokenWithoutSignIn,
} from "./setup";
import { SYSTEM_ROLE_IDS } from "../contexts/platform";
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

type Week = { day1: string; day2: string };

describe("Issue #1079 - a Salonmanager manages the Betriebsurlaub of her salon", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let salonA: string;
  let salonB: string;
  let pA: string;
  let pB: string;
  let sm: string;
  let smToken: string;
  let nextMonday: Date;

  async function person(label: string, salonId: string): Promise<{ id: string; userId: string }> {
    const email = `${label}-${crypto.randomBytes(3).toString("hex")}@example.invalid`;
    const user = await app.prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("test1234", 4), isActive: true },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: label,
        lastName: "Manager1079",
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
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId: employee.id,
        salonId,
        kind: "HOME",
        validFrom: new Date("2024-01-01T00:00:00Z"),
        validUntil: null,
        weekdays: [],
      },
    });
    return { id: employee.id, userId: user.id };
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
    token: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
  ) {
    return app.inject({
      method,
      url: `/api/v1/company-shutdowns${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  }

  /** A shutdown created by the whole-tenant admin (the rows the Salonmanager must not touch). */
  async function adminCreate(week: Week, salonIds?: string[], deducts = true) {
    const res = await call(data.adminToken, "POST", "/", {
      name: "Betriebsurlaub 1079 SM",
      startDate: week.day1,
      endDate: week.day2,
      deductsFromVacation: deducts,
      ...(salonIds ? { salonIds } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  async function activeAbsences(employeeId: string, shutdownId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId, deletedAt: null },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "csm1079");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Manager1079 B" })).id;
    let monday = plusDays(todayInTz(tz), 40);
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    nextMonday = monday;

    pA = data.employee.id;
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId: pA,
        salonId: salonA,
        kind: "HOME",
        validFrom: new Date("2024-01-01T00:00:00Z"),
        validUntil: null,
        weekdays: [],
      },
    });
    pB = (await person("pb", salonB)).id;
    const manager = await person("sm", salonA);
    sm = manager.id;
    const smUser = await app.prisma.user.findUniqueOrThrow({
      where: { id: manager.userId },
      select: { email: true },
    });
    // The REAL Salonmanager system template, scope SALONS [A] - no ad-hoc role.
    await app.prisma.roleAssignment.create({
      data: {
        tenantId: data.tenant.id,
        userId: manager.userId,
        accessRoleId: SYSTEM_ROLE_IDS.SALON_MANAGER,
        scopeType: "SALONS",
        salonIds: [salonA],
        employeeIds: [],
      },
    });
    smToken = await tokenWithoutSignIn(app, smUser.email);

    const year = monday.getUTCFullYear();
    for (const employeeId of [pA, pB, sm, data.adminEmployee.id]) {
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
      console.error("company-shutdown-salon-manager-1079 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("the template holds the key and the relation lets a SALONS assignment use it", async () => {
    expect((await call(smToken, "GET", "/scope")).statusCode).toBe(200);
  });

  it("POST for her own salon books the persons of A within her leave reach", async () => {
    const week = await freshWeek();
    const res = await call(smToken, "POST", "/", {
      name: "Betriebsurlaub 1079 SM A",
      startDate: week.day1,
      endDate: week.day2,
      salonIds: [salonA],
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    // pA and SM are homed in A; pB is not. SM holds no EIGENE create key, so her own row gets the
    // absence only.
    expect(body.booking).toMatchObject({ persons: 2, absencesWritten: 2, outsideCreateReach: 1 });
    expect(await activeAbsences(pA, body.id)).toHaveLength(1);
    expect(await activeAbsences(sm, body.id)).toHaveLength(1);
    expect(await activeAbsences(pB, body.id)).toHaveLength(0);
    const request = await app.prisma.leaveRequest.findFirstOrThrow({
      where: { employeeId: pA, companyShutdownId: body.id, deletedAt: null },
    });
    expect(request.status).toBe("APPROVED");
    expect(
      await app.prisma.leaveRequest.count({
        where: { employeeId: sm, companyShutdownId: body.id },
      }),
    ).toBe(0);
  });

  it("POST for another salon, for both, or for the whole Unternehmen is refused", async () => {
    const week = await freshWeek();
    const base = {
      name: "Betriebsurlaub 1079 SM refused",
      startDate: week.day1,
      endDate: week.day2,
    };
    const other = await call(smToken, "POST", "/", { ...base, salonIds: [salonB] });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual({ error: "Salon nicht gefunden" });
    const both = await call(smToken, "POST", "/", { ...base, salonIds: [salonA, salonB] });
    expect(both.statusCode).toBe(404);
    expect(both.body).toBe(other.body);
    const wide = await call(smToken, "POST", "/", base);
    expect(wide.statusCode).toBe(403);
    expect(wide.json().code).toBe("COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN");
    expect(
      await app.prisma.companyShutdown.count({
        where: { tenantId: data.tenant.id, name: base.name },
      }),
    ).toBe(0);
  });

  it("paid release without Urlaubsabzug needs whole-tenant reach: create and switch are 403, nothing written", async () => {
    const week = await freshWeek();
    const res = await call(smToken, "POST", "/", {
      name: "Betriebsurlaub 1079 SM release",
      startDate: week.day1,
      endDate: week.day2,
      salonIds: [salonA],
      deductsFromVacation: false,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("COMPANY_SHUTDOWN_RELEASE_FORBIDDEN");
    expect(
      await app.prisma.companyShutdown.count({
        where: { tenantId: data.tenant.id, name: "Betriebsurlaub 1079 SM release" },
      }),
    ).toBe(0);

    const own = await call(smToken, "POST", "/", {
      name: "Betriebsurlaub 1079 SM switch",
      startDate: week.day1,
      endDate: week.day2,
      salonIds: [salonA],
    });
    expect(own.statusCode, own.body).toBe(201);
    const switched = await call(smToken, "PATCH", `/${own.json().id}`, {
      deductsFromVacation: false,
    });
    expect(switched.statusCode).toBe(403);
    expect(switched.json().code).toBe("COMPANY_SHUTDOWN_RELEASE_FORBIDDEN");
    const stored = await app.prisma.companyShutdown.findUniqueOrThrow({
      where: { id: own.json().id },
    });
    expect(stored.deductsFromVacation).toBe(true);

    // The whole-tenant admin is unaffected by the rule.
    const adminWeek = await freshWeek();
    const adminRes = await call(data.adminToken, "POST", "/", {
      name: "Betriebsurlaub 1079 admin release",
      startDate: adminWeek.day1,
      endDate: adminWeek.day2,
      salonIds: [salonA],
      deductsFromVacation: false,
    });
    expect(adminRes.statusCode, adminRes.body).toBe(201);
  });

  it("PATCH and DELETE: her A shutdown works, the Unternehmen's is 403, B's and A+B's are 404", async () => {
    const wide = await adminCreate(await freshWeek());
    const b = await adminCreate(await freshWeek(), [salonB]);
    const ab = await adminCreate(await freshWeek(), [salonA, salonB]);
    const mine = await adminCreate(await freshWeek(), [salonA]);

    const patchWide = await call(smToken, "PATCH", `/${wide}`, { name: "X" });
    expect(patchWide.statusCode).toBe(403);
    expect(patchWide.json().code).toBe("COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN");
    expect((await call(smToken, "DELETE", `/${wide}`)).statusCode).toBe(403);

    for (const id of [b, ab]) {
      const patched = await call(smToken, "PATCH", `/${id}`, { name: "X" });
      expect(patched.statusCode).toBe(404);
      expect(patched.json()).toEqual({ message: "Nicht gefunden" });
      expect((await call(smToken, "DELETE", `/${id}`)).statusCode).toBe(404);
    }

    // Widening her own shutdown onto B needs B in her reach: refused, nothing changed.
    const widen = await call(smToken, "PATCH", `/${mine}`, { salonIds: [salonA, salonB] });
    expect(widen.statusCode).toBe(404);
    expect(
      (await app.prisma.companyShutdownSalon.findMany({ where: { shutdownId: mine } })).map(
        (row) => row.salonId,
      ),
    ).toEqual([salonA]);

    expect((await call(smToken, "PATCH", `/${mine}`, { name: "Umbenannt" })).statusCode).toBe(200);
    expect((await call(smToken, "DELETE", `/${mine}`)).statusCode).toBe(204);
    // Everything of the others is still there.
    expect(
      await app.prisma.companyShutdown.count({
        where: { id: { in: [wide, b, ab] }, deletedAt: null },
      }),
    ).toBe(3);
  });

  it("exceptions: a person homed in A is accepted, a person homed in B answers the unknown-person 404", async () => {
    const week = await freshWeek();
    const mine = await call(smToken, "POST", "/", {
      name: "Betriebsurlaub 1079 SM exceptions",
      startDate: week.day1,
      endDate: week.day2,
      salonIds: [salonA],
    });
    expect(mine.statusCode, mine.body).toBe(201);
    const id = mine.json().id as string;

    const foreign = await call(smToken, "POST", `/${id}/exceptions`, { employeeId: pB });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ message: "Mitarbeiter nicht gefunden" });
    const own = await call(smToken, "POST", `/${id}/exceptions`, { employeeId: pA });
    expect(own.statusCode, own.body).toBe(201);
    expect((await call(smToken, "DELETE", `/${id}/exceptions/${pA}`)).statusCode).toBe(204);

    // An exception route on the Unternehmen's shutdown is 403, on B's it is 404.
    const wide = await adminCreate(await freshWeek());
    expect(
      (await call(smToken, "POST", `/${wide}/exceptions`, { employeeId: pA })).statusCode,
    ).toBe(403);
    const b = await adminCreate(await freshWeek(), [salonB]);
    expect((await call(smToken, "POST", `/${b}/exceptions`, { employeeId: pA })).statusCode).toBe(
      404,
    );
  });

  it("GET /scope offers only her salon; GET / marks canManage only on the shutdowns she can manage", async () => {
    const scope = (await call(smToken, "GET", "/scope")).json();
    expect(scope.canManageAllSalons).toBe(false);
    expect(scope.salons.map((salon: { id: string }) => salon.id)).toEqual([salonA]);

    const rows = (await call(smToken, "GET", "/")).json() as Array<{
      salons: Array<{ id: string }>;
      canManage: boolean;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const ids = row.salons.map((salon) => salon.id);
      expect(row.canManage).toBe(ids.length > 0 && ids.every((id) => id === salonA));
    }
    expect(rows.some((row) => row.canManage)).toBe(true);
    expect(rows.some((row) => !row.canManage)).toBe(true);
  });
});
