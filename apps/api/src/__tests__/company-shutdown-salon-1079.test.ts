/**
 * Issue #1079 (tracer) - a Betriebsurlaub can name salons. It books, through the one #1069 booking
 * module, exactly the persons whose Stammsalon (HOME assignment) is a named salon on the day, day by
 * day; a Betriebsurlaub without salons keeps the #1069 behaviour. Two active Betriebsurlaube conflict
 * only when they share a day AND their scopes meet.
 *
 * Fixture: tenant one with salon A (the seed salon) and salon B, a second tenant with a foreign salon.
 * Persons: pA (homed in A), pB (homed in B), mover (A until day 1, B from day 2 of the mover week).
 * Every shutdown week is a Monday and Tuesday of one open month, at least 40 days ahead (tenant-local
 * today), with no holiday asserted. No person names.
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
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000001";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

describe("Issue #1079 - a Betriebsurlaub per salon", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let foreign: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let salonA: string;
  let salonB: string;
  let inactiveSalon: string;
  let foreignSalon: string;
  let pA: string;
  let pB: string;
  let mover: string;
  /** Next free Monday + Tuesday pair (weeks never repeat inside this file). */
  let nextMonday: Date;

  function authed(token: string) {
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
        lastName: "Salon1079",
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

  async function home(
    employeeId: string,
    salonId: string,
    validFrom: string,
    validUntil: string | null,
  ) {
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: new Date(`${validFrom}T00:00:00Z`),
        validUntil: validUntil ? new Date(`${validUntil}T00:00:00Z`) : null,
        weekdays: [],
      },
    });
  }

  /** A Monday + Tuesday pair of one month, no holiday at either salon, on a fresh week. */
  async function freshWeek(): Promise<{ day1: string; day2: string }> {
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

  async function post(payload: Record<string, unknown>, token = data.adminToken) {
    return app.inject({
      method: "POST",
      url: "/api/v1/company-shutdowns",
      headers: authed(token),
      payload,
    });
  }

  async function absencesOf(employeeId: string, shutdownId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId, deletedAt: null },
      orderBy: { startDate: "asc" },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "css1079a");
    foreign = await seedTestData(app, "css1079b");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Salon1079 B" })).id;
    inactiveSalon = (
      await createTestSalon(app.prisma, data.tenant.id, { name: "Salon1079 X", isActive: false })
    ).id;
    foreignSalon = foreign.salonId;

    let monday = plusDays(todayInTz(tz), 40);
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    nextMonday = monday;

    pA = data.employee.id;
    pB = await rawPerson("pb");
    mover = await rawPerson("mv");
    await home(pA, salonA, "2024-01-01", null);
    await home(pB, salonB, "2024-01-01", null);

    // Entitlements for every person and every year the weeks below can touch.
    const year = monday.getUTCFullYear();
    for (const employeeId of [pA, pB, mover, data.adminEmployee.id]) {
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
      await cleanupTestData(app, foreign.tenant.id);
    } catch (err) {
      console.error("company-shutdown-salon-1079 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("books only the Stammsalon persons of the named salon: absence and an APPROVED linked Urlaub", async () => {
    const { day1, day2 } = await freshWeek();
    const res = await post({
      name: "Betriebsurlaub 1079 A",
      startDate: day1,
      endDate: day2,
      salonIds: [salonA],
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.salons).toEqual([{ id: salonA, name: expect.any(String), isActive: true }]);
    expect(body.booking).toMatchObject({ persons: 1, absencesWritten: 1, vacationApproved: 1 });

    const mine = await absencesOf(pA, body.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("COMPANY_SHUTDOWN");
    expect(iso(mine[0].startDate)).toBe(day1);
    expect(iso(mine[0].endDate)).toBe(day2);
    const request = await app.prisma.leaveRequest.findFirstOrThrow({
      where: { employeeId: pA, companyShutdownId: body.id, deletedAt: null },
    });
    expect(request.status).toBe("APPROVED");
    expect(Number(request.days)).toBe(2);

    // The person of the other salon and the actor (no Stammsalon) get nothing.
    expect(await absencesOf(pB, body.id)).toHaveLength(0);
    expect(await absencesOf(data.adminEmployee.id, body.id)).toHaveLength(0);
    expect(
      await app.prisma.leaveRequest.count({
        where: { companyShutdownId: body.id, employeeId: { not: pA } },
      }),
    ).toBe(0);

    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: body.id, action: "CREATE" },
    });
    expect(audit.newValue).toMatchObject({ salonIds: [salonA] });
    const stored = await app.prisma.companyShutdownSalon.findMany({
      where: { shutdownId: body.id },
    });
    expect(stored.map((row) => row.salonId)).toEqual([salonA]);
  });

  it("a person whose Stammsalon changes inside the period is booked only for the days in the named salon", async () => {
    const { day1, day2 } = await freshWeek();
    await home(mover, salonA, "2024-01-01", day1);
    await home(mover, salonB, day2, null);

    const res = await post({
      name: "Betriebsurlaub 1079 mover",
      startDate: day1,
      endDate: day2,
      salonIds: [salonA],
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().id as string;

    const absences = await absencesOf(mover, id);
    expect(absences).toHaveLength(1);
    expect(iso(absences[0].startDate)).toBe(day1);
    expect(iso(absences[0].endDate)).toBe(day1);
    const request = await app.prisma.leaveRequest.findFirstOrThrow({
      where: { employeeId: mover, companyShutdownId: id, deletedAt: null },
    });
    expect(iso(request.startDate)).toBe(day1);
    expect(iso(request.endDate)).toBe(day1);
    expect(Number(request.days)).toBe(1);

    // The B closure of the same days books the mover for the B day only.
    const other = await post({
      name: "Betriebsurlaub 1079 mover B",
      startDate: day1,
      endDate: day2,
      salonIds: [salonB],
    });
    expect(other.statusCode, other.body).toBe(201);
    const bAbsences = await absencesOf(mover, other.json().id);
    expect(bAbsences).toHaveLength(1);
    expect(iso(bAbsences[0].startDate)).toBe(day2);
    expect(iso(bAbsences[0].endDate)).toBe(day2);
  });

  it("without salonIds the whole Unternehmen is booked exactly as before, one segment per month", async () => {
    const { day1, day2 } = await freshWeek();
    const res = await post({ name: "Betriebsurlaub 1079 all", startDate: day1, endDate: day2 });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.salons).toEqual([]);
    expect(body.booking.persons).toBe(4);
    for (const employeeId of [pA, pB, mover, data.adminEmployee.id]) {
      const absences = await absencesOf(employeeId, body.id);
      expect(absences).toHaveLength(1);
      expect(iso(absences[0].startDate)).toBe(day1);
      expect(iso(absences[0].endDate)).toBe(day2);
    }
    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: body.id, action: "CREATE" },
    });
    expect(audit.newValue).toMatchObject({ salonIds: [] });
  });

  it("answers one 404 body for a foreign, unknown or inactive salon and writes nothing", async () => {
    const { day1, day2 } = await freshWeek();
    const before = await app.prisma.companyShutdown.count({ where: { tenantId: data.tenant.id } });
    const bodies: string[] = [];
    for (const salonId of [foreignSalon, UNKNOWN_ID, inactiveSalon]) {
      const res = await post({
        name: "Betriebsurlaub 1079 404",
        startDate: day1,
        endDate: day2,
        salonIds: [salonA, salonId],
      });
      expect(res.statusCode).toBe(404);
      bodies.push(res.body);
    }
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify({ error: "Salon nicht gefunden" })]));
    expect(await app.prisma.companyShutdown.count({ where: { tenantId: data.tenant.id } })).toBe(
      before,
    );
    expect(await app.prisma.companyShutdownSalon.count({ where: { salonId: foreignSalon } })).toBe(
      0,
    );
  });

  it("refuses an overlap only when the scopes meet (409 COMPANY_SHUTDOWN_OVERLAP)", async () => {
    const { day1, day2 } = await freshWeek();
    const make = (salonIds?: string[]) =>
      post({ name: "Betriebsurlaub 1079 overlap", startDate: day1, endDate: day2, salonIds });

    expect((await make([salonA])).statusCode).toBe(201);
    // A different salon on the same days is a different scope.
    expect((await make([salonB])).statusCode).toBe(201);
    // A+B meets both, the Unternehmen meets both.
    for (const salonIds of [[salonA, salonB], [salonA], undefined]) {
      const res = await make(salonIds);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().code).toBe("COMPANY_SHUTDOWN_OVERLAP");
    }

    // And the other way round: an unternehmensweit one blocks every salon on its days.
    const week2 = await freshWeek();
    const wide = await post({
      name: "Betriebsurlaub 1079 wide",
      startDate: week2.day1,
      endDate: week2.day2,
    });
    expect(wide.statusCode, wide.body).toBe(201);
    const narrow = await post({
      name: "Betriebsurlaub 1079 narrow",
      startDate: week2.day1,
      endDate: week2.day2,
      salonIds: [salonA],
    });
    expect(narrow.statusCode).toBe(409);
    expect(narrow.json().code).toBe("COMPANY_SHUTDOWN_OVERLAP");
  });
});
