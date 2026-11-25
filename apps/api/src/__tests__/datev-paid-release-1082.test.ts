/**
 * Issue #1082 - the Lohnart "Bezahlte Freistellung": the paid release days of a Betriebsurlaub
 * (COMPANY_SHUTDOWN days no other line pays) on their own DATEV row, the same figure in the
 * Monatsexport, and an unchanged file without the Lohnart.
 *
 * Fixtures are raw persons (FIXED 40 h Mo-Fr unless stated, numeric personnel number, hired on the
 * 1st of the previous calendar month, HOME salon assignment) and Betriebsurlaube booked through
 * `bookCompanyShutdown` over a holiday-free window of that month (asserted, never assumed). All
 * dates come from the tenant-local today. No person names.
 *
 * Three describes, three tenants:
 *   - the day rules end to end (P1 plain, P2 on the exception list, P3 with work and sickness on
 *     two shutdown days, P4 with a Berufsschultag), both DATEV routes, the Monatsexport and the
 *     byte proof of AC5;
 *   - a manual public holiday inside the window;
 *   - a SHIFT_BASED contract.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import iconv from "iconv-lite";
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
import { ensureLeaveType } from "../contexts/absence/ensure-leave-type";
import {
  bookCompanyShutdown,
  type ShutdownActor,
} from "../contexts/absence/company-shutdown/booking";
import { rowsOf, decodeDatev, type DatevRow } from "./datev-rows";
import * as pdfUtils from "../composition/pdf";

vi.mock("../composition/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../composition/pdf")>();
  return { ...actual, generateMonthlyExportPdf: vi.fn(actual.generateMonthlyExportPdf) };
});

type ExportPayload = Parameters<typeof pdfUtils.generateMonthlyExportPdf>[0];

let app: FastifyInstance;

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (date: Date, n: number): Date => new Date(date.getTime() + n * DAY_MS);
const FREISTELLUNG_NR = 305;
const FREISTELLUNG_LOHNART = String(FREISTELLUNG_NR);

type Seed = Awaited<ReturnType<typeof seedTestData>>;
type Person = { employeeId: string; userId: string; employeeNumber: string };

/** The previous calendar month of the tenant-local today (open: nothing closes it here). */
async function previousMonth(app: FastifyInstance, tenantId: string) {
  const tz = await getTenantTimezone(app.prisma, tenantId);
  const today = todayInTz(tz);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return { monthStart, year: monthStart.getUTCFullYear(), month: monthStart.getUTCMonth() + 1 };
}

/**
 * The first Monday of the month whose week of `days` days (7 = Monday-Sunday, 5 = Monday-Friday)
 * lies inside the month and holds no holiday.
 */
async function holidayFreeMonday(
  app: FastifyInstance,
  tenantId: string,
  monthStart: Date,
  days: number,
): Promise<Date> {
  let monday = monthStart;
  for (;;) {
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    const last = plusDays(monday, days - 1);
    if (last.getUTCMonth() === monthStart.getUTCMonth()) {
      const holidays = await getHolidayMap(app.prisma, tenantId, null, monday, last);
      if (holidays.size === 0) return monday;
    }
    monday = plusDays(monday, 7);
    if (monday.getUTCMonth() !== monthStart.getUTCMonth()) throw new Error("no holiday-free week");
  }
}

async function rawPerson(
  app: FastifyInstance,
  data: Seed,
  label: string,
  monthStart: Date,
  opts: { shiftBased?: boolean } = {},
): Promise<Person> {
  const tenantId = data.tenant.id;
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
      employeeNumber: numericEmployeeNumber(),
      firstName: label,
      lastName: "Freistellung1082",
      hireDate: monthStart,
    },
  });
  await app.prisma.workSchedule.create({
    data: {
      employeeId: employee.id,
      ...(opts.shiftBased
        ? {
            type: "SHIFT_BASED" as const,
            weeklyHours: 24,
            contractWorkDaysPerWeek: 3,
            usualWorkDays: [1, 2, 3],
            workDays: [1, 2, 3],
          }
        : {
            weeklyHours: 40,
            mondayHours: 8,
            tuesdayHours: 8,
            wednesdayHours: 8,
            thursdayHours: 8,
            fridayHours: 8,
            saturdayHours: 0,
            sundayHours: 0,
          }),
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
    years: [monthStart.getUTCFullYear()],
    totalDays: 1,
  });
  return { employeeId: employee.id, userId: user.id, employeeNumber: employee.employeeNumber };
}

function shutdownActor(data: Seed): ShutdownActor {
  return {
    userId: data.adminUser.id,
    employeeId: data.adminEmployee.id,
    createReach: { kind: "wholeTenant" },
    approveReach: { kind: "wholeTenant" },
    mayCreateOwn: true,
  };
}

