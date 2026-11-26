/**
 * close-employee-month-sick-without-roster-1136.test.ts
 *
 * Issue #1136 (owner decision 26.11.2026): approved sick leave reduces the Soll of a SHIFT_BASED
 * employee even on a day WITHOUT a planned shift, because Phorest is not reliably maintained for
 * absences - the approved request is the source. Before the fix a ROSTER-basis leave row (SICK,
 * SICK_CHILD, SPECIAL) relieved only the planned shift netto and nothing on an unplanned day, so
 * the contract Soll still counted the day: in the open month the D-09 roster proration spread the
 * unrelieved Soll over the remaining shifts (665 instead of 570 per rostered day, 1140 minutes a
 * month in the measured case) and real overtime was swallowed - the employee effectively worked
 * the sick days in (§§ 3, 4 EFZG).
 *
 * Measured case: SHIFT_BASED 38 h / 4 days (Tue-Fri), November 2026, SICK Tue 3.11.-Fri 6.11.,
 * shifts on Thu 5. / Fri 6. and on 10.-13., 17.-20., 24.-27.11. (45 min break, netto 570):
 * C_net 6840 (was 7980), the daily Soll on a rostered day 570 (was 665).
 *
 * Part 1 drives the pure core (`closeEmployeeMonth`) on literal inputs, Part 2 drives the live
 * open-month paths (`computeMonthSaldo`, `computeOvertimeBalanceBreakdown`) on a seeded database.
 * Synthetic data only.
 */
