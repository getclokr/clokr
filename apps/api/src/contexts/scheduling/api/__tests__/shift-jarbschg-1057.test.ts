/**
 * Issue #1057 — § 8 (daily / weekly working time) and § 12 (Schichtzeit) JArbSchG for a roster
 * shift of a person who is under 18 on the shift date.
 *
 * Part 1 proves the pure rule (`findMinorShiftLimitViolation`) on week literals; part 2 proves it
 * end-to-end on `POST /api/v1/shifts`. The other write paths are in
 * `shift-jarbschg-paths-1057.test.ts`.
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
} from "../../../../__tests__/setup";
import {
  dbDateStr,
  dowOf,
  futureDateStr,
  holdsStatutoryHolidayInAnyState,
  utcMidnight,
} from "../../../../__tests__/test-dates";
import {
  findMinorShiftLimitViolation,
  minorShiftLimitReplyBody,
  type MinorShiftWeek,
  type ShiftDraft,
} from "../../minor-shift-limits";

// ── Part 1: the pure rule ────────────────────────────────────────────────────────────────────────

const MON = "2026-11-16"; // a Monday; pure cases never read "now", so a literal cannot expire
const dayIso = (n: number): string => {
  const d = new Date(`${MON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => dayIso(i));

const MINOR_BIRTH = "2010-05-01"; // 16 all week
const ADULT_BIRTH = "2008-11-16"; // 18th birthday on the Monday: adult all week
const THURSDAY_BIRTH = "2008-11-19"; // 18th birthday on Thursday 19.11.: minor Mon-Wed only

type Spec = [day: number, start: string, end: string, id?: string];

function draftOf(day: number, start: string, end: string): ShiftDraft {
  return { date: new Date(`${dayIso(day)}T00:00:00Z`), startTime: start, endTime: end };
}

function mkWeek(o: {
  birth: string | null;
  shifts?: Spec[];
  credit?: Record<number, number>;
  breakOver9hOverride?: number | null;
}): MinorShiftWeek {
  const credits: Record<string, number> = {};
  for (const [n, minutes] of Object.entries(o.credit ?? {})) credits[dayIso(Number(n))] = minutes;
  const birthDate = o.birth ? new Date(`${o.birth}T00:00:00Z`) : null;
  return {
    employeeId: "emp-pure",
    weekDays: WEEK_DAYS,
    birthDate: birthDate as Date,
    breakEmployee: {
      breakOver6hOverride: null,
      breakOver9hOverride: o.breakOver9hOverride ?? null,
      birthDate,
    },
    breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    creditedMinutesByDate: credits,
    // a credit exists only on a Berufsschule day
    schoolDays: Object.keys(credits),
    shifts: (o.shifts ?? []).map(([day, start, end, id], i) => ({
      ...draftOf(day, start, end),
      id: id ?? `s${i}`,
    })),
  };
}

describe("findMinorShiftLimitViolation — pure rule (Issue #1057)", () => {
  it("accepts 08:00-17:30 (net 8:30) on an empty week: Saturday without work is a shorter Werktag", () => {
    const week = mkWeek({ birth: MINOR_BIRTH });
    expect(findMinorShiftLimitViolation(week, { add: [draftOf(0, "08:00", "17:30")] })).toBeNull();
  });

  it("refuses 08:00-18:00 (net 9:00): DAILY_MAX naming the day and the 8 hours", () => {
    const week = mkWeek({ birth: MINOR_BIRTH });
    const v = findMinorShiftLimitViolation(week, { add: [draftOf(0, "08:00", "18:00")] });
    expect(v?.code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    expect(v?.dateIso).toBe(MON);
    expect(v?.message).toContain("16.11.2026");
    expect(v?.message).toContain("8 Stunden");
    expect(v?.message).toContain("§ 8");
  });

  it("accepts exactly 8:00 net, and a 10:00 span with the 9h break override, refuses 10:01 (§ 12)", () => {
    const plain = mkWeek({ birth: MINOR_BIRTH });
    expect(findMinorShiftLimitViolation(plain, { add: [draftOf(0, "08:00", "17:00")] })).toBeNull();

    const override = mkWeek({ birth: MINOR_BIRTH, breakOver9hOverride: 120 });
    // gross 10:00, break 120 -> net 8:00, span exactly 10:00
    expect(
      findMinorShiftLimitViolation(override, { add: [draftOf(0, "08:00", "18:00")] }),
    ).toBeNull();
    const v = findMinorShiftLimitViolation(override, { add: [draftOf(0, "08:00", "18:01")] });
    expect(v?.code).toBe("JARBSCHG_VIOLATION_SHIFT_TIME");
  });

  it("§ 8 Abs. 2a bites in a birthday week: 8:30 needs another Werktag under 8:00", () => {
    // 18th birthday on Thursday: Mon-Wed are minor days, Thu-Sat adult days at 8:30 each.
    const shifts: Spec[] = [
      [1, "08:00", "17:00"], // Tue minor, net 8:00
      [2, "08:00", "17:00"], // Wed minor, net 8:00
      [3, "08:00", "17:00"], // Thu adult, net 8:30 (30 min break)
      [4, "08:00", "17:00"], // Fri adult, net 8:30
      [5, "08:00", "17:00"], // Sat adult, net 8:30
    ];
    const full = mkWeek({ birth: THURSDAY_BIRTH, shifts });
    const bite = findMinorShiftLimitViolation(full, { add: [draftOf(0, "08:00", "17:30")] });
    expect(bite?.code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    expect(bite?.dateIso).toBe(MON);

    const withoutSaturday = mkWeek({ birth: THURSDAY_BIRTH, shifts: shifts.slice(0, 4) });
    expect(
      findMinorShiftLimitViolation(withoutSaturday, { add: [draftOf(0, "08:00", "17:30")] }),
    ).toBeNull();
  });

  it("refuses a split shift whose span exceeds 10:00 even though the net is only 8:00 (§ 12)", () => {
    const week = mkWeek({ birth: MINOR_BIRTH, shifts: [[0, "08:00", "12:00"]] });
    const v = findMinorShiftLimitViolation(week, { add: [draftOf(0, "15:00", "19:00")] });
    expect(v?.code).toBe("JARBSCHG_VIOLATION_SHIFT_TIME");
    expect(v?.message).toContain("10 Stunden");
    expect(v?.message).toContain("§ 12");
    expect(v?.message).toContain("16.11.2026");
  });

  it("weekly: refuses the write that takes the week above 40:00, counting the Berufsschule credit", () => {
    const tueThu: Spec[] = [
      [1, "08:00", "17:30"],
      [2, "08:00", "17:30"],
      [3, "08:00", "17:30"],
    ];
    const withCredit = mkWeek({ birth: MINOR_BIRTH, shifts: tueThu, credit: { 0: 480 } });
    const v = findMinorShiftLimitViolation(withCredit, { add: [draftOf(4, "08:00", "17:30")] });
    expect(v?.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(v?.message).toContain("40 Stunden");
    expect(v?.message).toContain("20.11.2026");

    const withoutCredit = mkWeek({ birth: MINOR_BIRTH, shifts: tueThu });
    expect(
      findMinorShiftLimitViolation(withoutCredit, { add: [draftOf(4, "08:00", "17:30")] }),
    ).toBeNull();
  });

  it("weekly: exactly 40:00 is accepted", () => {
    const monThu: Spec[] = [0, 1, 2, 3].map((d) => [d, "08:00", "17:00"] as Spec);
    const week = mkWeek({ birth: MINOR_BIRTH, shifts: monThu });
    expect(findMinorShiftLimitViolation(week, { add: [draftOf(4, "08:00", "17:00")] })).toBeNull();
  });

  it("refuses only what creates or enlarges a violation (an illegal plan never freezes the roster)", () => {
    const legacy = mkWeek({ birth: MINOR_BIRTH, shifts: [[0, "07:00", "18:00", "legacy"]] }); // net 10:00
    // shorter than before (still above 8:30): accepted
    expect(
      findMinorShiftLimitViolation(legacy, {
        removeShiftId: "legacy",
        add: [draftOf(0, "07:00", "17:30")],
      }),
    ).toBeNull();
    // longer than before: refused
    expect(
      findMinorShiftLimitViolation(legacy, {
        removeShiftId: "legacy",
        add: [draftOf(0, "07:00", "18:30")],
      })?.code,
    ).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    // identical times (a label-only edit): accepted
    expect(
      findMinorShiftLimitViolation(legacy, {
        removeShiftId: "legacy",
        add: [draftOf(0, "07:00", "18:00")],
      }),
    ).toBeNull();

    // a legacy 45 h week: shortening one day is accepted
    const legacyWeek = mkWeek({
      birth: MINOR_BIRTH,
      shifts: [0, 1, 2, 3, 4].map((d) => [d, "08:00", "18:00", `d${d}`] as Spec),
    });
    expect(
      findMinorShiftLimitViolation(legacyWeek, {
        removeShiftId: "d0",
        add: [draftOf(0, "08:00", "17:30")],
      }),
    ).toBeNull();
  });

  it("gives an adult and a person without a birth date the same answer: no JArbSchG finding", () => {
    const scenarios: Array<{ shifts: Spec[]; credit?: Record<number, number>; add: ShiftDraft }> = [
      { shifts: [], add: draftOf(0, "08:00", "18:00") },
      { shifts: [[0, "08:00", "12:00"]], add: draftOf(0, "15:00", "19:00") },
      {
        shifts: [
          [1, "08:00", "17:30"],
          [2, "08:00", "17:30"],
          [3, "08:00", "17:30"],
        ],
        credit: { 0: 480 },
        add: draftOf(4, "08:00", "17:30"),
      },
    ];
    for (const birth of [ADULT_BIRTH, null]) {
      for (const sc of scenarios) {
        const week = mkWeek({ birth, shifts: sc.shifts, credit: sc.credit });
        expect(findMinorShiftLimitViolation(week, { add: [sc.add] })).toBeNull();
      }
    }
  });

  it("a draft outside the loaded week or no draft at all is no finding", () => {
    const week = mkWeek({ birth: MINOR_BIRTH });
    expect(findMinorShiftLimitViolation(week, { add: [] })).toBeNull();
    expect(findMinorShiftLimitViolation(week, { add: [draftOf(9, "08:00", "20:00")] })).toBeNull();
  });

  it("reply body: German error, the code, canForce false, no birth date", () => {
    const week = mkWeek({ birth: MINOR_BIRTH });
    const v = findMinorShiftLimitViolation(week, { add: [draftOf(0, "08:00", "18:00")] })!;
    const body = minorShiftLimitReplyBody(v);
    expect(body).toEqual({
      error: "JArbSchG-Verstoß",
      code: "JARBSCHG_VIOLATION_DAILY_MAX",
      message: v.message,
      canForce: false,
    });
    expect(JSON.stringify(body)).not.toContain(MINOR_BIRTH);
  });
});

// ── Part 2: POST /shifts end-to-end ──────────────────────────────────────────────────────────────

const PASSWORD = "test1234";

/** First Monday at least 14 days ahead whose week holds no 29 February (a birthday on it is awkward) and no statutory holiday of any Bundesland
 * (a holiday counts into a minor's weekly sum, Issue #1077). */
