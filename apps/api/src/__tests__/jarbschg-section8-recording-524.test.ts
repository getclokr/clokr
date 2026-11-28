/**
 * Issue #524 — § 8 JArbSchG on the recording paths.
 *
 * § 18 Abs. 2 ArbZG puts the JArbSchG in place of the ArbZG for a person under 18 on the work day.
 * Every save path that produced § 3 ArbZG day and week findings now produces § 8 findings for a
 * minor instead (D-01), as a warning and never a refusal (D-03):
 *   - JARBSCHG_DAILY_MAX_EXCEEDED  — 8:00 a day, 8:30 when another Werktag of the week is shortened
 *   - JARBSCHG_WEEKLY_MAX_EXCEEDED — 40:00 a week incl. the Berufsschule credit
 * and NEVER MAX_DAILY_EXCEEDED, MAX_WEEKLY_EXCEEDED or MAX_DAILY_AVG_EXCEEDED for that day.
 *
 * Every minor fixture day carries the two § 11-conformant Break rows 10:30-11:00 and 13:30-14:00
 * (60 minutes, no block above 4.5 h, nothing in the first or last hour), so "net H:MM" means
 * end - start - 60 min and no placement finding muddies the day. Assertions read `warnings` only.
 *
 * Fixture week: Monday 2026-09-07 .. Sunday 2026-09-13 (no holiday), in the past. No person names.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import { getTestApp, seedTestData, cleanupTestData } from "./setup";
import { TEST_TZ } from "./test-dates";
import { getVocationalSchoolMinutesForDate } from "../contexts/working-time-account";
import { loadMinorRecordedWeek } from "../contexts/time-tracking/minor-week-figures";
import { minorWeekMinutes } from "../contexts/time-tracking/minor-working-time";

const WEEK = {
  mon: "2026-09-07",
  tue: "2026-09-08",
  wed: "2026-09-09",
  thu: "2026-09-10",
  fri: "2026-09-11",
  sat: "2026-09-12",
};
const BIRTH_AGE_16 = new Date("2010-03-15T00:00:00.000Z");
const FREE_DAY = "2026-08-12"; // an unrelated Wednesday for the retro approval

const instant = (day: string, hhmm: string): Date => fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);
const minutesAfter = (day: string, hhmm: string, minutes: number): Date =>
  new Date(instant(day, hhmm).getTime() + minutes * 60_000);

/** "H:MM Std." exactly like the API texts. */
function hm(minutes: number): string {
  const whole = Math.ceil(minutes - 1e-9);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")} Std.`;
}

type Warning = { code: string; severity: string; message: string; legalBasis?: string };

