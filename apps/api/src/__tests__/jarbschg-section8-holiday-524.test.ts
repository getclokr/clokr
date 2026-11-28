/**
 * Issue #524 (D-02, D-05, D-07) — § 4 Abs. 4 Satz 2 JArbSchG on the recording week, and the one
 * shared rule with the roster.
 *
 * A person under 18 whose week holds a Werktag holiday at the work location is credited with the
 * working time that falls out (the contract Soll of that day, priced by the Arbeitszeitkonto's
 * `holidayContractSollMinutes`). The recording check and the roster loader price the same holiday
 * with the same number.
 *
 * Fixture: the week of Pfingstmontag 2026-05-25 (a statutory holiday in every Bundesland); the
 * seeded person works Mon-Fri 8 h under a FIXED_SCHEDULE valid before the week. Every fixture day
 * carries the two § 11-conformant Break rows (60 minutes), so "net H:MM" = end - start - 60 min.
 * No person names.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import { getTestApp, seedTestData, cleanupTestData } from "./setup";
import { TEST_TZ } from "./test-dates";
import { loadMinorShiftWeeks } from "../contexts/scheduling/minor-shift-limits";

const HOLIDAY_WEEK = {
  mon: "2026-05-25", // Pfingstmontag
  tue: "2026-05-26",
  wed: "2026-05-27",
  thu: "2026-05-28",
  fri: "2026-05-29",
};
const PLAIN_WEEK = {
  tue: "2026-09-08",
  wed: "2026-09-09",
  thu: "2026-09-10",
  fri: "2026-09-11",
};
const BIRTH_AGE_16 = new Date("2010-03-15T00:00:00.000Z");

const instant = (day: string, hhmm: string): Date => fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);
const minutesAfter = (day: string, hhmm: string, minutes: number): Date =>
  new Date(instant(day, hhmm).getTime() + minutes * 60_000);

type Warning = { code: string; message: string; legalBasis?: string };

describe("Issue #524 — holiday time in the minor's recording week", () => {
  let app: FastifyInstance;
  let seed: Awaited<ReturnType<typeof seedTestData>>;

  const breakSlots = (day: string) => [
    { startTime: instant(day, "10:30"), endTime: instant(day, "11:00") },
    { startTime: instant(day, "13:30"), endTime: instant(day, "14:00") },
  ];
  const seedDay = (day: string, netMinutes: number) =>
    app.prisma.timeEntry.create({
      data: {
        employeeId: seed.employee.id,
        date: new Date(`${day}T00:00:00.000Z`),
        startTime: instant(day, "07:00"),
        endTime: minutesAfter(day, "07:00", netMinutes + 60),
        breakMinutes: 60,
        source: "MANUAL",
        type: "WORK",
        salonId: seed.salonId,
        breaks: { create: breakSlots(day) },
      },
    });
  const post = (day: string, netMinutes: number) =>
    app.inject({
      method: "POST",
      url: "/api/v1/time-entries",
      headers: { authorization: `Bearer ${seed.adminToken}` },
      payload: {
        employeeId: seed.employee.id,
        date: day,
        startTime: instant(day, "07:00").toISOString(),
        endTime: minutesAfter(day, "07:00", netMinutes + 60).toISOString(),
        breakMinutes: 60,
        breaks: breakSlots(day).map((b) => ({
          startTime: b.startTime.toISOString(),
          endTime: b.endTime.toISOString(),
        })),
      },
    });
  const warningsOf = (res: { body: string }): Warning[] => JSON.parse(res.body).warnings ?? [];

  beforeAll(async () => {
    app = await getTestApp();
    seed = await seedTestData(app, "jsec8hol-524");
    await app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { birthDate: BIRTH_AGE_16 },
    });
  });

  afterEach(async () => {
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: seed.employee.id } });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, seed.tenant.id);
    } catch {
      // best-effort cleanup
    }
  });

  it("H2: Tue-Fri at 8:15 plus the 8:00 that falls out on Pfingstmontag is 41:00 and named", async () => {
    for (const day of [HOLIDAY_WEEK.tue, HOLIDAY_WEEK.wed, HOLIDAY_WEEK.thu]) {
      await seedDay(day, 495);
    }
    const res = await post(HOLIDAY_WEEK.fri, 495);
    expect(res.statusCode, res.body).toBe(201);
    const weekly = warningsOf(res).find((w) => w.code === "JARBSCHG_WEEKLY_MAX_EXCEEDED");
    expect(weekly, res.body).toBeDefined();
    expect(weekly?.message).toContain("Diese Woche: 41:00 Std.");
    expect(weekly?.message).toContain(
      "Darin sind 8:00 Std. eingerechnet, die an einem Feiertag ausfallen (§ 4 Abs. 4 Satz 2 JArbSchG).",
    );
  });

  it("H2 control: the same entries in a week without a holiday stay at 33:00, no weekly finding", async () => {
    for (const day of [PLAIN_WEEK.tue, PLAIN_WEEK.wed, PLAIN_WEEK.thu]) await seedDay(day, 495);
    const res = await post(PLAIN_WEEK.fri, 495);
    expect(res.statusCode, res.body).toBe(201);
    const codes = warningsOf(res).map((w) => w.code);
    expect(codes).not.toContain("JARBSCHG_WEEKLY_MAX_EXCEEDED");
  });

  it("H2: work on the holiday itself is not counted twice (the larger of Soll and work)", async () => {
    // Monday holiday worked 8:00 = the contract Soll, so only 8:00 counts for it; Tue-Thu 8:15
    // and Friday 8:15 add 33:00 -> 41:00. Working the holiday must not push the sum to 49:00.
    await seedDay(HOLIDAY_WEEK.mon, 480);
    for (const day of [HOLIDAY_WEEK.tue, HOLIDAY_WEEK.wed, HOLIDAY_WEEK.thu]) {
      await seedDay(day, 495);
    }
    const res = await post(HOLIDAY_WEEK.fri, 495);
    const weekly = warningsOf(res).find((w) => w.code === "JARBSCHG_WEEKLY_MAX_EXCEEDED");
    expect(weekly?.message).toContain("Diese Woche: 41:00 Std.");
    // nothing falls out when the holiday was worked, so no fallout sentence
    expect(weekly?.message).not.toContain("an einem Feiertag ausfallen");
  });

  it("H3: loadMinorShiftWeeks prices the same holiday with the same Soll (480)", async () => {
    const weeks = await loadMinorShiftWeeks(
      app.prisma,
      seed.tenant.id,
      [seed.employee.id],
      new Date(`${HOLIDAY_WEEK.mon}T00:00:00Z`),
    );
    expect(weeks.get(seed.employee.id)?.holidaySollMinutesByDate).toEqual({
      [HOLIDAY_WEEK.mon]: 480,
    });
  });
});

// H4: one rule for roster and recording — the roster module declares no § 8 constant of its own
// and calls the shared functions. The positive control proves the regexes can match.
describe("Issue #524 (H4) — the roster consumes the one § 8 rule", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");
  const roster = read("contexts/scheduling/minor-shift-limits.ts");
  const kernel = read("contexts/time-tracking/minor-working-time.ts");
  const declares = /\bconst MINOR_(DAILY|WEEKLY|DAILY_EXTENDED)_LIMIT_MINUTES\b/;

  it("the kernel declares the constants (positive control)", () => {
    expect(declares.test(kernel)).toBe(true);
    expect(/\bexport function minorDailyLimitExceeded\b/.test(kernel)).toBe(true);
  });

  it("the roster imports the shared functions and declares none of the constants itself", () => {
    expect(declares.test(roster)).toBe(false);
    expect(/\bminorDailyLimitExceeded\b/.test(roster)).toBe(true);
    expect(/\bholidayContractSollMinutes\b/.test(roster)).toBe(true);
    expect(/\bconst MINOR_DAILY_EXTENDED_LIMIT_MINUTES\b/.test(roster)).toBe(false);
  });
});
