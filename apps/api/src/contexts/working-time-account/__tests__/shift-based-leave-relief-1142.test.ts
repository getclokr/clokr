/**
 * shift-based-leave-relief-1142.test.ts
 *
 * Issue #1142 - `shiftBasedLeaveRelief()` and `rosterPlannedNettoByDate()` are the ONE SHIFT_BASED
 * leave rule of the Arbeitszeitkonto: `closeEmployeeMonth` calls them and the roster Planungs-Soll
 * (`GET /shifts/week`) reaches them through the facade. These DB-free tests pin the contract of the
 * two exports on literal inputs (fixtures of the #1136 test, November 2026, Europe/Berlin) - the
 * route side is pinned by `shift-week-shift-based-leave-1142.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  bsDayPriority,
  closeEmployeeMonth,
  rosterPlannedNettoByDate,
  shiftBasedLeaveRelief,
  toCloseMonthApprovedLeave,
  type CloseMonthInput,
} from "../close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../timezone";

const TZ = "Europe/Berlin";
const { start: NOV_START, end: NOV_END } = monthRangeUtc(2026, 11, TZ);
const { firstDay: NOV_FIRST, lastDay: NOV_LAST } = monthDayBounds(NOV_START, NOV_END, TZ);

const D = (s: string) => new Date(s + "T00:00:00Z");
const nov = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

/** Tue-Fri, 38 h, 4 contract days: Ø-day 570, week contract Soll 2280. */
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
/** Mon-Fri usual days, 4 contract days. */
const SB_38_4_MON_FRI: Record<string, unknown> = {
  ...SB_38_4_TUE_FRI,
  workDays: [1, 2, 3, 4, 5],
  usualWorkDays: [1, 2, 3, 4, 5],
  mondayHours: 7.6,
};
/** 25 h / 4 days, usual workdays Mon Tue Wed Fri: Ø-day 375, November contract Soll 6375. */
const SB_25_4_MO_DI_MI_FR: Record<string, unknown> = {
  type: "SHIFT_BASED",
  weeklyHours: 25,
  contractWorkDaysPerWeek: 4,
  workDays: [1, 2, 3, 5],
  usualWorkDays: [1, 2, 3, 5],
  mondayHours: 6.25,
  tuesdayHours: 6.25,
  wednesdayHours: 6.25,
  thursdayHours: 0,
  fridayHours: 6.25,
  saturdayHours: 0,
  sundayHours: 0,
};

type Shift = { date: string; start: string; end: string };
type Leave = { s: string; e: string; code?: string; half?: boolean };

const ADULT = { breakOver6hOverride: null, breakOver9hOverride: null, birthDate: null };
const TENANT_BREAK = { defaultBreakOver6h: 30, defaultBreakOver9h: 45 };

/** 07:45-18:00 = 615 min brutto, 45 min break -> 570 netto. */
const S = (day: number): Shift => ({ date: nov(day), start: "07:45", end: "18:00" });
/** 07:45-18:30 = 645 min brutto, 45 min break -> 600 netto. */
const LONG = (day: number): Shift => ({ date: nov(day), start: "07:45", end: "18:30" });

const shiftRows = (shifts: Shift[]) =>
  shifts.map((sh) => ({ date: D(sh.date), startTime: sh.start, endTime: sh.end }));

const leaveRows = (leave: Leave[]) =>
  toCloseMonthApprovedLeave(
    leave.map((l) => ({
      startDate: D(l.s),
      endDate: D(l.e),
      halfDay: Boolean(l.half),
      leaveType: { code: l.code ?? "SICK" },
    })),
  );