function anchorMonday(): string {
  const add = (iso: string, n: number) =>
    dbDateStr(new Date(utcMidnight(iso).getTime() + n * 86_400_000));
  let d = futureDateStr(14);
  while (dowOf(d) !== 1) d = add(d, 1);
  const holdsFeb29 = (mon: string) =>
    Array.from({ length: 7 }, (_, i) => add(mon, i)).some((x) => x.endsWith("-02-29"));
  while (holdsFeb29(d) || holdsStatutoryHolidayInAnyState(d, 7)) d = add(d, 7);
  return d;
}
const WEEK_MONDAY = anchorMonday();
const day = (n: number): string =>
  dbDateStr(new Date(utcMidnight(WEEK_MONDAY).getTime() + n * 86_400_000));
/** The birth date that makes the person exactly `years` old on `dayIso`. */
const birthFor = (dayIso_: string, years: number): string => {
  const [y, m, d] = dayIso_.split("-");
  return `${Number(y) - years}-${m}-${d}`;
};

describe("POST /shifts — JArbSchG § 8 / § 12 (Issue #1057)", () => {
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
        lastName: "Jarbschg1057",
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

  async function post(employeeId: string, dayOffset: number, start: string, end: string, q = "") {
    return app.inject({
      method: "POST",
      url: `/api/v1/shifts${q}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { employeeId, date: day(dayOffset), startTime: start, endTime: end },
    });
  }

  async function shiftRows(employeeId: string, dayOffset: number) {
    return app.prisma.shift.findMany({
      where: { employeeId, date: new Date(`${day(dayOffset)}T00:00:00Z`), deletedAt: null },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
  }

  async function createAuditRows(employeeId: string) {
    return app.prisma.auditLog.findMany({
      where: {
        entity: "Shift",
        action: "CREATE",
        newValue: { path: ["employeeId"], equals: employeeId },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "jarb1057");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("shift-jarbschg-1057 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("anchor week stays in the future", () => {
    expect(WEEK_MONDAY > futureDateStr(7)).toBe(true);
    expect(dowOf(WEEK_MONDAY)).toBe(1);
  });

  it("refuses a 16-year-old's 08:00-18:00 with 422 DAILY_MAX, not overridable, nothing written", async () => {
    const emp = await mkPerson("Sixteen", birthFor(WEEK_MONDAY, 16));
    for (const q of ["", "?force=true"]) {
      const res = await post(emp, 0, "08:00", "18:00", q);
      expect(res.statusCode, res.body).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
      expect(body.error).toBe("JArbSchG-Verstoß");
      expect(body.canForce).toBe(false);
      const [y, m, d] = day(0).split("-");
      expect(body.message).toContain(`${Number(d)}.${Number(m)}.${y}`);
    }
    expect(await shiftRows(emp, 0)).toHaveLength(0);
    expect(await createAuditRows(emp)).toHaveLength(0);
  });

  it("accepts the lawful 8:30 day on an otherwise empty week", async () => {
    const emp = await mkPerson("SixteenOk", birthFor(WEEK_MONDAY, 16));
    const res = await post(emp, 0, "08:00", "17:30");
    expect(res.statusCode, res.body).toBe(201);
    expect(await shiftRows(emp, 0)).toHaveLength(1);
  });

  it("an 18-year-old on the shift date (the 18th birthday itself) and a person without birth date are unchanged", async () => {
    const adult = await mkPerson("EighteenToday", birthFor(WEEK_MONDAY, 18));
    expect((await post(adult, 0, "08:00", "18:00")).statusCode).toBe(201); // § 3 path, net 9:15

    const unknown = await mkPerson("NoBirth", null);
    expect((await post(unknown, 0, "08:00", "18:00")).statusCode).toBe(201);
  });

  it("decides the age per day: 18th birthday on Wednesday checks Tuesday, not Thursday", async () => {
    const emp = await mkPerson("Birthday18", birthFor(day(2), 18));
    expect((await post(emp, 1, "08:00", "18:00")).statusCode).toBe(422); // Tuesday: 17
    expect((await post(emp, 3, "08:00", "18:00")).statusCode).toBe(201); // Thursday: 18
  });

  it("decides the age per day: 17th birthday on Wednesday checks the whole week", async () => {
    const emp = await mkPerson("Birthday17", birthFor(day(2), 17));
    const res = await post(emp, 3, "08:00", "18:00"); // Thursday, 17
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
  });

  it("§ 12: a second shift that stretches the day beyond 10:00 is refused for a minor, accepted for an adult", async () => {
    const minor = await mkPerson("SplitMinor", birthFor(WEEK_MONDAY, 16));
    await fixtureShift(minor, 0, "08:00", "12:00");
    const res = await post(minor, 0, "15:00", "19:00");
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).code).toBe("JARBSCHG_VIOLATION_SHIFT_TIME");

    const adult = await mkPerson("SplitAdult", birthFor(WEEK_MONDAY, 30));
    await fixtureShift(adult, 0, "08:00", "12:00");
    expect((await post(adult, 0, "15:00", "19:00")).statusCode).toBe(201);
  });

  it("weekly: the Berufsschule day counts into the 40 hours (§ 9 Abs. 2 JArbSchG)", async () => {
    const withBs = await mkPerson("WeekBs", birthFor(WEEK_MONDAY, 16));
    await app.prisma.absence.create({
      data: {
        employeeId: withBs,
        type: "VOCATIONAL_SCHOOL",
        source: "PATTERN",
        startDate: new Date(`${day(0)}T00:00:00Z`),
        endDate: new Date(`${day(0)}T00:00:00Z`),
        days: 1.0,
        createdBy: "jarbschg-1057-test",
      },
    });
    for (const d of [1, 2, 3]) await fixtureShift(withBs, d, "08:00", "17:30");
    const res = await post(withBs, 4, "08:00", "17:30");
    expect(res.statusCode, res.body).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("JARBSCHG_VIOLATION_WEEKLY_MAX");
    expect(body.message).toContain("40 Stunden");

    const withoutBs = await mkPerson("WeekNoBs", birthFor(WEEK_MONDAY, 16));
    for (const d of [1, 2, 3]) await fixtureShift(withoutBs, d, "08:00", "17:30");
    expect((await post(withoutBs, 4, "08:00", "17:30")).statusCode).toBe(201);
  });

  it("no body, minor or adult, carries a birth date", async () => {
    const birth = birthFor(WEEK_MONDAY, 16);
    const minor = await mkPerson("NoLeakMinor", birth);
    const refused = await post(minor, 0, "08:00", "18:00");
    const accepted = await post(minor, 1, "08:00", "17:00");
    for (const res of [refused, accepted]) {
      expect(res.body).not.toContain("birthDate");
      expect(res.body).not.toContain(birth);
    }
    expect(refused.statusCode).toBe(422);
    expect(accepted.statusCode).toBe(201);
  });
});
