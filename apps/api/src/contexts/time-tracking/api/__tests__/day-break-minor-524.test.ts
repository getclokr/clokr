// Issue #524 (D-06) — the day-only views of a minor judge the § 8 JArbSchG ceiling.
//
// POST /api/v1/day-breaks/preview and GET /api/v1/day-breaks/checks look at ONE day and know no
// week, so for a day the person is under 18 on they judge the 8:30 ceiling of § 8 Abs. 2a (always
// a breach, whatever the week) and name it JARBSCHG_DAILY_MAX_EXCEEDED instead of the § 3 ArbZG
// MAX_DAILY_EXCEEDED. Under D-02 the 8:00 band only applies when every other Werktag has at least
// 8:00, i.e. when the week is above 40:00 anyway, which the save response names.
//
// Fixture: the seeded person is 16 on the day; the single entry carries the two § 11-conformant
// Break rows 10:30-11:00 and 13:30-14:00 (60 minutes), so no placement finding muddies the day.
// No person names.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
} from "../../../../__tests__/setup";
import { TEST_TZ } from "../../../../__tests__/test-dates";

const DAY = "2026-05-12"; // a Tuesday, no holiday
const BIRTH_AGE_16 = new Date("2010-03-15T00:00:00.000Z");

const instant = (hhmm: string): Date => fromZonedTime(`${DAY}T${hhmm}:00`, TEST_TZ);
const minutesAfterSeven = (minutes: number): Date =>
  new Date(instant("07:00").getTime() + minutes * 60_000);

interface Warning {
  code: string;
  message: string;
  legalBasis?: string;
}
interface DayBody {
  date: string;
  detail: string;
  maxDailyExceeded: boolean | null;
  warnings: Warning[];
}

describe("Issue #524 — day-only views of a minor (D-06)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  const breakSlots = () => [
    { startTime: instant("10:30"), endTime: instant("11:00") },
    { startTime: instant("13:30"), endTime: instant("14:00") },
  ];

  /** The seeded person's single entry of DAY with `netMinutes` of working time. */
  const seedDay = (netMinutes: number) =>
    app.prisma.timeEntry.create({
      data: {
        employeeId: data.employee.id,
        date: new Date(`${DAY}T00:00:00.000Z`),
        startTime: instant("07:00"),
        endTime: minutesAfterSeven(netMinutes + 60),
        breakMinutes: 60,
        type: "WORK",
        source: "MANUAL",
        salonId: data.salonId,
        breaks: { create: breakSlots() },
      },
    });

  const preview = (netMinutes: number) =>
    app.inject({
      method: "POST",
      url: "/api/v1/day-breaks/preview",
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: {
        employeeId: data.employee.id,
        date: DAY,
        startTime: instant("07:00").toISOString(),
        endTime: minutesAfterSeven(netMinutes + 60).toISOString(),
        breaks: breakSlots().map((b) => ({
          startTime: b.startTime.toISOString(),
          endTime: b.endTime.toISOString(),
        })),
      },
    });

  async function checkedDays(): Promise<DayBody[]> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/day-breaks/checks?employeeId=${data.employee.id}&from=${DAY}&to=${DAY}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { days: DayBody[] }).days;
  }

  async function cleanDays() {
    await app.prisma.timeEntry.deleteMany({
      where: { employeeId: { in: [data.employee.id, data.adminEmployee.id] } },
    });
  }

  const setBirthDate = (birthDate: Date | null) =>
    app.prisma.employee.update({ where: { id: data.employee.id }, data: { birthDate } });

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "daybreakminor-524");
  });

  afterAll(async () => {
    try {
      await cleanDays();
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  beforeEach(async () => {
    await cleanDays();
    await setBirthDate(BIRTH_AGE_16);
  });

  it("V1: the preview of a minor's net 9:00 day carries the § 8 finding, not the § 3 one", async () => {
    const res = await preview(540);
    expect(res.statusCode, res.body).toBe(200);
    const warnings = (JSON.parse(res.body) as { warnings: Warning[] }).warnings;
    const finding = warnings.find((w) => w.code === "JARBSCHG_DAILY_MAX_EXCEEDED");
    expect(finding?.legalBasis).toBe("§ 8 Abs. 1 und 2a JArbSchG");
    expect(finding?.message).toContain("Erfasst: 9:00 Std.");
    expect(warnings.map((w) => w.code)).not.toContain("MAX_DAILY_EXCEEDED");
  });

  it("V1: the day check lists that day with maxDailyExceeded true and the § 8 message", async () => {
    await seedDay(540);
    const days = await checkedDays();
    expect(days).toHaveLength(1);
    expect(days[0].detail).toBe("full");
    expect(days[0].maxDailyExceeded).toBe(true);
    expect(days[0].warnings.map((w) => w.code)).toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
    expect(days[0].warnings.map((w) => w.code)).not.toContain("MAX_DAILY_EXCEEDED");
  });

  it("V1: the same day at net 8:15 is within the ceiling and not listed", async () => {
    // The preview first: a stored entry on the same day would be part of the evaluated day.
    const res = await preview(495);
    const codes = (JSON.parse(res.body) as { warnings: Warning[] }).warnings.map((w) => w.code);
    expect(codes).not.toContain("JARBSCHG_DAILY_MAX_EXCEEDED");
    await seedDay(495);
    expect(await checkedDays()).toEqual([]);
  });

  it("V1 control: an adult 9:00 day (below the 10 h of § 3) is neither listed nor flagged", async () => {
    await setBirthDate(new Date("1990-01-01T00:00:00.000Z"));
    await seedDay(540);
    expect(await checkedDays()).toEqual([]);
  });
});