import { vi, describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import {
  closeEmployeeMonth,
  toCloseMonthApprovedLeave,
  type CloseMonthInput,
} from "../close-employee-month";
import { monthRangeUtc, monthDayBounds, calcExpectedMinutesTz } from "../timezone";
import { computeMonthSaldo } from "../month-saldo";
import { computeOvertimeBalanceBreakdown } from "..";
import {
  getTestApp,
  cleanupTestData,
  createTestSalon,
  grantSystemRole,
} from "../../../__tests__/setup";

const TZ = "Europe/Berlin";
const { start: NOV_START, end: NOV_END } = monthRangeUtc(2026, 11, TZ);
const { firstDay: NOV_FIRST, lastDay: NOV_LAST } = monthDayBounds(NOV_START, NOV_END, TZ);

const D = (s: string) => new Date(s + "T00:00:00Z");
const nov = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

/** Tue-Fri, 38 h, 4 contract days: contract Soll of November 2026 = 16 x 570 = 9120. */
const SB_38_4_TUE_FRI: Record<string, unknown> = {
  type: "SHIFT_BASED",
  weeklyHours: 38,
  contractWorkDaysPerWeek: 4,
  workDays: [2, 3, 4, 5],
  usualWorkDays: [2, 3, 4, 5],
  mondayHours: 0,
  tuesdayHours: 9.5,
  wednesdayHours: 9.5,
  thursdayHours: 9.5,
  fridayHours: 9.5,
  saturdayHours: 0,
  sundayHours: 0,
};

type Shift = { date: string; start: string; end: string };
type Work = { date: string; start: string; end: string; brk: number };
type Leave = { s: string; e: string; code?: string; half?: boolean };

/** 07:45-18:00 = 615 min brutto, 45 min break (tenant default over 9 h) -> 570 netto. */
const S = (day: number): Shift => ({ date: nov(day), start: "07:45", end: "18:00" });
/** 07:45-19:00 = 675 min brutto, 45 min break -> 630 netto. */
const LONG = (day: number): Shift => ({ date: nov(day), start: "07:45", end: "19:00" });

/** A worked entry equal to a shift (break 45 min). */
const asWork = (sh: Shift): Work => ({ ...sh, brk: 45 });

const MEASURED_SHIFT_DAYS = [5, 6, 10, 11, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27];
const MEASURED_SHIFTS = MEASURED_SHIFT_DAYS.map(S);
/** The 12 rostered days that no sick day covers (R of the measured case = 12 x 570 = 6840). */
const MEASURED_UNCOVERED_SHIFTS = MEASURED_SHIFTS.filter((sh) => sh.date >= nov(10));

function buildInput(
  schedule: Record<string, unknown>,
  leave: Leave[],
  shifts: Shift[],
  works: Work[],
  overrides: Partial<CloseMonthInput> = {},
): CloseMonthInput {
  return {
    employeeId: "x",
    monthStart: NOV_START,
    monthEnd: NOV_END,
    monthFirstDay: NOV_FIRST,
    monthLastDay: NOV_LAST,
    tz: TZ,
    carryOverIn: 0,
    schedule,
    hireDate: D("2025-01-01"),
    exitDate: null,
    isTimeTrackingExempt: false,
    breakOver6hOverride: null,
    breakOver9hOverride: null,
    entries: works.map((w) => ({
      date: D(w.date),
      startTime: new Date(`${w.date}T${w.start}:00Z`),
      endTime: new Date(`${w.date}T${w.end}:00Z`),
      breakMinutes: w.brk,
    })),
    shifts: shifts.map((sh) => ({ date: D(sh.date), startTime: sh.start, endTime: sh.end })),
    approvedLeave: toCloseMonthApprovedLeave(
      leave.map((l) => ({
        startDate: D(l.s),
        endDate: D(l.e),
        halfDay: Boolean(l.half),
        leaveType: { code: l.code ?? "SICK" },
      })),
    ),
    absences: [],
    holidayDateStrings: new Set(),
    tenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    ...overrides,
  };
}

const run = (
  schedule: Record<string, unknown>,
  leave: Leave[],
  shifts: Shift[],
  works: Work[],
  overrides: Partial<CloseMonthInput> = {},
) => closeEmployeeMonth(buildInput(schedule, leave, shifts, works, overrides));

/** Soll relief of the leave rows = Soll of the same input without them minus Soll with them. */
const relief = (
  schedule: Record<string, unknown>,
  leave: Leave[],
  shifts: Shift[],
  works: Work[] = [],
): number =>
  run(schedule, [], shifts, works).expectedMinutes -
  run(schedule, leave, shifts, works).expectedMinutes;

describe("Issue #1136 - SHIFT_BASED sick day without a planned shift (pure core)", () => {
  it("P0 fixture guard: the contract Soll of November 2026 is 9120", () => {
    expect(calcExpectedMinutesTz(SB_38_4_TUE_FRI, NOV_FIRST, NOV_LAST, TZ)).toBe(9120);
    expect(run(SB_38_4_TUE_FRI, [], MEASURED_SHIFTS, []).expectedMinutes).toBe(9120);
  });

  it("P1 measured case: the month C_net is 6840 (one row and two rows)", () => {
    const one = run(
      SB_38_4_TUE_FRI,
      [{ s: nov(3), e: nov(6) }],
      MEASURED_SHIFTS,
      MEASURED_UNCOVERED_SHIFTS.map(asWork),
    );
    expect(one.expectedMinutes).toBe(6840);
    const two = run(
      SB_38_4_TUE_FRI,
      [
        { s: nov(3), e: nov(4) },
        { s: nov(5), e: nov(6) },
      ],
      MEASURED_SHIFTS,
      MEASURED_UNCOVERED_SHIFTS.map(asWork),
    );
    expect(two.expectedMinutes).toBe(6840);
    expect(one.balanceMinutes).toBe(0);
  });

  it("P2 measured case, live proration: the daily Soll on a rostered day is 570", () => {
    const r = run(SB_38_4_TUE_FRI, [{ s: nov(3), e: nov(6) }], MEASURED_SHIFTS, [], {
      rosterProration: { rosterToDateMinutes: 570, rosterPeriodMinutes: 6840 },
    });
    expect(r.expectedMinutes).toBe(570);
  });

  describe("P3 owner example: SICK Mon 9. - Wed 11. without shifts, shifts Thu + Fri", () => {
    const shifts = [3, 4, 5, 6, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27].map(S);
    const works = shifts.map(asWork);

    it("Monday relieves 0 (not a usual day), Tuesday and Wednesday 570 each, the account ends at +0", () => {
      expect(relief(SB_38_4_TUE_FRI, [{ s: nov(9), e: nov(11) }], shifts, works)).toBe(1140);
      expect(run(SB_38_4_TUE_FRI, [{ s: nov(9), e: nov(11) }], shifts, works).balanceMinutes).toBe(
        0,
      );
    });

    it("a Thursday worked 30 minutes longer gives +30 (the overtime is no longer swallowed)", () => {
      const longer = works.map((w) => (w.date === nov(12) ? { ...w, end: "18:30" } : w));
      expect(run(SB_38_4_TUE_FRI, [{ s: nov(9), e: nov(11) }], shifts, longer).balanceMinutes).toBe(
        30,
      );
    });

    it("SICK only on Monday 9. relieves 0, SICK only on Tuesday 10. relieves 570", () => {
      expect(relief(SB_38_4_TUE_FRI, [{ s: nov(9), e: nov(9) }], shifts)).toBe(0);
      expect(relief(SB_38_4_TUE_FRI, [{ s: nov(10), e: nov(10) }], shifts)).toBe(570);
    });
  });

  it("P4 a planned shift always wins: SICK on a 07:45-19:00 shift relieves 630, not the O-day", () => {
    const shifts = [LONG(12), S(13)];
    expect(relief(SB_38_4_TUE_FRI, [{ s: nov(12), e: nov(12) }], shifts)).toBe(630);
  });

  describe("P5 a FUTURE planned sick day (live-shaped input)", () => {
    // Every Tue-Fri of November has a shift, Thu 26. is the long one; SICK only on 26.
    const allDays = [3, 4, 5, 6, 10, 11, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27];
    const shifts = allDays.map((d) => (d === 26 ? LONG(d) : S(d)));
    const works = [3, 4, 5, 6, 10, 11].map((d) => asWork(S(d)));
    const liveShaped = (shiftList: Shift[]) =>
      run(SB_38_4_TUE_FRI, [{ s: nov(26), e: nov(26) }], shiftList, works, {
        monthLastDay: D(nov(11)),
        rosterProration: { rosterToDateMinutes: 3420, rosterPeriodMinutes: 8550 },
      });

    it("with the whole month's shifts the planned netto (630) relieves: Soll 3396", () => {
      expect(liveShaped(shifts).expectedMinutes).toBe(3396);
    });

    it("with only the shifts up to the window end the day looks unplanned: Soll 3420", () => {
      expect(liveShaped(shifts.filter((sh) => sh.date <= nov(11))).expectedMinutes).toBe(3420);
    });
  });
});

// ── Part 2: the live open-month paths on a seeded database ─────────────────────────────────────

describe("Issue #1136 - open month through the live paths (database)", () => {
  const FROZEN_NOW = new Date("2026-11-12T10:00:00.000Z");
  const suffix = "sw1136-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let tenantId: string | undefined;

  async function seedPerson(
    key: string,
    shifts: Shift[],
    works: Work[],
    sick: { s: string; e: string },
  ): Promise<string> {
    const prisma = app.prisma;
    const user = await prisma.user.create({
      data: {
        email: `${key}-${suffix}@test.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const emp = await prisma.employee.create({
      data: {
        tenantId: tenantId!,
        userId: user.id,
        employeeNumber: `${key}-${suffix}`,
        firstName: "Sick",
        lastName: key,
        hireDate: new Date("2026-11-01T00:00:00Z"),
      },
    });
    await grantSystemRole(prisma, { tenantId: tenantId!, userId: user.id, role: "EMPLOYEE" });
    await prisma.overtimeAccount.create({ data: { employeeId: emp.id, balanceHours: 0 } });
    await prisma.workSchedule.create({
      data: {
        employeeId: emp.id,
        type: "SHIFT_BASED",
        weeklyHours: 38,
        contractWorkDaysPerWeek: 4,
        workDays: [2, 3, 4, 5],
        usualWorkDays: [2, 3, 4, 5],
        mondayHours: 0,
        tuesdayHours: 9.5,
        wednesdayHours: 9.5,
        thursdayHours: 9.5,
        fridayHours: 9.5,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date("2026-11-01T00:00:00Z"),
      },
    });
    const salonId = (await prisma.salon.findFirstOrThrow({ where: { tenantId: tenantId! } })).id;
    for (const sh of shifts) {
      await prisma.shift.create({
        data: {
          employeeId: emp.id,
          salonId,
          date: D(sh.date),
          startTime: sh.start,
          endTime: sh.end,
        },
      });
    }
    for (const w of works) {
      await prisma.timeEntry.create({
        data: {
          employeeId: emp.id,
          date: D(w.date),
          startTime: new Date(`${w.date}T${w.start}:00Z`),
          endTime: new Date(`${w.date}T${w.end}:00Z`),
          breakMinutes: w.brk,
          type: "WORK",
          source: "MANUAL",
          isInvalid: false,
          salonId,
        },
      });
    }
    const leaveType = await prisma.leaveType.upsert({
      where: { tenantId_code: { tenantId: tenantId!, code: "SICK" } },
      update: {},
      create: { tenantId: tenantId!, code: "SICK", name: "Krank SW", isPaid: true },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        startDate: D(sick.s),
        endDate: D(sick.e),
        days: 1,
        status: "APPROVED",
        halfDay: false,
      },
    });
    return emp.id;
  }

  async function atFrozenNow<T>(fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  }

  async function ensureTenant(): Promise<void> {
    if (tenantId) return;
    app = await getTestApp();
    const tenant = await app.prisma.tenant.create({
      data: { name: `SW ${suffix}`, slug: `sw-${suffix}`, federalState: "NIEDERSACHSEN" },
    });
    tenantId = tenant.id;
    await createTestSalon(app.prisma, tenantId);
    await app.prisma.tenantConfig.create({
      data: { tenantId, defaultVacationDays: 30, timezone: TZ },
    });
  }

  afterAll(async () => {
    if (tenantId) await cleanupTestData(app, tenantId);
  });

  it("DB-A measured case: computeMonthSaldo shows 570 on each rostered day (was 665)", async () => {
    await ensureTenant();
    const empId = await seedPerson("a", MEASURED_SHIFTS, [S(10), S(11)].map(asWork), {
      s: nov(3),
      e: nov(6),
    });
    const saldo = await atFrozenNow(() => computeMonthSaldo(app, empId, 2026, 11));
    const byDate = new Map(saldo.days.map((d) => [d.date, d]));
    expect(byDate.get(nov(10))!.expectedMinutes).toBe(570);
    expect(byDate.get(nov(11))!.expectedMinutes).toBe(570);
  });

  it("DB-B future planned sick day: header Soll 3396 / balance +84 in every live path", async () => {
    await ensureTenant();
    const allDays = [3, 4, 5, 6, 10, 11, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27];
    const shifts = allDays.map((d) => (d === 26 ? LONG(d) : S(d)));
    const works: Work[] = [
      ...[3, 4, 5, 6, 10].map((d) => asWork(S(d))),
      asWork(LONG(11)), // Wednesday 11. worked 07:45-19:00 = 630 netto
    ];
    const empId = await seedPerson("b", shifts, works, { s: nov(26), e: nov(26) });

    const saldo = await atFrozenNow(() => computeMonthSaldo(app, empId, 2026, 11));
    expect(saldo.expectedMinutes).toBe(3396);
    expect(saldo.balanceMinutes).toBe(84);
    expect(saldo.days[saldo.days.length - 1]!.cumulativeSaldoMinutes).toBe(84);

    const breakdown = await atFrozenNow(() => computeOvertimeBalanceBreakdown(app, empId));
    expect(Math.round(breakdown!.totalHours * 60)).toBe(84);
  });
});
