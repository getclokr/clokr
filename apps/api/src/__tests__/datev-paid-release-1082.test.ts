/**
 * Issue #1082 (tracer) - a configured Lohnart "Bezahlte Freistellung" puts the paid release days of
 * a Betriebsurlaub on their own DATEV row.
 *
 * Fixture: one raw person (FIXED 40 h Mo-Fr, numeric personnel number, hired on the 1st of the
 * previous calendar month, HOME salon assignment) and a Betriebsurlaub WITHOUT vacation deduction
 * over a Monday-Wednesday of that month with no holiday (asserted, not assumed). Without a deduction
 * the three days are paid release: the booking writes the COMPANY_SHUTDOWN absence and no Urlaub.
 * All dates come from the tenant-local today. No person names.
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
  configureDatevKanzlei,
  numericEmployeeNumber,
} from "./setup";
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import {
  bookCompanyShutdown,
  type ShutdownActor,
} from "../contexts/absence/company-shutdown/booking";
import { rowsOf, type DatevRow } from "./datev-rows";

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (date: Date, n: number): Date => new Date(date.getTime() + n * DAY_MS);
const FREISTELLUNG_NR = 305;

describe("Issue #1082 - the paid release days of a Betriebsurlaub on their own DATEV row (tracer)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let year: number;
  let month: number;
  let monthStart: Date;
  let person: { employeeId: string; employeeNumber: string };

  async function datevRows(): Promise<DatevRow[]> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/datev?year=${year}&month=${month}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return rowsOf(res.rawPayload);
  }

  async function setLohnart(nr: number | null) {
    await app.prisma.tenantConfig.update({
      where: { tenantId },
      data: { datevFreistellungNr: nr },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "dv1082t");
    tenantId = data.tenant.id;
    await configureDatevKanzlei(app, tenantId);
    const tz = await getTenantTimezone(app.prisma, tenantId);

    const today = todayInTz(tz);
    monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    year = monthStart.getUTCFullYear();
    month = monthStart.getUTCMonth() + 1;

    // First Monday of the previous month whose Monday-Friday week lies inside it without a holiday.
    let monday = monthStart;
    for (;;) {
      while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
      const friday = plusDays(monday, 4);
      if (friday.getUTCMonth() === monthStart.getUTCMonth()) {
        const holidays = await getHolidayMap(app.prisma, tenantId, null, monday, friday);
        if (holidays.size === 0) break;
      }
      monday = plusDays(monday, 7);
      if (monday.getUTCMonth() !== monthStart.getUTCMonth())
        throw new Error("no holiday-free week");
    }

    const user = await app.prisma.user.create({
      data: {
        email: `rel-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: numericEmployeeNumber(),
        firstName: "Rel",
        lastName: "Freistellung1082",
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
    person = { employeeId: employee.id, employeeNumber: employee.employeeNumber };

    const shutdown = await app.prisma.companyShutdown.create({
      data: {
        tenantId,
        name: `Betriebsurlaub 1082 ${crypto.randomBytes(3).toString("hex")}`,
        startDate: monday,
        endDate: plusDays(monday, 2),
        deductsFromVacation: false,
      },
    });
    const actor: ShutdownActor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" },
      approveReach: { kind: "wholeTenant" },
      mayCreateOwn: true,
    };
    const outcome = await bookCompanyShutdown(app, {
      tenantId,
      shutdownId: shutdown.id,
      actor,
      employeeIds: [person.employeeId],
      request: { ip: "127.0.0.1", headers: {} },
    });
    if (!outcome.ok) throw new Error(`booking refused: ${outcome.code}`);
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("datev-paid-release-1082 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("books the absence and no Urlaub: the three days are paid release", async () => {
    expect(
      await app.prisma.absence.count({
        where: { employeeId: person.employeeId, type: "COMPANY_SHUTDOWN", deletedAt: null },
      }),
    ).toBe(1);
    expect(await app.prisma.leaveRequest.count({ where: { employeeId: person.employeeId } })).toBe(
      0,
    );
  });

  it("with the Lohnart set the person has exactly one Tage row with the three release days", async () => {
    await setLohnart(FREISTELLUNG_NR);
    const rows = await datevRows();
    expect(rows.length).toBeGreaterThan(0); // not vacuous
    const mine = rows.filter((r) => r.pnr === person.employeeNumber && r.lohnart === "305");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      satzId: "21",
      zeitraum: `01${String(month).padStart(2, "0")}${year}`,
      menge: "3,0",
      kind: "tage",
    });
  });

  it("with the Lohnart cleared the person has no row on that number", async () => {
    // Not vacuous: the previous test proves the same person HAS the row with the number set; nobody
    // here has worked hours, so the cleared file carries no row of this person at all.
    await setLohnart(null);
    const rows = await datevRows();
    expect(rows.filter((r) => r.pnr === person.employeeNumber && r.lohnart === "305")).toHaveLength(
      0,
    );
  });
});