async function bookShutdown(
  app: FastifyInstance,
  data: Seed,
  window: { start: Date; end: Date; deductsFromVacation: boolean },
  employeeIds: readonly string[],
  beforeBooking?: (shutdownId: string) => Promise<void>,
) {
  const shutdown = await app.prisma.companyShutdown.create({
    data: {
      tenantId: data.tenant.id,
      name: `Betriebsurlaub 1082 ${crypto.randomBytes(3).toString("hex")}`,
      startDate: window.start,
      endDate: window.end,
      deductsFromVacation: window.deductsFromVacation,
    },
  });
  if (beforeBooking) await beforeBooking(shutdown.id);
  const outcome = await bookCompanyShutdown(app, {
    tenantId: data.tenant.id,
    shutdownId: shutdown.id,
    actor: shutdownActor(data),
    employeeIds,
    request: { ip: "127.0.0.1", headers: {} },
  });
  if (!outcome.ok) throw new Error(`booking refused: ${outcome.code}`);
  return shutdown.id;
}

function datevUrl(year: number, month: number): string {
  return `/api/v1/reports/datev?year=${year}&month=${month}`;
}

function rowsFor(rows: DatevRow[], person: Person, lohnart: string): DatevRow[] {
  return rows.filter((r) => r.pnr === person.employeeNumber && r.lohnart === lohnart);
}

// ── The day rules end to end ───────────────────────────────────────────────────

