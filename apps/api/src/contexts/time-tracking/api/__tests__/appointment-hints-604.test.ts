// Issue #604 — GET /api/v1/appointment-hints: the caller's own hints from stored appointments and
// entries. Real database; every date derives from the tenant-local today (test-dates.ts).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
} from "../../../../__tests__/setup";
import {
  TEST_TZ,
  pastDateStr,
  saldoSnapshotPeriodBounds,
  utcMidnight,
} from "../../../../__tests__/test-dates";
import { getAppointmentDayEnds } from "../../../scheduling";

type Fixture = Awaited<ReturnType<typeof seedTestData>>;
interface HintBody {
  enabled: boolean;
  hints: {
    date: string;
    kind: string;
    appointmentsUntil: string;
    clockedOutAt: string | null;
  }[];
}

function local(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);
}

describe("Issue #604 — GET /api/v1/appointment-hints", () => {
  let app: FastifyInstance;
  let data: Fixture;
  let foreign: Fixture;

  async function setSwitch(on: boolean) {
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { appointmentTimeHintsEnabled: on, retroEntryWindowDays: 10 },
    });
  }

  async function appointment(
    f: Fixture,
    employeeId: string,
    day: string,
    start: string,
    end: string,
  ) {
    await app.prisma.phorestAppointment.create({
      data: {
        employeeId,
        date: utcMidnight(day),
        startTime: start,
        endTime: end,
        salonId: f.salonId,
      },
    });
  }

  async function entry(
    employeeId: string,
    day: string,
    start: string,
    end: string | null,
    opts: { isInvalid?: boolean } = {},
  ) {
    await app.prisma.timeEntry.create({
      data: {
        employeeId,
        date: utcMidnight(day),
        startTime: local(day, start),
        endTime: end ? local(day, end) : null,
        type: "WORK",
        source: "MANUAL",
        salonId: data.salonId,
        isInvalid: opts.isInvalid ?? false,
      },
    });
  }

  async function own(): Promise<HintBody> {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/appointment-hints",
      headers: { authorization: `Bearer ${data.empToken}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as HintBody;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "hint604");
    foreign = await seedTestData(app, "hint604f");
  });

  afterAll(async () => {
    await cleanupTestData(app, data.tenant.id);
    await cleanupTestData(app, foreign.tenant.id);
    await closeTestApp();
  });

  beforeEach(async () => {
    const ids = [data.employee.id, data.adminEmployee.id, foreign.employee.id];
    await app.prisma.phorestAppointment.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.retroEntryRequest.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.saldoSnapshot.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.employee.update({
      where: { id: data.employee.id },
      data: { isTimeTrackingExempt: false },
    });
    await setSwitch(true);
  });

  it("the switch is off by default and a fresh tenant answers { enabled: false, hints: [] }", async () => {
    const fresh = await app.prisma.tenantConfig.findUniqueOrThrow({
      where: { tenantId: foreign.tenant.id },
      select: { appointmentTimeHintsEnabled: true },
    });
    expect(fresh.appointmentTimeHintsEnabled).toBe(false);

    const day = pastDateStr(1);
    await setSwitch(false);
    await appointment(data, data.employee.id, day, "10:00", "19:30");
    await entry(data.employee.id, day, "09:00", "18:00");
    expect(await own()).toEqual({ enabled: false, hints: [] });
  });

  it("answers exactly one AFTER_CLOCK_OUT hint with the four keys", async () => {
    const day = pastDateStr(1);
    await appointment(data, data.employee.id, day, "10:00", "12:00");
    await appointment(data, data.employee.id, day, "17:00", "19:30");
    await entry(data.employee.id, day, "09:00", "18:00");
    const body = await own();
    expect(body.enabled).toBe(true);
    expect(body.hints).toEqual([
      { date: day, kind: "AFTER_CLOCK_OUT", appointmentsUntil: "19:30", clockedOutAt: "18:00" },
    ]);
    expect(Object.keys(body.hints[0]).sort()).toEqual(
      ["appointmentsUntil", "clockedOutAt", "date", "kind"].sort(),
    );
  });

  it("answers NO_ENTRY for a day with appointments and no entry", async () => {
    const day = pastDateStr(2);
    await appointment(data, data.employee.id, day, "09:00", "16:00");
    expect((await own()).hints).toEqual([
      { date: day, kind: "NO_ENTRY", appointmentsUntil: "16:00", clockedOutAt: null },
    ]);
  });

  it("never hints for today, 11 days back, but does for exactly 10 days back (inclusive)", async () => {
    for (const n of [0, 11]) {
      await appointment(data, data.employee.id, pastDateStr(n), "09:00", "16:00");
    }
    expect((await own()).hints).toEqual([]);
    await appointment(data, data.employee.id, pastDateStr(10), "09:00", "16:00");
    expect((await own()).hints.map((h) => h.date)).toEqual([pastDateStr(10)]);
  });

  it("hints before a MONTHLY snapshot closes the month and not after", async () => {
    const day = pastDateStr(3);
    await appointment(data, data.employee.id, day, "09:00", "16:00");
    expect((await own()).hints).toHaveLength(1);

    const { start, end } = saldoSnapshotPeriodBounds(utcMidnight(day));
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId: data.employee.id,
        periodType: "MONTHLY",
        periodStart: start,
        periodEnd: end,
        workedMinutes: 0,
        expectedMinutes: 0,
        balanceMinutes: 0,
        carryOver: 0,
        closedAt: new Date(),
      },
    });
    expect((await own()).hints).toEqual([]);
  });

  it("an APPROVED vacation on the day silences it", async () => {
    const day = pastDateStr(2);
    await appointment(data, data.employee.id, day, "09:00", "16:00");
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: data.employee.id,
        leaveTypeId: data.vacationType.id,
        startDate: utcMidnight(day),
        endDate: utcMidnight(day),
        days: 1,
        status: "APPROVED",
      },
    });
    expect((await own()).hints).toEqual([]);
  });

  it("a PENDING Zeitnachtrag on the day silences it", async () => {
    const day = pastDateStr(2);
    await appointment(data, data.employee.id, day, "09:00", "16:00");
    await app.prisma.retroEntryRequest.create({
      data: {
        employeeId: data.employee.id,
        targetDate: utcMidnight(day),
        reason: "Nachtrag",
        status: "PENDING",
      },
    });
    expect((await own()).hints).toEqual([]);
  });

  it("a day with an open entry and an exempt person give no hint", async () => {
    const day = pastDateStr(2);
    await appointment(data, data.employee.id, day, "09:00", "19:00");
    await entry(data.employee.id, day, "09:00", null);
    expect((await own()).hints).toEqual([]);

    await app.prisma.timeEntry.deleteMany({ where: { employeeId: data.employee.id } });
    expect((await own()).hints).toHaveLength(1);
    await app.prisma.employee.update({
      where: { id: data.employee.id },
      data: { isTimeTrackingExempt: true },
    });
    expect(await own()).toEqual({ enabled: true, hints: [] });
  });

  it("a closed but invalid entry counts as recorded: AFTER_CLOCK_OUT, not NO_ENTRY", async () => {
    const day = pastDateStr(2);
    await appointment(data, data.employee.id, day, "09:00", "19:00");
    await entry(data.employee.id, day, "09:00", "17:00", { isInvalid: true });
    expect((await own()).hints.map((h) => h.kind)).toEqual(["AFTER_CLOCK_OUT"]);
  });

  it("isolation: another person's and a foreign tenant's appointments never appear", async () => {
    const day = pastDateStr(1);
    await appointment(data, data.adminEmployee.id, day, "09:00", "16:00");
    await appointment(foreign, foreign.employee.id, day, "09:00", "16:00");
    expect(await own()).toEqual({ enabled: true, hints: [] });

    await appointment(data, data.employee.id, day, "09:00", "17:00");
    await appointment(data, data.employee.id, day, "12:00", "18:45");
    const ends = await getAppointmentDayEnds(
      app.prisma,
      { kind: "tenant", tenantId: data.tenant.id },
      utcMidnight(day),
      utcMidnight(day),
    );
    expect(ends).toHaveLength(2); // one row per person and day
    const mine = ends.find((e) => e.employeeId === data.employee.id);
    expect(mine).toEqual({
      employeeId: data.employee.id,
      date: utcMidnight(day),
      lastEndTime: "18:45",
    });
    expect(Object.keys(mine!).sort()).toEqual(["date", "employeeId", "lastEndTime"]);
    expect(ends.some((e) => e.employeeId === foreign.employee.id)).toBe(false);
  });
});
