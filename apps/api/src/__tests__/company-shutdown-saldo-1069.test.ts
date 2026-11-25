/**
 * Issue #1069 (D-02, O-3, O-4) - the Soll proof of a Betriebsurlaub end to end: with one day of
 * Resturlaub left and a Monday-Wednesday shutdown in an open past month, the monthly report shows
 * the Urlaub day, a Soll without the three shutdown workdays and no minus for the shutdown days,
 * and closing the month through the existing close path stores exactly those expected minutes.
 *
 * Soll goes through the one close core (`closeEmployeeMonth`); the booking only writes the leave
 * request (Monday) and the COMPANY_SHUTDOWN absence (Monday to Wednesday). A control person of the
 * same contract and hire day with no booking gives the unreduced Soll the figures are measured
 * against. All dates come from the tenant-local today; the window is a Monday-Wednesday of the
 * previous calendar month without a holiday (asserted). No person names.
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
  seedEntitlementYears,
} from "./setup";
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import {
  bookCompanyShutdown,
  type ShutdownActor,
} from "../contexts/absence/company-shutdown/booking";

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date): string => date.toISOString().slice(0, 10);
const plusDays = (date: Date, n: number): Date => new Date(date.getTime() + n * DAY_MS);

describe("Issue #1069 - a Betriebsurlaub day reduces the Soll exactly once, end to end", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let tz: string;
  let actor: ShutdownActor;
  let year: number;
  let month: number; // 1-based, the previous calendar month
  let monday: Date;
  let monthStart: Date;
  let shutdownId: string;
  let booked: { userId: string; employeeId: string };
  let control: { userId: string; employeeId: string };

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
        tenantId,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: label,
        lastName: "Saldo1069",
        // Hired on the 1st of the month under test: no earlier month has to be closed first.
        hireDate: monthStart,
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
        validFrom: monthStart,
      },
    });
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId,
        employeeId: employee.id,
        salonId: data.salonId,
        kind: "HOME",
        validFrom: monthStart,
        validUntil: null,
        weekdays: [],
      },
    });
    await seedEntitlementYears(app, {
      employeeId: employee.id,
      leaveTypeId: data.vacationType.id,
      years: [year],
      totalDays: 1,
    });
    return { userId: user.id, employeeId: employee.id };
  }

  async function monthlyRow(employeeId: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/monthly?year=${year}&month=${month}&employeeId=${employeeId}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).rows as Array<{
      employeeId: string;
      shouldHours: number | null;
      overtimeHours: number | null;
      vacationDays: number | null;
    }>;
    const row = rows.find((r) => r.employeeId === employeeId);
    expect(row).toBeDefined();
    return row!;
  }

  async function closeMonth(employeeId: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/overtime/close-month",
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { employeeId, year, month, confirmGaps: true },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return app.prisma.saldoSnapshot.findFirstOrThrow({
      where: { employeeId, periodType: "MONTHLY", superseded: false },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cs1069s");
    tenantId = data.tenant.id;
    tz = await getTenantTimezone(app.prisma, tenantId);
    actor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" },
      approveReach: { kind: "wholeTenant" },
      mayCreateOwn: true,
    };

    // The previous calendar month (open: nothing closes it but this test) and its first Monday
    // whose Monday-Friday week lies inside the month and holds no holiday.
    const today = todayInTz(tz);
    const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth() + 1;
    monthStart = prev;
    let cursor = prev;
    for (;;) {
      while (cursor.getUTCDay() !== 1) cursor = plusDays(cursor, 1);
      const friday = plusDays(cursor, 4);
      if (friday.getUTCMonth() === prev.getUTCMonth()) {
        const holidays = await getHolidayMap(app.prisma, tenantId, null, cursor, friday);
        if (holidays.size === 0) break;
      }
      cursor = plusDays(cursor, 7);
      if (cursor.getUTCMonth() !== prev.getUTCMonth()) throw new Error("no holiday-free week");
    }
    monday = cursor;

    booked = await rawPerson("saldo-booked");
    control = await rawPerson("saldo-control");
    const shutdown = await app.prisma.companyShutdown.create({
      data: {
        tenantId,
        name: `Betriebsurlaub 1069 ${crypto.randomBytes(3).toString("hex")}`,
        startDate: monday,
        endDate: plusDays(monday, 2),
        deductsFromVacation: true,
      },
    });
    shutdownId = shutdown.id;
    const outcome = await bookCompanyShutdown(app, {
      tenantId,
      shutdownId,
      actor,
      employeeIds: [booked.employeeId],
      request: { ip: "127.0.0.1", headers: {} },
    });
    if (!outcome.ok) throw new Error(`booking refused: ${outcome.code}`);
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("company-shutdown-saldo-1069 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("books one Urlaub day (Monday) and the absence over the three days", async () => {
    const requests = await app.prisma.leaveRequest.findMany({
      where: { employeeId: booked.employeeId, companyShutdownId: shutdownId },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("APPROVED");
    expect(Number(requests[0].days)).toBe(1);
    expect(iso(requests[0].startDate)).toBe(iso(monday));
    const absences = await app.prisma.absence.findMany({
      where: { employeeId: booked.employeeId, companyShutdownId: shutdownId, deletedAt: null },
    });
    expect(absences).toHaveLength(1);
    expect(iso(absences[0].endDate)).toBe(iso(plusDays(monday, 2)));
  });

  it("the monthly report shows the Urlaub day and a Soll without the three shutdown workdays - no minus for them", async () => {
    const withShutdown = await monthlyRow(booked.employeeId);
    const without = await monthlyRow(control.employeeId);
    expect(withShutdown.vacationDays).toBe(1);
    expect(without.vacationDays).toBe(0);
    // Three contract workdays of 8 h leave the Soll, once each (Urlaub Monday + release Tue/Wed).
    expect(without.shouldHours! - withShutdown.shouldHours!).toBe(24);
    // Nothing worked by either person: the balance of the booked person is exactly 24 h better, so
    // the shutdown days contribute 0 - neither the unreduced Soll (a minus) nor a double reduction.
    expect(withShutdown.overtimeHours! - without.overtimeHours!).toBe(24);
  });

  it("closing the month stores the same expected minutes the report shows", async () => {
    const reportBooked = await monthlyRow(booked.employeeId);
    const reportControl = await monthlyRow(control.employeeId);
    const snapshotBooked = await closeMonth(booked.employeeId);
    const snapshotControl = await closeMonth(control.employeeId);

    expect(snapshotBooked.expectedMinutes).toBe(Math.round(reportBooked.shouldHours! * 60));
    expect(snapshotControl.expectedMinutes - snapshotBooked.expectedMinutes).toBe(3 * 480);
    expect(snapshotBooked.balanceMinutes - snapshotControl.balanceMinutes).toBe(3 * 480);
    expect(snapshotControl.expectedMinutes).toBe(Math.round(reportControl.shouldHours! * 60));
  });
});
