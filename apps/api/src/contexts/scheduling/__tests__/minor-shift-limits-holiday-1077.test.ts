/**
 * Issue #1077 — § 4 Abs. 4 Satz 2 JArbSchG: the working time that falls out on a public holiday
 * counts towards the weekly working time (40 h, § 8 Abs. 1) of a person under 18.
 *
 * Owner decision 26.11.2026 (D-01): the time that falls out is the day's Soll per contract, priced
 * by the Arbeitszeitkonto's own day Soll, NOT the planned shift and NOT an average of planned
 * shifts. A holiday the planner leaves empty must not escape the check.
 *
 * Part 1 proves the pure rule on week literals and pins the one-day Soll per schedule type; part 2
 * proves the loader and `POST /api/v1/shifts` end-to-end against the database.
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
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../__tests__/test-dates";
import {
  findMinorShiftLimitViolation,
  findStoredMinorWeekViolations,
  loadMinorShiftWeeks,
  type MinorShiftWeek,
  type ShiftDraft,
} from "../minor-shift-limits";
import {
  calcExpectedMinutesTz,
  calcMonthlyHoursDayMinutesTz,
  dayRangeUtc,
  getDayHoursFromSchedule,
} from "../../working-time-account";

// ── Part 1: the pure rule on week literals ───────────────────────────────────────────────────────

const MON = "2026-11-16"; // a Monday; pure cases never read "now", so a literal cannot expire
const dayIso = (n: number): string => addDaysStr(MON, n);
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => dayIso(i));

const SIXTEEN = "2010-05-01";
const SEVENTEEN = "2009-05-01";
const FRIDAY_EIGHTEEN = "2008-11-20"; // 18th birthday on Friday 20.11.2026

type Spec = [day: number, start: string, end: string, id?: string];

function draftOf(day: number, start: string, end: string): ShiftDraft {
  return { date: new Date(`${dayIso(day)}T00:00:00Z`), startTime: start, endTime: end };
}

/** `holiday` maps a day index to the contract Soll minutes the loader would have written. */
function mkWeek(o: {
  birth: string | null;
  shifts?: Spec[];
  holiday?: Record<number, number>;
}): MinorShiftWeek {
  const holidays: Record<string, number> = {};
  for (const [n, minutes] of Object.entries(o.holiday ?? {})) holidays[dayIso(Number(n))] = minutes;
  const birthDate = o.birth ? new Date(`${o.birth}T00:00:00Z`) : null;
  return {
    employeeId: "emp-pure",
    weekDays: WEEK_DAYS,
    birthDate: birthDate as Date,
    breakEmployee: { breakOver6hOverride: null, breakOver9hOverride: null, birthDate },
    breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    creditedMinutesByDate: {},
    schoolDays: [],
    holidaySollMinutesByDate: holidays,
    shifts: (o.shifts ?? []).map(([day, start, end, id], i) => ({
      ...draftOf(day, start, end),
      id: id ?? `s${i}`,
    })),
  };
}

/** 08:00-17:00 is net 8:00 with the 30 min break. */
const eightHourDays = (days: number[]): Spec[] => days.map((d) => [d, "08:00", "17:00"] as Spec);

const HOLIDAY_SENTENCE =
  "Darin sind 8:00 Stunden eingerechnet, die an einem Feiertag ausfallen (§ 4 Abs. 4 Satz 2 JArbSchG).";