/** The relief of `leave` over [from, to] the way the roster glue calls it (one week, one run). */
function relief(
  schedule: Record<string, unknown>,
  leave: Leave[],
  shifts: Shift[],
  from: string,
  to: string,
  opts: { bs?: string[]; claimed?: Set<string> } = {},
) {
  const claimed = opts.claimed ?? new Set<string>();
  const planned = rosterPlannedNettoByDate(shiftRows(shifts), ADULT, TENANT_BREAK, from, to, TZ);
  const result = shiftBasedLeaveRelief({
    approvedLeave: leaveRows(leave),
    schedule,
    defaultWorkDays: null,
    rangeStart: D(from),
    rangeEnd: D(to),
    tz: TZ,
    plannedNettoByDate: planned,
    bsPriority: bsDayPriority(new Set(opts.bs ?? []), TZ),
    claimed,
  });
  return { ...result, claimed };
}

describe("Issue #1142 - shiftBasedLeaveRelief() (pure contract)", () => {
  it("K1 week 2.-8.11., SICK Tue-Fri, shifts Thu + Fri -> 2280 (Tue + Wed fallback, Thu + Fri planned)", () => {
    const r = relief(SB_38_4_TUE_FRI, [{ s: nov(3), e: nov(6) }], [S(5), S(6)], nov(2), nov(8));
    expect(r.creditMinutes).toBe(2280);
  });

  it("K2 week 9.-15.11., SICK Mon-Wed, shifts Thu + Fri -> 1140, the pre-#1136 rule would relieve 0", () => {
    const r = relief(SB_38_4_TUE_FRI, [{ s: nov(9), e: nov(11) }], [S(12), S(13)], nov(9), nov(15));
    expect(r.creditMinutes).toBe(1140);
    expect(r.creditMinutesWithoutNoShiftFallback).toBe(0);
  });

  it("K3 a planned shift wins: SICK Thu on 600 min -> 600, as a half day 300", () => {
    expect(
      relief(SB_38_4_TUE_FRI, [{ s: nov(12), e: nov(12) }], [LONG(12)], nov(9), nov(15))
        .creditMinutes,
    ).toBe(600);
    expect(
      relief(SB_38_4_TUE_FRI, [{ s: nov(12), e: nov(12), half: true }], [LONG(12)], nov(9), nov(15))
        .creditMinutes,
    ).toBe(300);
  });

  it("K4 week cap: VACATION Mon-Tue + SICK Wed-Fri without shifts -> 2280, vacation alone 1140", () => {
    const vacation: Leave = { s: nov(9), e: nov(10), code: "VACATION" };
    const sick: Leave = { s: nov(11), e: nov(13), code: "SICK" };
    expect(relief(SB_38_4_MON_FRI, [vacation, sick], [], nov(9), nov(15)).creditMinutes).toBe(2280);
    expect(relief(SB_38_4_MON_FRI, [vacation], [], nov(9), nov(15)).creditMinutes).toBe(1140);
  });

  it("K5 claim contract: a pre-claimed day relieves nothing, every other day is claimed, a Berufsschultag is never claimed", () => {
    const row: Leave[] = [{ s: nov(9), e: nov(11) }];
    const shifts = [S(12), S(13)];

    const preClaimed = relief(SB_38_4_TUE_FRI, row, shifts, nov(9), nov(15), {
      claimed: new Set([nov(11)]),
    });
    expect(preClaimed.creditMinutes).toBe(570);
    expect([...preClaimed.claimed].sort()).toEqual([nov(9), nov(10), nov(11)]);

    const withBs = relief(SB_38_4_TUE_FRI, row, shifts, nov(9), nov(15), { bs: [nov(10)] });
    expect(withBs.creditMinutes).toBe(570);
    expect(withBs.claimed.has(nov(10))).toBe(false);
  });

  it("K6 parity with the month core: 25 h / 4 days over the whole of November equals what closeEmployeeMonth takes off", () => {
    const sh = (day: number, start: string, end: string): Shift => ({
      date: nov(day),
      start,
      end,
    });
    const roster: Shift[] = [
      ...[2, 9, 23, 30].map((d) => sh(d, "08:30", "17:00")),
      ...[3, 10, 24, 4, 11, 25].map((d) => sh(d, "08:30", "13:00")),
      sh(6, "09:00", "17:30"),
    ];
    const leave: Leave[] = [
      { s: nov(10), e: nov(11), code: "SICK" },
      { s: nov(12), e: nov(16), code: "SICK" },
      { s: nov(17), e: nov(20), code: "SICK" },
      { s: nov(27), e: nov(27), code: "VACATION" },
    ];

    const coreInput = (rows: Leave[]): CloseMonthInput => ({
      employeeId: "x",
      monthStart: NOV_START,
      monthEnd: NOV_END,
      monthFirstDay: NOV_FIRST,
      monthLastDay: NOV_LAST,
      tz: TZ,
      carryOverIn: 0,
      schedule: SB_25_4_MO_DI_MI_FR,
      hireDate: D("2025-01-01"),
      exitDate: null,
      isTimeTrackingExempt: false,
      breakOver6hOverride: null,
      breakOver9hOverride: null,
      entries: [],
      shifts: shiftRows(roster),
      approvedLeave: leaveRows(rows),
      absences: [],
      holidayDateStrings: new Set(),
      tenantConfig: TENANT_BREAK,
    });
    const without = closeEmployeeMonth(coreInput([])).expectedMinutes;
    const withLeave = closeEmployeeMonth(coreInput(leave)).expectedMinutes;
    expect(without).toBe(6375);
    expect(withLeave).toBe(3585);

    const r = relief(SB_25_4_MO_DI_MI_FR, leave, roster, nov(1), nov(30));
    expect(r.creditMinutes).toBe(2790);
    expect(r.creditMinutes).toBe(without - withLeave);
    expect(r.creditMinutesWithoutNoShiftFallback).toBe(915);
  });

  it("overtime compensation: an OVERTIME_COMP row's relief is returned as the withdrawal", () => {
    const r = relief(
      SB_38_4_MON_FRI,
      [{ s: nov(9), e: nov(10), code: "OVERTIME_COMP" }],
      [],
      nov(9),
      nov(15),
    );
    expect(r.creditMinutes).toBe(1140);
    expect(r.overtimeCompensationMinutes).toBe(1140);
    const plain = relief(
      SB_38_4_MON_FRI,
      [{ s: nov(9), e: nov(10), code: "VACATION" }],
      [],
      nov(9),
      nov(15),
    );
    expect(plain.overtimeCompensationMinutes).toBe(0);
  });
});

