/**
 * Issue #1069 (D-02, D-12, D-13) - pure-core pins for the COMPANY_SHUTDOWN absence in the close
 * core: a day of a Betriebsurlaub reduces the Soll exactly once, never yields a minus, and a
 * Berufsschultag inside the span keeps its own (BBiG § 15) credit instead of being reduced a
 * second time.
 *
 * DB-free: no app, no Prisma. Builds CloseMonthInput objects by hand and calls
 * closeEmployeeMonth() directly (the shape of close-employee-month-bs-leave.test.ts, #448).
 *
 * The oracles are equivalences (a span with the Berufsschultag cut out must equal the span with
 * the Berufsschultag inside) plus absolute pins derived by hand from the Januar-2026 fixture:
 * 22 workdays x 480 min = 10560 min contract Soll; one full working week = 2400 min.
 */
import { describe, it, expect } from "vitest";
import { closeEmployeeMonth, type CloseMonthInput } from "../close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../timezone";

const TZ = "Europe/Berlin";

const FIXED_40_5: Record<string, unknown> = {
  type: "FIXED_SCHEDULE",
  weeklyHours: 40,
  mondayHours: 8,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 8,
  fridayHours: 8,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
};
const SHIFT_40_5: Record<string, unknown> = { ...FIXED_40_5, type: "SHIFT_BASED" };
const FIXED_24_MO_WE: Record<string, unknown> = {
  type: "FIXED_SCHEDULE",
  weeklyHours: 24,
  mondayHours: 8,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 0,
  fridayHours: 0,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3],
};
const MONTHLY_44: Record<string, unknown> = {
  type: "MONTHLY_HOURS",
  monthlyHours: 44,
  weeklyHours: 0,
};

// The week Mon 12.01. - Fri 16.01.2026 is the shutdown week of every scenario.
const MON = "2026-01-12";
const TUE = "2026-01-13";
const WED = "2026-01-14";
const THU = "2026-01-15";
const FRI = "2026-01-16";

function absence(
  start: string,
  end: string,
  type: string,
  source: string = "MANUAL",
): CloseMonthInput["absences"][number] {
  return {
    startDate: new Date(start + "T00:00:00Z"),
    endDate: new Date(end + "T00:00:00Z"),
    type,
    source,
  };
}

const shutdown = (start: string, end: string) => absence(start, end, "COMPANY_SHUTDOWN");
const bsDay = (date: string) => absence(date, date, "VOCATIONAL_SCHOOL", "PATTERN");

function vacation(start: string, end: string): CloseMonthInput["approvedLeave"][number] {
  return {
    startDate: new Date(start + "T00:00:00Z"),
    endDate: new Date(end + "T00:00:00Z"),
    halfDay: false,
    isOvertimeCompensation: false,
    creditBasis: "CONTRACT",
  };
}

function entry(
  date: string,
  minutes: number,
  breakMinutes = 0,
): CloseMonthInput["entries"][number] {
  const start = new Date(date + "T08:00:00Z");
  return {
    date: new Date(date + "T00:00:00Z"),
    startTime: start,
    endTime: new Date(start.getTime() + (minutes + breakMinutes) * 60_000),
    breakMinutes,
  };
}

function baseInput(
  schedule: Record<string, unknown>,
  overrides: Partial<CloseMonthInput> = {},
): CloseMonthInput {
  const { start: monthStart, end: monthEnd } = monthRangeUtc(2026, 1, TZ);
  const { firstDay: monthFirstDay, lastDay: monthLastDay } = monthDayBounds(
    monthStart,
    monthEnd,
    TZ,
  );
  return {
    employeeId: "emp-1069",
    tz: TZ,
    carryOverIn: 0,
    schedule,
    hireDate: new Date("2025-12-01T00:00:00Z"),
    exitDate: null,
    isTimeTrackingExempt: false,
    breakOver6hOverride: 0,
    breakOver9hOverride: 0,
    entries: [],
    shifts: [],
    approvedLeave: [],
    absences: [],
    holidayDateStrings: new Set<string>(),
    tenantConfig: {
      defaultBreakOver6h: 30,
      defaultBreakOver9h: 45,
      defaultWorkDays: [1, 2, 3, 4, 5],
    },
    monthStart,
    monthEnd,
    monthFirstDay,
    monthLastDay,
    ...overrides,
  };
}