describe("Issue #524 — § 8 JArbSchG replaces § 3 ArbZG for a minor on the recording paths", () => {
  let app: FastifyInstance;
  let seed: Awaited<ReturnType<typeof seedTestData>>;

  /** The 60-minute § 11-conformant break of every fixture day. */
  const breakSlots = (day: string) => [
    { startTime: instant(day, "10:30"), endTime: instant(day, "11:00") },
    { startTime: instant(day, "13:30"), endTime: instant(day, "14:00") },
  ];

  /** A closed entry starting 07:00 with `netMinutes` of working time (a 60-minute break inside). */
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

  const post = (day: string, netMinutes: number, asEmployee = false) =>
    app.inject({
      method: "POST",
      url: "/api/v1/time-entries",
      headers: { authorization: `Bearer ${asEmployee ? seed.empToken : seed.adminToken}` },
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

  const put = (id: string, day: string, netMinutes: number) =>
    app.inject({
      method: "PUT",
      url: `/api/v1/time-entries/${id}`,
      headers: { authorization: `Bearer ${seed.adminToken}` },
      payload: {
        startTime: instant(day, "07:00").toISOString(),
        endTime: minutesAfter(day, "07:00", netMinutes + 60).toISOString(),
        breakMinutes: 60,
        breaks: breakSlots(day).map((b) => ({
          startTime: b.startTime.toISOString(),
          endTime: b.endTime.toISOString(),
        })),
        reason: "Korrektur nach Rückfrage",
      },
    });

  const warningsOf = (res: { body: string }): Warning[] => JSON.parse(res.body).warnings ?? [];
  const codes = (warnings: Warning[]) => warnings.map((w) => w.code);
  const byCode = (warnings: Warning[], code: string) => warnings.find((w) => w.code === code);

  const setBirthDate = (
    birthDate: Date | null,
    classification: "VOLLZEIT" | "AZUBI" = "VOLLZEIT",
  ) =>
    app.prisma.employee.update({
      where: { id: seed.employee.id },
      data: { birthDate, classification },
    });

  beforeAll(async () => {
    app = await getTestApp();
    seed = await seedTestData(app, "jsec8-524");
  });

  afterEach(async () => {
    await app.prisma.absence.deleteMany({ where: { employeeId: seed.employee.id } });
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: seed.employee.id } });
    await app.prisma.retroEntryRequest.deleteMany({ where: { employeeId: seed.employee.id } });
    await setBirthDate(BIRTH_AGE_16);
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, seed.tenant.id);
    } catch {
      // best-effort cleanup
    }
  });

  describe("POST / PUT of a minor", () => {
    it("R1: net 9:00 on an empty week -> JARBSCHG_DAILY_MAX_EXCEEDED, no § 3 finding, still 201", async () => {
      await setBirthDate(BIRTH_AGE_16);
      const res = await post(WEEK.mon, 540);
      expect(res.statusCode, res.body).toBe(201);
      const warnings = warningsOf(res);
      const finding = byCode(warnings, "JARBSCHG_DAILY_MAX_EXCEEDED");
      expect(finding?.severity).toBe("error");
      expect(finding?.legalBasis).toBe("§ 8 Abs. 1 und 2a JArbSchG");
      expect(finding?.message).toContain("Erfasst: 9:00 Std.");
      expect(codes(warnings)).not.toContain("MAX_DAILY_EXCEEDED");
    });

    it("R2: net 8:15 on an otherwise empty week -> no § 8 day finding (8:30 is allowed)", async () => {
      const res = await post(WEEK.mon, 495);
      expect(res.statusCode, res.body).toBe(201);
      expect(codes(warningsOf(res))).not.toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
    });

    it("R3: net 11:00 -> exactly one daily code, the § 8 one", async () => {
      const res = await post(WEEK.mon, 660);
      expect(res.statusCode, res.body).toBe(201);
      const daily = codes(warningsOf(res)).filter(
        (c) => c === "MAX_DAILY_EXCEEDED" || c === "JARBSCHG_DAILY_MAX_EXCEEDED",
      );
      expect(daily).toEqual(["JARBSCHG_DAILY_MAX_EXCEEDED"]);
    });

    it("R4: Mon-Sat at 8:00, Friday edited to 8:15 -> day finding AND weekly finding, no § 3 weekly", async () => {
      await seedDay(WEEK.mon, 480);
      await seedDay(WEEK.tue, 480);
      await seedDay(WEEK.wed, 480);
      await seedDay(WEEK.thu, 480);
      const friday = await seedDay(WEEK.fri, 480);
      await seedDay(WEEK.sat, 480);
      const res = await put(friday.id, WEEK.fri, 495);
      expect(res.statusCode, res.body).toBe(200);
      const warnings = warningsOf(res);
      expect(codes(warnings)).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
      const weekly = byCode(warnings, "JARBSCHG_WEEKLY_MAX_EXCEEDED");
      expect(weekly?.message).toContain("Diese Woche: 48:15 Std.");
      expect(weekly?.legalBasis).toBe("§ 8 Abs. 1 JArbSchG");
      expect(codes(warnings)).not.toContain("MAX_WEEKLY_EXCEEDED");
    });

    it("R5: Mon-Fri at 8:15 -> only the weekly finding (41:15), no day finding, no 24-week average", async () => {
      for (const day of [WEEK.mon, WEEK.tue, WEEK.wed, WEEK.thu]) await seedDay(day, 495);
      const res = await post(WEEK.fri, 495);
      expect(res.statusCode, res.body).toBe(201);
      const warnings = warningsOf(res);
      expect(byCode(warnings, "JARBSCHG_WEEKLY_MAX_EXCEEDED")?.message).toContain("41:15 Std.");
      expect(codes(warnings)).not.toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
      expect(codes(warnings)).not.toContain("MAX_DAILY_AVG_EXCEEDED");
      expect(codes(warnings)).not.toContain("MAX_WEEKLY_EXCEEDED");
    });

    it("R6: the Berufsschule credit of a minor Berufsschultag counts in the week sum", async () => {
      await setBirthDate(BIRTH_AGE_16, "AZUBI");
      await app.prisma.absence.create({
        data: {
          employeeId: seed.employee.id,
          type: "VOCATIONAL_SCHOOL",
          source: "PATTERN",
          startDate: new Date(`${WEEK.mon}T00:00:00.000Z`),
          endDate: new Date(`${WEEK.mon}T00:00:00.000Z`),
          days: 1.0,
          createdBy: "jarbschg-section8-recording-524-test",
        },
      });
      const schedule = await app.prisma.workSchedule.findFirst({
        where: { employeeId: seed.employee.id },
        orderBy: { validFrom: "desc" },
      });
      const tenantConfig = await app.prisma.tenantConfig.findUnique({
        where: { tenantId: seed.tenant.id },
      });
      // Oracle: the same credit the Arbeitszeitkonto computes for that Monday.
      const credit = await getVocationalSchoolMinutesForDate(
        app.prisma,
        seed.employee.id,
        new Date(`${WEEK.mon}T00:00:00.000Z`),
        tenantConfig,
        { schedule, scheduleType: schedule?.type ?? null },
      );
      expect(credit, "fixture precondition: the credit lifts the week over 40:00").toBeGreaterThan(
        420,
      );
      for (const day of [WEEK.tue, WEEK.wed, WEEK.thu]) await seedDay(day, 495);
      const res = await post(WEEK.fri, 495); // 1980 min of work: under 40:00 without the credit
      expect(res.statusCode, res.body).toBe(201);
      const weekly = byCode(warningsOf(res), "JARBSCHG_WEEKLY_MAX_EXCEEDED");
      expect(weekly, "the credit must make the week exceed 40:00").toBeDefined();
      expect(weekly?.message).toContain(`Diese Woche: ${hm(1980 + credit)}`);
    });

    it("R7: the age is decided per day - a week with the 18th birthday on Wednesday", async () => {
      await setBirthDate(new Date("2008-09-09T00:00:00.000Z")); // adult from Wednesday on
      await seedDay(WEEK.mon, 480);
      await seedDay(WEEK.wed, 540); // adult day: not counted in the § 8 week

      const employee = await app.prisma.employee.findUniqueOrThrow({
        where: { id: seed.employee.id },
        select: { id: true, birthDate: true, hireDate: true, exitDate: true },
      });
      const week = await loadMinorRecordedWeek(app.prisma, {
        tenantId: seed.tenant.id,
        employee,
        dayIso: WEEK.tue,
        tz: TEST_TZ,
        tenantConfig: null,
      });
      expect(week.dayIndex).toBe(1);
      expect(week.days.map((d) => d.isMinor)).toEqual([
        true,
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(minorWeekMinutes(week.days)).toBe(480); // Monday only: Wednesday is an adult day

      const tuesday = await post(WEEK.tue, 540);
      expect(tuesday.statusCode, tuesday.body).toBe(201);
      expect(codes(warningsOf(tuesday))).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");

      // Thursday is an adult day: § 3 answers, no JArbSchG code.
      const thursday = await post(WEEK.thu, 660);
      expect(thursday.statusCode, thursday.body).toBe(201);
      const thursdayCodes = codes(warningsOf(thursday));
      expect(thursdayCodes).toContain("MAX_DAILY_EXCEEDED");
      expect(thursdayCodes.filter((c) => c.startsWith("JARBSCHG_"))).toEqual([]);
    });

    it.each([
      ["an adult", new Date("1990-01-01T00:00:00.000Z")],
      ["a person without birth date", null],
    ])(
      "R8: %s keeps the byte-identical § 3 ArbZG text and gets no JARBSCHG_ code",
      async (_n, bd) => {
        await setBirthDate(bd);
        const res = await post(WEEK.mon, 660);
        expect(res.statusCode, res.body).toBe(201);
        const warnings = warningsOf(res);
        expect(byCode(warnings, "MAX_DAILY_EXCEEDED")?.message).toBe(
          "§ 3 ArbZG: Tägliche Höchstarbeitszeit von 10 Stunden überschritten. Erfasst: 11:00 Std.",
        );
        expect(codes(warnings).filter((c) => c.startsWith("JARBSCHG_"))).toEqual([]);
      },
    );
  });

  describe("approval of a Zeitnachtrag and web clock-out", () => {
    it("R9: the approval of a retro request of a minor carries the § 8 day finding", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/retro-entry-requests",
        headers: { authorization: `Bearer ${seed.empToken}` },
        payload: {
          employeeId: seed.employee.id,
          targetDate: FREE_DAY,
          reason: "Nachtrag fixture for the § 8 day sum",
          startTime: "07:00",
          endTime: "17:00",
          breakMinutes: 60,
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const requestId = JSON.parse(created.body).id as string;
      const approved = await app.inject({
        method: "PATCH",
        url: `/api/v1/retro-entry-requests/${requestId}/review`,
        headers: { authorization: `Bearer ${seed.adminToken}` },
        payload: { status: "APPROVED", reviewNote: "Freigegeben" },
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const warnings = warningsOf(approved);
      expect(codes(warnings)).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
      expect(codes(warnings)).not.toContain("MAX_DAILY_EXCEEDED");
    });

    it("R10: the web clock-out of a minor answers 200 and carries the § 8 day finding (D-12)", async () => {
      const withClock = async <T>(day: string, hhmm: string, fn: () => Promise<T>): Promise<T> => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(instant(day, hhmm));
        try {
          return await fn();
        } finally {
          vi.useRealTimers();
        }
      };
      const clockIn = await withClock(WEEK.mon, "07:00", () =>
        app.inject({
          method: "POST",
          url: "/api/v1/time-entries/clock-in",
          headers: { authorization: `Bearer ${seed.empToken}` },
          payload: { salonId: seed.salonId },
        }),
      );
      expect(clockIn.statusCode, clockIn.body).toBe(200);
      const entryId = JSON.parse(clockIn.body).resolution.entry.id as string;
      const clockOut = await withClock(WEEK.mon, "17:00", () =>
        app.inject({
          method: "POST",
          url: `/api/v1/time-entries/${entryId}/clock-out`,
          headers: { authorization: `Bearer ${seed.empToken}` },
          payload: {},
        }),
      );
      expect(clockOut.statusCode, clockOut.body).toBe(200);
      const warnings = warningsOf(clockOut);
      expect(codes(warnings)).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
      expect(codes(warnings)).not.toContain("MAX_DAILY_EXCEEDED");
    });
  });
});
