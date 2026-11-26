/**
 * Issue #1077 — § 4 Abs. 4 Satz 2 JArbSchG: the working time that falls out on a public holiday
 * counts towards the weekly working time (40 h, § 8 Abs. 1) of a person under 18.
 *
 * Owner decision 26.11.2026 (D-01): the time that falls out is the day's Soll per contract, priced
 * by the Arbeitszeitkonto's own day Soll, NOT the planned shift and NOT an average of planned
 * shifts. A holiday the planner leaves empty must not escape the check.
 *
 * Part 2 proves the loader and `POST /api/v1/shifts` end-to-end against the database.
 *
 * Synthetic names only (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  grantSystemRole,
} from "../../../__tests__/setup";
import {
  addDaysStr,
  dbDateStr,
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../__tests__/test-dates";
import { loadMinorShiftWeeks } from "../minor-shift-limits";

// ── Part 2: the loader and POST /shifts against the database ─────────────────────────────────────

const PASSWORD = "test1234";

/**
 * First Monday at least `minDaysAhead` days ahead (and after `after`, when given) whose week holds
 * no 29 February and no statutory holiday of ANY Bundesland — the only holiday of the anchor week
 * is the manual salon holiday the suite creates itself.
 */
function holidayFreeMonday(minDaysAhead: number, after?: string): string {
  let d = futureDateStr(minDaysAhead);
  if (after && d <= after) d = addDaysStr(after, 1);
  while (dowOf(d) !== 1) d = addDaysStr(d, 1);
  const holdsFeb29 = (mon: string) =>
    Array.from({ length: 7 }, (_, i) => addDaysStr(mon, i)).some((x) => x.endsWith("-02-29"));
  while (holdsFeb29(d) || holdsStatutoryHolidayInAnyState(d, 7)) d = addDaysStr(d, 7);
  return d;
}

const WEEK_MONDAY = holidayFreeMonday(14);
const day = (n: number): string => addDaysStr(WEEK_MONDAY, n);
/** The birth date that makes the person exactly `years` old on `dayIso`. */
const birthFor = (dayIso_: string, years: number): string => {
  const [y, m, d] = dayIso_.split("-");
  return `${Number(y) - years}-${m}-${d}`;
};

describe("JArbSchG § 4 Abs. 4 Satz 2 — holiday in the week (Issue #1077)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function mkPerson(label: string, birth: string | null): Promise<string> {
    const s = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: label,
        lastName: "Holiday1077",
        hireDate: new Date("2024-09-01T00:00:00Z"),
        birthDate: birth ? new Date(`${birth}T00:00:00Z`) : null,
      },
    });
    await grantSystemRole(app.prisma, {
      tenantId: data.tenant.id,
      userId: user.id,
      role: "EMPLOYEE",
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "SHIFT_BASED",
        weeklyHours: 40,
        validFrom: new Date("2024-09-01T00:00:00Z"),
      },
    });
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId: employee.id,
        salonId: data.salonId,
        kind: "HOME",
        validFrom: new Date("2024-09-01T00:00:00Z"),
        validUntil: null,
      },
    });
    return employee.id;
  }

  async function fixtureShift(employeeId: string, dayOffset: number, start: string, end: string) {
    return app.prisma.shift.create({
      data: {
        employeeId,
        salonId: data.salonId,
        date: new Date(`${day(dayOffset)}T00:00:00Z`),
        startTime: start,
        endTime: end,
      },
    });
  }

  async function post(employeeId: string, dayOffset: number, start: string, end: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { employeeId, date: day(dayOffset), startTime: start, endTime: end },
    });
  }

  /** A manual salon holiday on `iso`, like the Feiertag a planner adds in the salon settings. */
  async function addSalonHoliday(iso: string, name: string) {
    const salon = await app.prisma.salon.findUniqueOrThrow({ where: { id: data.salonId } });
    await app.prisma.publicHoliday.create({
      data: {
        tenantId: data.tenant.id,
        salonId: data.salonId,
        date: new Date(`${iso}T00:00:00Z`),
        name,
        federalState: salon.federalState,
        year: Number(iso.slice(0, 4)),
      },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "hol1077");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
    await addSalonHoliday(day(1), "Testfeiertag 1077");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("minor-shift-limits-holiday-1077 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("anchor week stays in the future and is a Monday", () => {
    expect(WEEK_MONDAY > futureDateStr(7)).toBe(true);
    expect(dowOf(WEEK_MONDAY)).toBe(1);
  });

  it("POST /shifts: four 8:00 days plus the Tuesday holiday are exactly 40:00 and accepted", async () => {
    const emp = await mkPerson("HolOk", birthFor(WEEK_MONDAY, 16));
    for (const d of [0, 2, 3]) await fixtureShift(emp, d, "08:00", "17:00");
    const res = await post(emp, 4, "08:00", "17:00");
    expect(res.statusCode, res.body).toBe(201);
  });

  it("POST /shifts: 8:30 on the fourth day is 40:30 with the holiday and refused (WEEKLY_MAX)", async () => {
    const birth = birthFor(WEEK_MONDAY, 16);
    const emp = await mkPerson("HolBad", birth);
    for (const d of [0, 2, 3]) await fixtureShift(emp, d, "08:00", "17:00");
    const res = await post(emp, 4, "08:00", "17:30");
    expect(res.statusCode, res.body).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(body.canForce).toBe(false);
    expect(body.message).toContain("40:30 Stunden");
    expect(res.body).not.toContain(birth);
    expect(res.body).not.toContain("birthDate");
  });

  it("loadMinorShiftWeeks prices the holiday with the contract Soll of that one day", async () => {
    const emp = await mkPerson("HolLoad", birthFor(WEEK_MONDAY, 16));
    const weeks = await loadMinorShiftWeeks(
      app.prisma,
      data.tenant.id,
      [emp],
      utcMidnight(WEEK_MONDAY),
    );
    expect(weeks.get(emp)?.holidaySollMinutesByDate).toEqual({ [day(1)]: 480 });
  });
});