describe("closeEmployeeMonth - Issue #1069: a Betriebsurlaub day reduces the Soll exactly once", () => {
  it("FIXED: a shutdown week removes exactly 5 x 480 min of Soll - the week contributes 0, not a minus", () => {
    const without = closeEmployeeMonth(baseInput(FIXED_40_5));
    const withShutdown = closeEmployeeMonth(
      baseInput(FIXED_40_5, { absences: [shutdown(MON, FRI)] }),
    );
    expect(without.expectedMinutes).toBe(10560);
    expect(withShutdown.expectedMinutes).toBe(10560 - 5 * 480);
    // Nothing worked in either month: the balance differs by exactly the removed Soll.
    expect(withShutdown.balanceMinutes - without.balanceMinutes).toBe(5 * 480);
  });

  it("FIXED: approved Urlaub Mon-Tue plus the absence Mon-Fri reduces 5 days, not 7", () => {
    const overlapped = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        approvedLeave: [vacation(MON, TUE)],
        absences: [shutdown(MON, FRI)],
      }),
    );
    const split = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        approvedLeave: [vacation(MON, TUE)],
        absences: [shutdown(WED, FRI)],
      }),
    );
    expect(overlapped.expectedMinutes).toBe(10560 - 5 * 480);
    expect(overlapped.expectedMinutes).toBe(split.expectedMinutes);
  });

  it("FIXED: a holiday inside the span counts once (holiday 480 + absence 4 x 480)", () => {
    const result = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        holidayDateStrings: new Set([WED]),
        absences: [shutdown(MON, FRI)],
      }),
    );
    expect(result.expectedMinutes).toBe(10560 - 5 * 480);
  });

  it("FIXED: part-time Mon-Wed - only the three contract workdays of the week reduce", () => {
    const without = closeEmployeeMonth(baseInput(FIXED_24_MO_WE));
    const withShutdown = closeEmployeeMonth(
      baseInput(FIXED_24_MO_WE, { absences: [shutdown(MON, FRI)] }),
    );
    expect(without.expectedMinutes).toBe(12 * 480);
    expect(withShutdown.expectedMinutes).toBe(12 * 480 - 3 * 480);
  });

  // ── D-12: Berufsschule has priority ─────────────────────────────────────────────────────────
  it("FIXED: a PATTERN Berufsschultag inside the span - the span equals the span cut around it plus the Berufsschultag alone", () => {
    const inside = closeEmployeeMonth(
      baseInput(FIXED_40_5, { absences: [shutdown(MON, FRI), bsDay(THU)] }),
    );
    const cutAround = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        absences: [shutdown(MON, WED), shutdown(FRI, FRI), bsDay(THU)],
      }),
    );
    expect(inside.expectedMinutes).toBe(cutAround.expectedMinutes);
    expect(inside.balanceMinutes).toBe(cutAround.balanceMinutes);
    expect(inside.workedMinutes).toBe(cutAround.workedMinutes);
  });

  it("FIXED: a MANUAL-source Berufsschultag inside the span keeps its own credit too", () => {
    const manualBs = absence(THU, THU, "VOCATIONAL_SCHOOL", "MANUAL");
    const inside = closeEmployeeMonth(
      baseInput(FIXED_40_5, { absences: [shutdown(MON, FRI), manualBs] }),
    );
    const cutAround = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        absences: [shutdown(MON, WED), shutdown(FRI, FRI), manualBs],
      }),
    );
    expect(inside.expectedMinutes).toBe(cutAround.expectedMinutes);
    expect(inside.balanceMinutes).toBe(cutAround.balanceMinutes);
  });

  it("FIXED control: since #1080 the rule is not code-specific - an OTHER absence over the same Berufsschultag also reduces it once", () => {
    const other = closeEmployeeMonth(
      baseInput(FIXED_40_5, { absences: [absence(MON, FRI, "OTHER"), bsDay(THU)] }),
    );
    const otherCutAround = closeEmployeeMonth(
      baseInput(FIXED_40_5, {
        absences: [absence(MON, WED, "OTHER"), absence(FRI, FRI, "OTHER"), bsDay(THU)],
      }),
    );
    // Issue #1080 made the Berufsschule priority general (`bsDayPriority()`): the OTHER row gives
    // way to the Berufsschultag exactly like COMPANY_SHUTDOWN, so the Thursday is reduced once and
    // the absence over the day equals the absence cut around it (the overlap D-12 reported).
    expect(other.expectedMinutes).toBe(otherCutAround.expectedMinutes);
    expect(other.balanceMinutes).toBe(otherCutAround.balanceMinutes);
  });

  // ── SHIFT_BASED ──────────────────────────────────────────────────────────────────────────────
  it("SHIFT_BASED: the shutdown week drops C_net by five contract days and yields no negative clause", () => {
    const worked = [entry("2026-01-05", 120)];
    const without = closeEmployeeMonth(baseInput(SHIFT_40_5, { entries: worked }));
    const withShutdown = closeEmployeeMonth(
      baseInput(SHIFT_40_5, { entries: worked, absences: [shutdown(MON, FRI)] }),
    );
    expect(without.expectedMinutes).toBe(10560);
    expect(withShutdown.expectedMinutes).toBe(10560 - 5 * 480);
    // No roster in the span: the undertime clause is measured against the roster, so the
    // shutdown can never produce a minus.
    expect(withShutdown.balanceMinutes).toBeGreaterThanOrEqual(0);
  });

  it("SHIFT_BASED: work beyond the reduced C_net stays overtime-relevant", () => {
    // 17 workdays (22 minus the shutdown week) of 510 net minutes = 8670 against C_net 8160.
    const days: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const ds = `2026-01-${String(d).padStart(2, "0")}`;
      const dow = new Date(ds + "T00:00:00Z").getUTCDay();
      if (dow >= 1 && dow <= 5 && (ds < MON || ds > FRI)) days.push(ds);
    }
    expect(days).toHaveLength(17);
    const result = closeEmployeeMonth(
      baseInput(SHIFT_40_5, {
        entries: days.map((ds) => entry(ds, 510, 30)),
        absences: [shutdown(MON, FRI)],
      }),
    );
    expect(result.expectedMinutes).toBe(8160);
    expect(result.balanceMinutes).toBe(result.workedMinutes - 8160);
    expect(result.balanceMinutes).toBeGreaterThan(0);
  });

  it("SHIFT_BASED: a Berufsschultag inside the span - the span equals the span cut around it", () => {
    const inside = closeEmployeeMonth(
      baseInput(SHIFT_40_5, { absences: [shutdown(MON, FRI), bsDay(THU)] }),
    );
    const cutAround = closeEmployeeMonth(
      baseInput(SHIFT_40_5, {
        absences: [shutdown(MON, WED), shutdown(FRI, FRI), bsDay(THU)],
      }),
    );
    expect(inside.expectedMinutes).toBe(cutAround.expectedMinutes);
    expect(inside.balanceMinutes).toBe(cutAround.balanceMinutes);
  });

  // ── MONTHLY_HOURS ────────────────────────────────────────────────────────────────────────────
  it("MONTHLY_HOURS: the shutdown workdays reduce the Soll by the Ø rate, a Berufsschultag inside is not reduced twice", () => {
    const without = closeEmployeeMonth(baseInput(MONTHLY_44));
    const week = closeEmployeeMonth(baseInput(MONTHLY_44, { absences: [shutdown(MON, FRI)] }));
    expect(week.expectedMinutes).toBeLessThan(without.expectedMinutes);

    const inside = closeEmployeeMonth(
      baseInput(MONTHLY_44, { absences: [shutdown(MON, FRI), bsDay(THU)] }),
    );
    const cutAround = closeEmployeeMonth(
      baseInput(MONTHLY_44, {
        absences: [shutdown(MON, WED), shutdown(FRI, FRI), bsDay(THU)],
      }),
    );
    expect(inside.expectedMinutes).toBe(cutAround.expectedMinutes);
    expect(inside.balanceMinutes).toBe(cutAround.balanceMinutes);
  });
});