describe("Issue #1082 - paid release days: the day rules, both DATEV routes, the Monatsexport, the byte proof", () => {
  let data: Seed;
  let tenantId: string;
  let year: number;
  let month: number;
  let p1: Person;
  let p2: Person;
  let p3: Person;
  let p4: Person;

  async function setLohnart(nr: number | null) {
    await app.prisma.tenantConfig.update({
      where: { tenantId },
      data: { datevFreistellungNr: nr },
    });
  }

  async function datevBuffer(): Promise<Buffer> {
    const res = await app.inject({
      method: "GET",
      url: datevUrl(year, month),
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.rawPayload;
  }

  async function employeeRows(person: Person): Promise<DatevRow[]> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/datev/employee?employeeId=${person.employeeId}&year=${year}&month=${month}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return rowsOf(res.rawPayload);
  }

  async function exportRows(): Promise<ExportPayload["rows"]> {
    const spy = vi.mocked(pdfUtils.generateMonthlyExportPdf);
    spy.mockClear();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/monthly-export/pdf?year=${year}&month=${month}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    return (spy.mock.calls[0][0] as ExportPayload).rows;
  }

  beforeAll(async () => {
    data = await seedTestData(app, "dv1082r");
    tenantId = data.tenant.id;
    await configureDatevKanzlei(app, tenantId);
    const prev = await previousMonth(app, tenantId);
    year = prev.year;
    month = prev.month;
    const monday = await holidayFreeMonday(app, tenantId, prev.monthStart, 5);

    p1 = await rawPerson(app, data, "rel-p1", prev.monthStart);
    p2 = await rawPerson(app, data, "rel-p2", prev.monthStart);
    p3 = await rawPerson(app, data, "rel-p3", prev.monthStart);
    p4 = await rawPerson(app, data, "rel-p4", prev.monthStart);

    // P3: a closed valid WORK entry on Tuesday and an approved SICK request on Wednesday - both
    // exist BEFORE the shutdown is booked, so the booking leaves those days alone and they stay with
    // their own line. P4: a Berufsschultag on Tuesday.
    const tuesday = plusDays(monday, 1);
    const wednesday = plusDays(monday, 2);
    await app.prisma.timeEntry.create({
      data: {
        employeeId: p3.employeeId,
        date: tuesday,
        startTime: new Date(`${tuesday.toISOString().slice(0, 10)}T07:00:00.000Z`),
        endTime: new Date(`${tuesday.toISOString().slice(0, 10)}T15:00:00.000Z`),
        breakMinutes: 0,
        salonId: data.salonId,
      },
    });
    const sickTypeId = await ensureLeaveType(app.prisma, app.log, tenantId, "SICK");
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: p3.employeeId,
        leaveTypeId: sickTypeId,
        startDate: wednesday,
        endDate: wednesday,
        days: 1,
        status: "APPROVED",
        reviewedBy: data.adminUser.id,
        reviewedAt: new Date(),
      },
    });
    await app.prisma.absence.create({
      data: {
        employeeId: p4.employeeId,
        type: "VOCATIONAL_SCHOOL",
        source: "MANUAL",
        startDate: tuesday,
        endDate: tuesday,
        days: 1,
        createdBy: data.adminUser.id,
      },
    });

    // Monday to Thursday WITH deduction; every person has one day of Resturlaub, so Monday is Urlaub
    // and the rest is paid release wherever nothing else holds it. P2 is on the exception list.
    await bookShutdown(
      app,
      data,
      { start: monday, end: plusDays(monday, 3), deductsFromVacation: true },
      [p1.employeeId, p2.employeeId, p3.employeeId, p4.employeeId],
      async (shutdownId) => {
        await app.prisma.companyShutdownException.create({
          data: { shutdownId, employeeId: p2.employeeId, reason: null },
        });
      },
    );
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("datev-paid-release-1082 cleanup failed:", err);
    }
  });

  it("the fixture holds what the cases below assume (Urlaub on Monday, nothing for the person on the exception list)", async () => {
    for (const p of [p1, p3, p4]) {
      expect(await app.prisma.leaveRequest.count({ where: { employeeId: p.employeeId } })).toBe(
        p === p3 ? 2 : 1, // P3 also has the sickness request
      );
      expect(
        await app.prisma.absence.count({
          where: { employeeId: p.employeeId, type: "COMPANY_SHUTDOWN", deletedAt: null },
        }),
      ).toBe(1);
    }
    expect(await app.prisma.absence.count({ where: { employeeId: p2.employeeId } })).toBe(0);
    expect(await app.prisma.leaveRequest.count({ where: { employeeId: p2.employeeId } })).toBe(0);
  });

  it("with the Lohnart set: P1 3, P3 1, P4 2 release days - one row each, none for P2 - next to the unchanged Urlaub and Krank rows", async () => {
    await setLohnart(FREISTELLUNG_NR);
    const rows = rowsOf(await datevBuffer());
    expect(rows.length).toBeGreaterThan(0);

    const expected: Array<[Person, string]> = [
      [p1, "3,0"],
      [p3, "1,0"],
      [p4, "2,0"],
    ];
    for (const [person, menge] of expected) {
      const mine = rowsFor(rows, person, FREISTELLUNG_LOHNART);
      expect(mine, person.employeeNumber).toHaveLength(1);
      expect(mine[0]).toMatchObject({ satzId: "21", kind: "tage", menge });
      expect(mine[0].zeitraum).toBe(`01${String(month).padStart(2, "0")}${year}`);
    }
    expect(rowsFor(rows, p2, FREISTELLUNG_LOHNART)).toHaveLength(0);

    // The days that left the release stay on their own line, so no day is on two lines.
    for (const p of [p1, p3, p4]) {
      const urlaub = rowsFor(rows, p, "300");
      expect(urlaub, p.employeeNumber).toHaveLength(1);
      expect(urlaub[0].menge).toBe("1,0");
    }
    const krank = rowsFor(rows, p3, "200");
    expect(krank).toHaveLength(1);
    expect(krank[0].menge).toBe("1,0");
    expect(rowsFor(rows, p1, "200")).toHaveLength(0);
  });

  it("GET /datev/employee prints the identical release row for P1 and P3 and none for P2", async () => {
    await setLohnart(FREISTELLUNG_NR);
    const all = rowsOf(await datevBuffer());
    for (const person of [p1, p3]) {
      const single = await employeeRows(person);
      expect(rowsFor(single, person, FREISTELLUNG_LOHNART)).toEqual(
        rowsFor(all, person, FREISTELLUNG_LOHNART),
      );
      expect(rowsFor(single, person, FREISTELLUNG_LOHNART)).toHaveLength(1);
    }
    expect(rowsFor(await employeeRows(p2), p2, FREISTELLUNG_LOHNART)).toHaveLength(0);
  });

  it("AC5 byte proof: without the Lohnart the file is the number-set file minus exactly the release rows", async () => {
    await setLohnart(FREISTELLUNG_NR);
    const withNumber = await datevBuffer();
    await setLohnart(null);
    const without = await datevBuffer();
    const withoutAgain = await datevBuffer();
    expect(without.equals(withoutAgain)).toBe(true); // the file is deterministic, the proof is not flaky

    const lines = decodeDatev(withNumber).split("\r\n");
    const releaseLine = (line: string): boolean => {
      const f = line.split(";");
      return f[0] === "21" && f[3] === FREISTELLUNG_LOHNART;
    };
    const released = lines.filter(releaseLine);
    expect(released).toHaveLength(3); // P1, P3, P4 - not vacuous
    const stripped = iconv.encode(lines.filter((l) => !releaseLine(l)).join("\r\n"), "win1252");
    expect(stripped.equals(without)).toBe(true);
    expect(rowsFor(rowsOf(without), p1, FREISTELLUNG_LOHNART)).toHaveLength(0);
  });

  it("the Monatsexport prints the same release days as the DATEV row, with the Lohnart set and cleared", async () => {
    for (const nr of [FREISTELLUNG_NR, null]) {
      await setLohnart(nr);
      const rows = await exportRows();
      const byNumber = new Map(rows.map((r) => [r.employeeNumber, r.absenceDays.paidRelease]));
      expect(byNumber.get(p1.employeeNumber), String(nr)).toBe(3);
      expect(byNumber.get(p2.employeeNumber), String(nr)).toBe(0);
      expect(byNumber.get(p3.employeeNumber), String(nr)).toBe(1);
      expect(byNumber.get(p4.employeeNumber), String(nr)).toBe(2);
    }
  });
});

