/**
 * Issue #1133 — under FLEXTIME a public holiday reduces the month Soll by the Ø-day
 * (weeklyHours ÷ contract workdays, the avgWorkMinutesCore source of the leave reduction), never
 * by the legacy 1/0 `{day}Hours` flag. A holiday on a non-contract weekday reduces nothing.
 *
 * DB-free: builds CloseMonthInput by hand and calls closeEmployeeMonth() directly (the shape of
 * close-employee-month-bs-absence-1080.test.ts).
 *
 * Contract of every case: 40 h on Tue-Fri (workDays [2,3,4,5], Ø-day 10 h = 600 min) with the
 * placeholder flag 1.00 on Mon-Fri - the shape of the one active FLEXTIME contract on prod.
 * The pins are derived by hand in each case.
 */
import { describe, it, expect } from "vitest";
import { closeEmployeeMonth, type CloseMonthInput } from "../close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../timezone";

const TZ = "Europe/Berlin";

const FLEX_40_TUE_FRI: Record<string, unknown> = {
  type: "FLEXTIME",
  weeklyHours: 40,
  mondayHours: 1,
  tuesdayHours: 1,
  wednesdayHours: 1,
  thursdayHours: 1,
  fridayHours: 1,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [2, 3, 4, 5],
};

const FIXED_40_MON_FRI: Record<string, unknown> = {
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

function input(
  schedule: Record<string, unknown>,
  year: number,
  month: number,
  holidays: string[],
  overrides: Partial<CloseMonthInput> = {},
): CloseMonthInput {
  const { start: monthStart, end: monthEnd } = monthRangeUtc(year, month, TZ);
  const { firstDay: monthFirstDay, lastDay: monthLastDay } = monthDayBounds(
    monthStart,
    monthEnd,
    TZ,
  );
  return {
    employeeId: "emp-1133",
    tz: TZ,
    carryOverIn: 0,
    schedule,
    hireDate: new Date("2025-01-01T00:00:00Z"),
    exitDate: null,
    isTimeTrackingExempt: false,
    breakOver6hOverride: 0,
    breakOver9hOverride: 0,
    entries: [],
    shifts: [],
    approvedLeave: [],
    absences: [],
    holidayDateStrings: new Set<string>(holidays),
    accountCorrections: [],
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

const soll = (i: CloseMonthInput) => closeEmployeeMonth(i).expectedMinutes;
const leave = (start: string, end: string): CloseMonthInput["approvedLeave"] => [
  {
    startDate: new Date(start + "T00:00:00Z"),
    endDate: new Date(end + "T00:00:00Z"),
    halfDay: false,
    isOvertimeCompensation: false,
    creditBasis: "CONTRACT",
  },
];

describe("Issue #1133 — FLEXTIME holiday reduces the Soll by the Ø-day", () => {
  it("May 2026: 17 Tue-Fri days, holidays Fri 1.5. + Thu 14.5. (contract days) and Mon 25.5. (not) → 150:00", () => {
    // May 2026 has 17 Tue-Fri days (Fri 1 + 5-8 + 12-15 + 19-22 + 26-29) → 17 × 600 = 10 200,
    // minus 1.5. and 14.5. = 9 000 min = 150:00. Mon 25.5. is no contract day and reduces nothing.
    // Before #1133 each holiday took its 1.00 flag: 10 200 − 3 × 60 = 10 020 (167:00).
    expect(soll(input(FLEX_40_TUE_FRI, 2026, 5, ["2026-05-01", "2026-05-14", "2026-05-25"]))).toBe(
      9000,
    );
  });

  it("April 2026: holidays Fri 3.4. (contract day) and Mon 6.4. (not) → 170:00", () => {
    // April 2026 has 18 Tue-Fri days → 10 800, minus Fri 3.4. = 10 200 min = 170:00.
    // Before #1133: 10 800 − 2 × 60 = 10 680 (178:00).
    expect(soll(input(FLEX_40_TUE_FRI, 2026, 4, ["2026-04-03", "2026-04-06"]))).toBe(10200);
  });

  it("a holiday on a non-contract Monday changes nothing", () => {
    expect(soll(input(FLEX_40_TUE_FRI, 2026, 4, ["2026-04-06"]))).toBe(
      soll(input(FLEX_40_TUE_FRI, 2026, 4, [])),
    );
  });

  it("each holiday on a contract day takes exactly one Ø-day (600 min)", () => {
    const without = soll(input(FLEX_40_TUE_FRI, 2026, 4, []));
    expect(without - soll(input(FLEX_40_TUE_FRI, 2026, 4, ["2026-04-03"]))).toBe(600);
  });

  it("a holiday inside approved leave still reduces the Soll exactly once", () => {
    // Leave Tue 31.3.-Fri 3.4. in April covers Wed 1.4.-Fri 3.4.; Fri 3.4. is a holiday.
    // Three contract days leave the month: 10 800 − 3 × 600 = 9 000.
    const withHoliday = soll(
      input(FLEX_40_TUE_FRI, 2026, 4, ["2026-04-03"], {
        approvedLeave: leave("2026-03-31", "2026-04-03"),
      }),
    );
    expect(withHoliday).toBe(9000);
    // Equivalence: the holiday alone and the leave alone over the same days agree.
    const leaveOnly = soll(
      input(FLEX_40_TUE_FRI, 2026, 4, [], { approvedLeave: leave("2026-03-31", "2026-04-03") }),
    );
    expect(withHoliday).toBe(leaveOnly);
  });

  it("FIXED_SCHEDULE keeps its {day}Hours holiday value (unchanged)", () => {
    // April 2026: 22 Mo-Fr days × 480 = 10 560, minus Fri 3.4. and Mon 6.4. 2 × 480 = 9 600.
    expect(soll(input(FIXED_40_MON_FRI, 2026, 4, ["2026-04-03", "2026-04-06"]))).toBe(9600);
  });
});
