/**
 * Issue #1080 — a Berufsschultag inside an imposed absence of any other code (OTHER, MATERNITY,
 * PARENTAL, and every later code such as COMPANY_SHUTDOWN of #1069) reduces the Soll exactly
 * once: "Berufsschule hat Vorrang", as it already does for approved leave (#448, D-03).
 *
 * DB-free: builds CloseMonthInput by hand and calls closeEmployeeMonth() directly, the shape of
 * close-employee-month-bs-leave.test.ts (#448).
 *
 * The oracle is EQUIVALENCE, not a number copied from a run: one absence spanning the
 * Berufsschultag must produce the IDENTICAL month figures as the same absence split around that
 * day. The absolute pins are derived by hand in the comment of each case. The same scenario runs
 * through the real DB/HTTP paths in golden-matrix.test.ts (`az-fixed-38-5-bs_absence`,
 * `az-shift-38-5-bs_absence`).
 */
import { describe, it, expect } from "vitest";
import { closeEmployeeMonth, type CloseMonthInput } from "../close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../timezone";
import { ABSENCE_CODES } from "../../absence/leave-type";

const TZ = "Europe/Berlin";

// Every Absence code except the Berufsschule itself; derived, so a later code is covered
// without an edit here.
const NON_BS_CODES = ABSENCE_CODES.filter((c) => c !== "VOCATIONAL_SCHOOL");

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
// January 2026 has 22 Mo-Fr days, so 176 h a month is exactly 480 minutes a day.
const MONTHLY_176: Record<string, unknown> = {
  type: "MONTHLY_HOURS",
  monthlyHours: 176,
  mondayHours: 0,
  tuesdayHours: 0,
  wednesdayHours: 0,
  thursdayHours: 0,
  fridayHours: 0,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
};

const SCHEDULES: Array<[string, Record<string, unknown>]> = [
  ["FIXED_SCHEDULE", FIXED_40_5],
  ["FLEXTIME", { ...FIXED_40_5, type: "FLEXTIME" }],
  ["SHIFT_BASED", { ...FIXED_40_5, type: "SHIFT_BASED" }],
  ["MONTHLY_HOURS", MONTHLY_176],
];

function mkAbsence(
  code: string,
  start: string,
  end: string,
  opts: { halfDay?: boolean } = {},
): CloseMonthInput["absences"][number] {
  return {
    startDate: new Date(start + "T00:00:00Z"),
    endDate: new Date(end + "T00:00:00Z"),
    type: code,
    source: "MANUAL",
    halfDay: opts.halfDay ?? false,
  };
}