// ── A manual holiday inside the window ─────────────────────────────────────────

describe("Issue #1082 - a holiday is never a paid release day", () => {
  let data: Seed;
  let tenantId: string;
  let year: number;
  let month: number;
  let person: Person;

  beforeAll(async () => {
    data = await seedTestData(app, "dv1082h");
    tenantId = data.tenant.id;
    await configureDatevKanzlei(app, tenantId);
    const prev = await previousMonth(app, tenantId);
    year = prev.year;
    month = prev.month;
    const monday = await holidayFreeMonday(app, tenantId, prev.monthStart, 5);
    const tuesday = plusDays(monday, 1);

    person = await rawPerson(app, data, "rel-hol", prev.monthStart);
    const salon = await app.prisma.salon.findUniqueOrThrow({ where: { id: data.salonId } });
    await app.prisma.publicHoliday.create({
      data: {
        tenantId,
        salonId: data.salonId,
        date: tuesday,
        name: "Feiertag 1082",
        federalState: salon.federalState,
        year,
      },
    });
    // The holiday is the only one of the window - the release is Monday and Wednesday.
    const holidays = await getHolidayMap(
      app.prisma,
      tenantId,
      person.employeeId,
      monday,
      plusDays(monday, 2),
    );
    expect([...holidays.keys()]).toEqual([tuesday.toISOString().slice(0, 10)]);

    await app.prisma.tenantConfig.update({
      where: { tenantId },
      data: { datevFreistellungNr: FREISTELLUNG_NR },
    });
    await bookShutdown(
      app,
      data,
      { start: monday, end: plusDays(monday, 2), deductsFromVacation: false },
      [person.employeeId],
    );
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("datev-paid-release-1082 holiday cleanup failed:", err);
    }
  });

  it("books Monday and Wednesday only: 2 release days, as the Soll relief of the close core has them", async () => {
    const res = await app.inject({
      method: "GET",
      url: datevUrl(year, month),
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = rowsOf(res.rawPayload);
    expect(rows.length).toBeGreaterThan(0);
    const mine = rowsFor(rows, person, FREISTELLUNG_LOHNART);
    expect(mine).toHaveLength(1);
    expect(mine[0].menge).toBe("2,0");
  });
});

// ── A SHIFT_BASED contract ─────────────────────────────────────────────────────

describe("Issue #1082 - a SHIFT_BASED person's release days count by the contract's days", () => {
  let data: Seed;
  let tenantId: string;
  let year: number;
  let month: number;
  let person: Person;

  beforeAll(async () => {
    data = await seedTestData(app, "dv1082s");
    tenantId = data.tenant.id;
    await configureDatevKanzlei(app, tenantId);
    const prev = await previousMonth(app, tenantId);
    year = prev.year;
    month = prev.month;
    const monday = await holidayFreeMonday(app, tenantId, prev.monthStart, 7);

    person = await rawPerson(app, data, "rel-shift", prev.monthStart, { shiftBased: true });
    await app.prisma.tenantConfig.update({
      where: { tenantId },
      data: { datevFreistellungNr: FREISTELLUNG_NR },
    });
    // A full Monday-Sunday week without deduction: three contract days (Monday-Wednesday).
    await bookShutdown(
      app,
      data,
      { start: monday, end: plusDays(monday, 6), deductsFromVacation: false },
      [person.employeeId],
    );
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("datev-paid-release-1082 shift cleanup failed:", err);
    }
  });

  it("counts the three contract days of the week, not seven calendar days", async () => {
    const res = await app.inject({
      method: "GET",
      url: datevUrl(year, month),
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = rowsOf(res.rawPayload);
    expect(rows.length).toBeGreaterThan(0);
    const mine = rowsFor(rows, person, FREISTELLUNG_LOHNART);
    expect(mine).toHaveLength(1);
    expect(mine[0].menge).toBe("3,0");
  });
});