describe("§ 4 Abs. 4 Satz 2 JArbSchG — holiday time in the weekly sum, pure (Issue #1077)", () => {
  it("P1: Mon-Thu 4 x 8:00 plus a Friday holiday is exactly 40:00; 8:30 on Thursday is 40:30", () => {
    const stored = mkWeek({
      birth: SIXTEEN,
      shifts: eightHourDays([0, 1, 2, 3]),
      holiday: { 4: 480 },
    });
    expect(findStoredMinorWeekViolations(stored)).toEqual([]);

    const threeDays = mkWeek({
      birth: SIXTEEN,
      shifts: eightHourDays([0, 1, 2]),
      holiday: { 4: 480 },
    });
    expect(
      findMinorShiftLimitViolation(threeDays, { add: [draftOf(3, "08:00", "17:00")] }),
    ).toBeNull();

    const v = findMinorShiftLimitViolation(threeDays, { add: [draftOf(3, "08:00", "17:30")] });
    expect(v?.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(v?.dateIso).toBe(dayIso(3));
    expect(v?.message).toContain("40:30 Stunden");
    expect(v?.message).toContain("Mit der Schicht am 19.11.2026");
    expect(v?.message).toContain(HOLIDAY_SENTENCE);

    // control: the same 8:30 week without the holiday is lawful
    const noHoliday = mkWeek({ birth: SIXTEEN, shifts: eightHourDays([0, 1, 2]) });
    expect(
      findMinorShiftLimitViolation(noHoliday, { add: [draftOf(3, "08:00", "17:30")] }),
    ).toBeNull();

    // 9:00 on that Thursday is the DAILY rule, not the weekly one
    const daily = findMinorShiftLimitViolation(threeDays, { add: [draftOf(3, "08:00", "18:00")] });
    expect(daily?.code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
  });

  it("P2: a holiday on a day the loader gave no Soll adds nothing", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: eightHourDays([0, 1, 2, 3, 4]), holiday: {} });
    expect(findStoredMinorWeekViolations(week)).toEqual([]);
  });

  it("P3: a Sunday holiday adds nothing (Werktag only)", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      shifts: eightHourDays([0, 1, 2, 3, 4]),
      holiday: { 6: 480 },
    });
    expect(findStoredMinorWeekViolations(week)).toEqual([]);
  });

  it("P4: a shift on the holiday is never counted twice (the larger value wins)", () => {
    const shifts: Spec[] = [...eightHourDays([0, 1, 3, 4]), [2, "09:00", "13:00"]];
    const week = mkWeek({ birth: SIXTEEN, shifts, holiday: { 2: 480 } });
    expect(findStoredMinorWeekViolations(week)).toEqual([]);
  });

  it("P5: the holiday counts only on days the person is a minor", () => {
    const shifts: Spec[] = [0, 1, 2, 3].map((d) => [d, "08:00", "17:30"] as Spec); // 4 x 8:30
    const adultOnHoliday = mkWeek({ birth: FRIDAY_EIGHTEEN, shifts, holiday: { 4: 480 } });
    expect(findStoredMinorWeekViolations(adultOnHoliday)).toEqual([]);

    const minorOnHoliday = mkWeek({ birth: SEVENTEEN, shifts, holiday: { 4: 480 } });
    const [v] = findStoredMinorWeekViolations(minorOnHoliday);
    expect(v?.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(v?.message).toContain("42:00 Stunden");
  });

  it("P6: the holiday is no counted day for § 15", () => {
    const shifts: Spec[] = [1, 2, 3, 4, 5].map((d) => [d, "10:00", "14:00"] as Spec);
    const week = mkWeek({ birth: SIXTEEN, shifts, holiday: { 0: 480 } });
    expect(findStoredMinorWeekViolations(week)).toEqual([]);
  });

  it("P7: texts are unchanged without a holiday and carry the sentence with one", () => {
    const shifts: Spec[] = [0, 1, 2, 3, 4].map((d) => [d, "08:00", "17:30"] as Spec); // 42:30
    const [plain] = findStoredMinorWeekViolations(mkWeek({ birth: SIXTEEN, shifts }));
    expect(plain?.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(plain?.message).toContain("42:30 Stunden");
    expect(plain?.message).not.toContain("Feiertag");
    expect(plain?.message.endsWith("(§ 8 Abs. 1 und § 9 Abs. 2 JArbSchG).")).toBe(true);

    const fourDays = shifts.slice(0, 4); // 34:00, a Saturday holiday of 8:00 makes it 42:00
    const withHoliday = mkWeek({ birth: SIXTEEN, shifts: fourDays, holiday: { 5: 480 } });
    const [stored] = findStoredMinorWeekViolations(withHoliday);
    expect(stored?.message).toContain("42:00 Stunden");
    expect(stored?.message).toContain(HOLIDAY_SENTENCE);

    const written = findMinorShiftLimitViolation(withHoliday, {
      add: [draftOf(4, "08:00", "17:30")],
    });
    expect(written?.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(written?.message).toContain("50:30 Stunden");
    expect(written?.message).toContain(HOLIDAY_SENTENCE);
  });
});

// D-01 parity pins: the one-day Soll of the Arbeitszeitkonto that the loader uses equals what each
// schedule type's own month-close / roster reduction takes off for that day.
describe("§ 4 Abs. 4 Satz 2 JArbSchG — the one-day Soll per schedule type (Issue #1077, D-01)", () => {
  const TZ = "Europe/Berlin";
  const oneDay = (schedule: Record<string, unknown>, iso: string, defaultWorkDays?: number[]) => {
    const { start, end } = dayRangeUtc(iso, TZ);
    return calcExpectedMinutesTz(schedule, start, end, TZ, undefined, defaultWorkDays);
  };

  it("FIXED_SCHEDULE equals the weekday's hours times 60, and 0 on a non-contract day", () => {
    const fixed = {
      type: "FIXED_SCHEDULE",
      weeklyHours: 32,
      mondayHours: 8,
      tuesdayHours: 8,
      wednesdayHours: 8,
      thursdayHours: 8,
      fridayHours: 0,
      saturdayHours: 0,
      sundayHours: 0,
      workDays: [1, 2, 3, 4],
    };
    expect(oneDay(fixed, "2026-11-19")).toBe(getDayHoursFromSchedule(fixed, 4) * 60);
    expect(oneDay(fixed, "2026-11-19")).toBe(480);
    expect(oneDay(fixed, "2026-11-20")).toBe(0);
  });

  it("MONTHLY_HOURS equals the month close's Ø-day", () => {
    const monthly = { type: "MONTHLY_HOURS", monthlyHours: 80, workDays: [1, 2, 3, 4, 5] };
    const expected = calcMonthlyHoursDayMinutesTz(monthly, "2026-11-19", TZ, [1, 2, 3, 4, 5]);
    expect(expected).toBeGreaterThan(0);
    expect(oneDay(monthly, "2026-11-19", [1, 2, 3, 4, 5])).toBe(expected);
  });

  it("SHIFT_BASED is the weekly hours over the contract days on a contract weekday, else 0", () => {
    const shiftBased = {
      type: "SHIFT_BASED",
      weeklyHours: 38,
      workDays: [1, 2, 3, 4, 5],
      contractWorkDaysPerWeek: 5,
    };
    expect(oneDay(shiftBased, "2026-11-19")).toBe(456);
    expect(oneDay(shiftBased, "2026-11-21")).toBe(0);
  });
});

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

  async function mkPerson(
    label: string,
    birth: string | null,
    opts: { schedule?: Record<string, unknown>; exitDate?: string } = {},
  ): Promise<string> {
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
        exitDate: opts.exitDate ? new Date(`${opts.exitDate}T00:00:00Z`) : null,
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
        ...opts.schedule,
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

  it("L1: a statutory holiday of every Bundesland counts (Tag der Deutschen Einheit 2028)", async () => {
    const emp = await mkPerson("HolStat", "2011-05-01");
    const weeks = await loadMinorShiftWeeks(
      app.prisma,
      data.tenant.id,
      [emp],
      utcMidnight("2028-10-02"),
    );
    expect(weeks.get(emp)?.holidaySollMinutesByDate).toEqual({ "2028-10-03": 480 });
  });

  it("L2: a holiday on a day without contract Soll adds nothing", async () => {
    const monday = holidayFreeMonday(14, WEEK_MONDAY);
    await addSalonHoliday(addDaysStr(monday, 3), "Testfeiertag 1077 Do");
    await addSalonHoliday(addDaysStr(monday, 4), "Testfeiertag 1077 Fr");
    const emp = await mkPerson("HolFixed", birthFor(monday, 16), {
      schedule: {
        type: "FIXED_SCHEDULE",
        weeklyHours: 32,
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 0,
        saturdayHours: 0,
        sundayHours: 0,
        workDays: [1, 2, 3, 4],
      },
    });
    const weeks = await loadMinorShiftWeeks(app.prisma, data.tenant.id, [emp], utcMidnight(monday));
    expect(weeks.get(emp)?.holidaySollMinutesByDate).toEqual({ [addDaysStr(monday, 3)]: 480 });
  });

  it("L3: a holiday after the exit day adds nothing", async () => {
    const emp = await mkPerson("HolExit", "2011-05-01", { exitDate: "2028-10-02" });
    const weeks = await loadMinorShiftWeeks(
      app.prisma,
      data.tenant.id,
      [emp],
      utcMidnight("2028-10-02"),
    );
    expect(weeks.get(emp)?.holidaySollMinutesByDate).toEqual({});
  });
});