function mkBs(
  date: string,
  source: "PATTERN" | "MANUAL" = "PATTERN",
): CloseMonthInput["absences"][number] {
  return {
    startDate: new Date(date + "T00:00:00Z"),
    endDate: new Date(date + "T00:00:00Z"),
    type: "VOCATIONAL_SCHOOL",
    source,
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
    employeeId: "emp-1080",
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

function figures(input: CloseMonthInput) {
  const r = closeEmployeeMonth(input);
  return {
    expectedMinutes: r.expectedMinutes,
    workedMinutes: r.workedMinutes,
    balanceMinutes: r.balanceMinutes,
  };
}

describe("Issue #1080 — the derived code list", () => {
  it("covers OTHER, MATERNITY and PARENTAL and never the Berufsschule", () => {
    expect(NON_BS_CODES).toEqual(expect.arrayContaining(["OTHER", "MATERNITY", "PARENTAL"]));
    expect(NON_BS_CODES).not.toContain("VOCATIONAL_SCHOOL");
  });
});

describe.each(NON_BS_CODES)(
  "Issue #1080 — %s over a Berufsschultag reduces the Soll once",
  (code) => {
    it.each(SCHEDULES)(
      "%s: one absence 12.-16.01. over a PATTERN Berufsschultag (Wed 14.01.) == the absence split around it",
      (_name, schedule) => {
        const combined = figures(
          baseInput(schedule, {
            absences: [mkAbsence(code, "2026-01-12", "2026-01-16"), mkBs("2026-01-14")],
          }),
        );
        const split = figures(
          baseInput(schedule, {
            absences: [
              mkAbsence(code, "2026-01-12", "2026-01-13"),
              mkAbsence(code, "2026-01-15", "2026-01-16"),
              mkBs("2026-01-14"),
            ],
          }),
        );
        expect(combined).toEqual(split);
      },
    );

    it.each(SCHEDULES)(
      "%s: a half-day absence on the Berufsschultag == the Berufsschule row alone (D-05)",
      (_name, schedule) => {
        const withHalfDay = figures(
          baseInput(schedule, {
            absences: [
              mkAbsence(code, "2026-01-14", "2026-01-14", { halfDay: true }),
              mkBs("2026-01-14"),
            ],
          }),
        );
        const bsOnly = figures(baseInput(schedule, { absences: [mkBs("2026-01-14")] }));
        expect(withHalfDay).toEqual(bsOnly);
      },
    );

    it("MONTHLY_HOURS + MANUAL-source Berufsschultag: absence over it == the split absence", () => {
      const combined = figures(
        baseInput(MONTHLY_176, {
          absences: [mkAbsence(code, "2026-01-12", "2026-01-16"), mkBs("2026-01-14", "MANUAL")],
        }),
      );
      const split = figures(
        baseInput(MONTHLY_176, {
          absences: [
            mkAbsence(code, "2026-01-12", "2026-01-13"),
            mkAbsence(code, "2026-01-15", "2026-01-16"),
            mkBs("2026-01-14", "MANUAL"),
          ],
        }),
      );
      expect(combined).toEqual(split);
    });

    // Control (D-04): a MANUAL-source Berufsschultag takes part in the day dedup of the other
    // schedule types, so it was already counted once there — green before and after the fix.
    it.each(SCHEDULES.filter(([n]) => n !== "MONTHLY_HOURS"))(
      "%s + MANUAL-source Berufsschultag: absence over it == the split absence (control)",
      (_name, schedule) => {
        const combined = figures(
          baseInput(schedule, {
            absences: [mkAbsence(code, "2026-01-12", "2026-01-16"), mkBs("2026-01-14", "MANUAL")],
          }),
        );
        const split = figures(
          baseInput(schedule, {
            absences: [
              mkAbsence(code, "2026-01-12", "2026-01-13"),
              mkAbsence(code, "2026-01-15", "2026-01-16"),
              mkBs("2026-01-14", "MANUAL"),
            ],
          }),
        );
        expect(combined).toEqual(split);
      },
    );

    // Control (D-05): a holiday on the Berufsschultag was already excluded from the absence credit
    // by the dedup set; the fix must leave this unchanged.
    it("FIXED + holiday on the Berufsschultag: absence over it == the split absence (control)", () => {
      const holidays = new Set(["2026-01-14"]);
      const combined = figures(
        baseInput(FIXED_40_5, {
          holidayDateStrings: holidays,
          absences: [mkAbsence(code, "2026-01-12", "2026-01-16"), mkBs("2026-01-14")],
        }),
      );
      const split = figures(
        baseInput(FIXED_40_5, {
          holidayDateStrings: holidays,
          absences: [
            mkAbsence(code, "2026-01-12", "2026-01-13"),
            mkAbsence(code, "2026-01-15", "2026-01-16"),
            mkBs("2026-01-14"),
          ],
        }),
      );
      expect(combined).toEqual(split);
    });
  },
);

describe("Issue #1080 — absolute pins (hand-derived)", () => {
  // contractSoll = 22 Mo-Fr x 480 = 10560. Absence credit = 4 non-BS days x 480 = 1920.
  // Berufsschule: Oe-method credit 480 subtracted once, the § 15 BBiG FIRST_LONG_DAY credit
  // (individual daily Soll = 480) re-added: net 0. expectedMinutes = 10560 - 1920 = 8640.
  // workedMinutes = the Berufsschule credit 480; balance = 480 - 8640 = -8160.
  // Before the fix the Berufsschultag was reduced twice: 8160 / 480 / -7680.
  it.each(["OTHER", "MATERNITY", "PARENTAL"])("FIXED_SCHEDULE + %s over Wed 14.01.", (code) => {
    const f = figures(
      baseInput(FIXED_40_5, {
        absences: [mkAbsence(code, "2026-01-12", "2026-01-16"), mkBs("2026-01-14")],
      }),
    );
    expect(f).toEqual({ expectedMinutes: 8640, workedMinutes: 480, balanceMinutes: -8160 });
  });

  // SHIFT_BASED, no shifts, no entries: C_net = max(0, 10560 - 1920 - 480) + 480 = 8640
  // (the Oe-credit of the Berufsschultag and its bsExpected cancel). Before the fix 8160.
  it("SHIFT_BASED + OTHER over Wed 14.01.: expectedMinutes 8640", () => {
    const f = figures(
      baseInput(
        { ...FIXED_40_5, type: "SHIFT_BASED" },
        {
          absences: [mkAbsence("OTHER", "2026-01-12", "2026-01-16"), mkBs("2026-01-14")],
        },
      ),
    );
    expect(f.expectedMinutes).toBe(8640);
  });

  // MONTHLY_HOURS 176 h: owed Soll 10560, day value 480. The absence reduces 4 non-BS days
  // (1920); the Berufsschultag reduces nothing (credited to Ist only, #433 D-07):
  // expectedMinutes 8640, workedMinutes 480. Before the fix 8160 (5 days reduced).
  it("MONTHLY_HOURS + MATERNITY over Wed 14.01.: expected 8640, worked 480", () => {
    const f = figures(
      baseInput(MONTHLY_176, {
        absences: [mkAbsence("MATERNITY", "2026-01-12", "2026-01-16"), mkBs("2026-01-14")],
      }),
    );
    expect(f.expectedMinutes).toBe(8640);
    expect(f.workedMinutes).toBe(480);
  });
});
