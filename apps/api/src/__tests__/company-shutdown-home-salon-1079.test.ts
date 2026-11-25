/**
 * Issue #1079 (D-07) - a Stammsalon change re-books the moved person for the salon-scoped
 * Betriebsurlaube: generated rows of days no longer in a named salon are cancelled (Urlaub booked
 * back), days newly in a named salon are booked, in two phases so a newly affected shutdown never
 * finds days still held by the one the person left. Nothing is written when the person's affected
 * days do not change; an unternehmensweit Betriebsurlaub is never touched; the route answer is the
 * unchanged 201 even when the re-booking fails.
 *
 * Fixture: tenant one with salons A (the seed salon), B, C and D; the seeded admin (whole-tenant
 * reach) changes the Stammsalon. Every shutdown week is a Monday and Tuesday of one open month, at
 * least 40 days ahead (tenant-local today), with no holiday asserted. No person names.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import { bookCompanyShutdownsForHire } from "../contexts/absence/company-shutdown/booking";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

type Week = { day1: string; day2: string };

describe("Issue #1079 - a Stammsalon change follows the salon-scoped Betriebsurlaube", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let salonA: string;
  let salonB: string;
  let salonC: string;
  let salonD: string;
  let nextMonday: Date;
  let year: number;

  function authed() {
    return { authorization: `Bearer ${data.adminToken}` };
  }

  async function homedPerson(label: string, salonId: string) {
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
        lastName: "Home1079",
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
    await seedEntitlementYears(app, {
      employeeId: employee.id,
      leaveTypeId: data.vacationType.id,
      years: [year, year + 1],
      totalDays: 30,
    });
    return employee.id;
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

  async function shutdown(week: Week, salonIds: string[] | undefined, name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/company-shutdowns",
      headers: authed(),
      payload: {
        name,
        startDate: week.day1,
        endDate: week.day2,
        ...(salonIds ? { salonIds } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  function changeHome(employeeId: string, salonId: string, validFrom: string) {
    return app.inject({
      method: "POST",
      url: `/api/v1/employees/${employeeId}/salon-assignments/home`,
      headers: authed(),
      payload: { salonId, validFrom },
    });
  }

  async function activeAbsences(employeeId: string, shutdownId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId, deletedAt: null },
      orderBy: { startDate: "asc" },
    });
  }

  async function usedDays(employeeId: string): Promise<number> {
    const row = await app.prisma.leaveEntitlement.findFirstOrThrow({
      where: { employeeId, year, leaveType: { code: "VACATION" } },
    });
    return Number(row.usedDays);
  }

  async function summaryRows(shutdownId: string) {
    return app.prisma.auditLog.count({
      where: {
        entity: "CompanyShutdown",
        entityId: shutdownId,
        action: { in: ["COMPANY_SHUTDOWN_BOOKED", "COMPANY_SHUTDOWN_REVERSED"] },
      },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "csh1079");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Home1079 B" })).id;
    salonC = (await createTestSalon(app.prisma, data.tenant.id, { name: "Home1079 C" })).id;
    salonD = (await createTestSalon(app.prisma, data.tenant.id, { name: "Home1079 D" })).id;
    let monday = plusDays(todayInTz(tz), 40);
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    nextMonday = monday;
    year = monday.getUTCFullYear();
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("company-shutdown-home-salon-1079 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("a move out of the closed salon in the middle of the closure re-books the person for the A days only", async () => {
    const week = await freshWeek();
    const person = await homedPerson("mv", salonA);
    const closure = await shutdown(week, [salonA], "Betriebsurlaub 1079 hook A");
    const before = await activeAbsences(person, closure);
    expect(before).toHaveLength(1);
    expect(iso(before[0].endDate)).toBe(week.day2);
    const usedBefore = await usedDays(person);

    const res = await changeHome(person, salonB, week.day2);
    expect(res.statusCode, res.body).toBe(201);
    expect(Object.keys(res.json()).sort()).toEqual(["created", "ended"]);

    const after = await activeAbsences(person, closure);
    expect(after).toHaveLength(1);
    expect(iso(after[0].startDate)).toBe(week.day1);
    expect(iso(after[0].endDate)).toBe(week.day1);
    // The two-day request was cancelled (booked back), a one-day request replaces it.
    const requests = await app.prisma.leaveRequest.findMany({
      where: { employeeId: person, companyShutdownId: closure },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(requests.map((r) => [r.status, Number(r.days)])).toEqual([
      ["CANCELLED", 2],
      ["APPROVED", 1],
    ]);
    expect(await usedDays(person)).toBe(usedBefore - 1);

    const reversal = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: closure, action: "COMPANY_SHUTDOWN_REVERSED" },
    });
    expect(reversal.newValue).toMatchObject({ reason: "HOME_SALON_CHANGED" });
  });

  it("a move into the closed salon books the A days and releases the B rows of the same days first", async () => {
    const week = await freshWeek();
    const person = await homedPerson("in", salonB);
    const closureA = await shutdown(week, [salonA], "Betriebsurlaub 1079 hook in A");
    const closureB = await shutdown(week, [salonB], "Betriebsurlaub 1079 hook in B");
    expect(await activeAbsences(person, closureB)).toHaveLength(1);
    expect(await activeAbsences(person, closureA)).toHaveLength(0);
    const usedBefore = await usedDays(person);

    const res = await changeHome(person, salonA, week.day1);
    expect(res.statusCode, res.body).toBe(201);

    expect(await activeAbsences(person, closureB)).toHaveLength(0);
    const nowA = await activeAbsences(person, closureA);
    expect(nowA).toHaveLength(1);
    expect(iso(nowA[0].startDate)).toBe(week.day1);
    expect(iso(nowA[0].endDate)).toBe(week.day2);
    // No day is held by both shutdowns: the Urlaub of B was booked back before A booked its own.
    expect(await usedDays(person)).toBe(usedBefore);
    expect(
      await app.prisma.leaveRequest.count({
        where: { employeeId: person, companyShutdownId: closureB, status: "APPROVED" },
      }),
    ).toBe(0);
    expect(
      await app.prisma.leaveRequest.count({
        where: { employeeId: person, companyShutdownId: closureA, status: "APPROVED" },
      }),
    ).toBe(1);
  });

  it("a change that does not alter the affected days books and cancels nothing and writes no summary row", async () => {
    const week = await freshWeek();
    const person = await homedPerson("none", salonC);
    const closure = await shutdown(week, [salonA], "Betriebsurlaub 1079 hook none");
    const summaryBefore = await summaryRows(closure);
    const absencesBefore = await app.prisma.absence.count({
      where: { companyShutdownId: closure },
    });
    expect(await activeAbsences(person, closure)).toHaveLength(0);

    // Between two salons outside the closure.
    const res = await changeHome(person, salonD, week.day1);
    expect(res.statusCode, res.body).toBe(201);
    expect(await summaryRows(closure)).toBe(summaryBefore);
    expect(await app.prisma.absence.count({ where: { companyShutdownId: closure } })).toBe(
      absencesBefore,
    );
    expect(await app.prisma.absence.count({ where: { employeeId: person } })).toBe(0);

    // A change after the closure.
    const mover = await homedPerson("late", salonA);
    const closure2 = await shutdown(await freshWeek(), [salonA], "Betriebsurlaub 1079 hook late");
    const summary2 = await summaryRows(closure2);
    const absence2 = await activeAbsences(mover, closure2);
    expect(absence2).toHaveLength(1);
    const late = iso(plusDays(new Date(absence2[0].endDate), 3));
    const lateRes = await changeHome(mover, salonB, late);
    expect(lateRes.statusCode, lateRes.body).toBe(201);
    expect(await summaryRows(closure2)).toBe(summary2);
    expect((await activeAbsences(mover, closure2))[0].id).toBe(absence2[0].id);
  });

  it("an unternehmensweit Betriebsurlaub is never touched by a Stammsalon change", async () => {
    const week = await freshWeek();
    const person = await homedPerson("wide", salonA);
    const wide = await shutdown(week, undefined, "Betriebsurlaub 1079 hook wide");
    const absence = await activeAbsences(person, wide);
    expect(absence).toHaveLength(1);
    const summary = await summaryRows(wide);

    const res = await changeHome(person, salonB, week.day2);
    expect(res.statusCode, res.body).toBe(201);
    const after = await activeAbsences(person, wide);
    expect(after.map((row) => row.id)).toEqual([absence[0].id]);
    expect(iso(after[0].endDate)).toBe(week.day2);
    expect(await summaryRows(wide)).toBe(summary);
  });

  it("a hire books a salon-scoped Betriebsurlaub only for a person homed in its salons and writes no empty summary for the others", async () => {
    const week = await freshWeek();
    const closure = await shutdown(week, [salonA], "Betriebsurlaub 1079 hire");
    const summary = await summaryRows(closure);
    const actor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" as const },
      approveReach: { kind: "wholeTenant" as const },
      mayCreateOwn: true,
    };
    const request = { ip: "127.0.0.1", headers: {} as Record<string, string> };

    const outsider = await homedPerson("hire-b", salonB);
    await bookCompanyShutdownsForHire(app, {
      tenantId: data.tenant.id,
      employeeId: outsider,
      resolveActor: async () => actor,
      request,
    });
    expect(await summaryRows(closure)).toBe(summary);
    expect(await activeAbsences(outsider, closure)).toHaveLength(0);

    const insider = await homedPerson("hire-a", salonA);
    await bookCompanyShutdownsForHire(app, {
      tenantId: data.tenant.id,
      employeeId: insider,
      resolveActor: async () => actor,
      request,
    });
    expect(await activeAbsences(insider, closure)).toHaveLength(1);
    expect(await summaryRows(closure)).toBe(summary + 1);
  });

  it("a failing re-booking is logged and the answer is still the 201", async () => {
    const week = await freshWeek();
    const person = await homedPerson("fail", salonA);
    await shutdown(week, [salonA], "Betriebsurlaub 1079 hook fail");
    const logged = vi.spyOn(app.log, "error");
    const failing = vi
      .spyOn(app.prisma.companyShutdown, "findMany")
      .mockRejectedValueOnce(new Error("boom"));
    try {
      const res = await changeHome(person, salonB, week.day2);
      expect(res.statusCode, res.body).toBe(201);
      expect(failing).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: data.tenant.id, employeeId: person }),
        expect.any(String),
      );
    } finally {
      failing.mockRestore();
      logged.mockRestore();
    }
  });
});