describe("Issue #1142 - rosterPlannedNettoByDate() (pure contract)", () => {
  const netto = (shifts: Shift[], from = nov(1), to = nov(30)) =>
    rosterPlannedNettoByDate(shiftRows(shifts), ADULT, TENANT_BREAK, from, to, TZ);

  it("K7 brutto minus the one break rule, per tenant-local day", () => {
    expect(netto([S(5)]).get(nov(5))).toBe(570);
    expect(netto([LONG(5)]).get(nov(5))).toBe(600);
  });

  it("K7 two shifts on one day add up (no break under the threshold)", () => {
    const two: Shift[] = [
      { date: nov(5), start: "08:00", end: "12:00" },
      { date: nov(5), start: "13:00", end: "17:00" },
    ];
    expect(netto(two).get(nov(5))).toBe(480);
  });

  it("K7 a shift outside [from, to] is absent", () => {
    const m = netto([S(5), S(20)], nov(1), nov(10));
    expect([...m.keys()]).toEqual([nov(5)]);
  });

  it("K7 a night shift crosses midnight: 480 brutto, 30 min break -> 450", () => {
    expect(netto([{ date: nov(5), start: "22:00", end: "06:00" }]).get(nov(5))).toBe(450);
  });

  it("a zero-length shift is skipped", () => {
    expect(netto([{ date: nov(5), start: "08:00", end: "08:00" }]).size).toBe(0);
  });
});
