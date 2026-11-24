/**
 * shift-netto.test.ts
 *
 * Phase 100 (OTC-04, Task 1) — pure unit pin for shift-netto.ts. No `getTestApp`, no DB.
 * Issue #1011: a shift now carries its date and the employee a birth date, because the planned
 * break is the recording's break rule (`breakAmountForDay`), raised to § 11 JArbSchG for a minor.
 * The adult cases keep their original expected values: that proves adult parity.
 */
import { describe, it, expect } from "vitest";
import { shiftBreakMinutes, shiftNettoMinutes, sumShiftNettoMinutes } from "../shift-netto";
import { planAutoBreak } from "../../time-tracking/auto-break-plan";
import { breakAmountFor } from "../../time-tracking/break-amount";
import { isMinorAtDate } from "../../absence";
import type { AutoBreakEmployee } from "../../time-tracking/auto-break-plan";
import type { BreakTenantConfigShape } from "../../time-tracking/break-effective";

/** Mon 16.11.2026, UTC midnight — the stored `Shift.date` of a work day. */
const DAY = new Date("2026-11-16T00:00:00.000Z");
/** Adult shape: no override, no birth date (fail-open: a missing birth date is not a minor). */
const NO_OVERRIDE: AutoBreakEmployee = {
  breakOver6hOverride: null,
  breakOver9hOverride: null,
  birthDate: null,
};
/** 16 years old on DAY. */
const MINOR: AutoBreakEmployee = {
  ...NO_OVERRIDE,
  birthDate: new Date("2010-05-01T00:00:00.000Z"),
};
const TENANT_DEFAULTS: BreakTenantConfigShape = { defaultBreakOver6h: 30, defaultBreakOver9h: 45 };

describe("shiftNettoMinutes", () => {
  it("06:00-14:00 (480 brutto), tenant defaults 30/45, no employee override -> break 30 -> netto 450", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "06:00", endTime: "14:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(450);
  });

  it("08:00-14:00 (360 brutto) is exactly 6h -- STRICT > boundary means no break -> netto 360", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "08:00", endTime: "14:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(360);
  });

  it("08:00-17:00 (540 brutto) is exactly 9h -- STRICT > boundary means the over-6h tier (30min) -> netto 510", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "08:00", endTime: "17:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(510);
  });

  it("06:00-16:00 (600 brutto) is over 9h -> break 45 -> netto 555", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "06:00", endTime: "16:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(555);
  });

  it("employee breakOver6hOverride wins over the tenant default for a 480-brutto shift -> break 15 -> netto 465", () => {
    const employee: AutoBreakEmployee = { ...NO_OVERRIDE, breakOver6hOverride: 15 };
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "06:00", endTime: "14:00" },
        employee,
        TENANT_DEFAULTS,
      ),
    ).toBe(465);
  });

  it("22:00-06:00 crosses midnight: brutto is 480 (not -960) -> netto 450", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "22:00", endTime: "06:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(450);
  });

  it("08:00-08:00 (zero-length shift): brutto 0 -> contributes 0, never negative", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "08:00", endTime: "08:00" },
        NO_OVERRIDE,
        TENANT_DEFAULTS,
      ),
    ).toBe(0);
  });

  it("a break configured longer than the shift floors netto at 0, never negative", () => {
    // 08:00-18:00 = 600 brutto (over 9h); the employee's over-9h override (650) exceeds the shift itself.
    const employee: AutoBreakEmployee = { ...NO_OVERRIDE, breakOver9hOverride: 650 };
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "08:00", endTime: "18:00" },
        employee,
        TENANT_DEFAULTS,
      ),
    ).toBe(0);
  });
});

describe("sumShiftNettoMinutes", () => {
  it("returns 0 for an empty list", () => {
    expect(sumShiftNettoMinutes([], NO_OVERRIDE, TENANT_DEFAULTS)).toBe(0);
  });

  it("sums the individual nettos of three shifts", () => {
    const shifts = [
      { date: DAY, startTime: "06:00", endTime: "14:00" }, // 480 brutto -> 450 netto
      { date: DAY, startTime: "08:00", endTime: "14:00" }, // 360 brutto -> 360 netto (exactly 6h, no break)
      { date: DAY, startTime: "06:00", endTime: "16:00" }, // 600 brutto -> 555 netto
    ];
    expect(sumShiftNettoMinutes(shifts, NO_OVERRIDE, TENANT_DEFAULTS)).toBe(450 + 360 + 555);
  });
});

describe("minors (Issue #1011) — § 11 JArbSchG via § 18 Abs. 2 ArbZG", () => {
  it("08:00-17:00 nets to 480 for a 16-year-old (60 min break), 510 for an adult", () => {
    const shift = { date: DAY, startTime: "08:00", endTime: "17:00" };
    expect(shiftNettoMinutes(shift, MINOR, TENANT_DEFAULTS)).toBe(480);
    expect(shiftNettoMinutes(shift, NO_OVERRIDE, TENANT_DEFAULTS)).toBe(510);
  });

  it("08:00-13:00 (300 brutto, over 4.5 h) deducts 30 min for a minor -> 270; the adult rule gives 300", () => {
    const shift = { date: DAY, startTime: "08:00", endTime: "13:00" };
    expect(shiftNettoMinutes(shift, MINOR, TENANT_DEFAULTS)).toBe(270);
    expect(shiftNettoMinutes(shift, NO_OVERRIDE, TENANT_DEFAULTS)).toBe(300);
  });

  it("08:00-14:15 (375 brutto, over 6 h) deducts 60 min for a minor -> 315", () => {
    expect(
      shiftNettoMinutes(
        { date: DAY, startTime: "08:00", endTime: "14:15" },
        MINOR,
        TENANT_DEFAULTS,
      ),
    ).toBe(315);
  });

  it("a shift ON the 18th birthday is an adult shift (§ 187 Abs. 2 S. 2 BGB) -> the adult value", () => {
    const turns18: AutoBreakEmployee = {
      ...NO_OVERRIDE,
      birthDate: new Date("2008-11-16T00:00:00.000Z"),
    };
    const shift = { date: DAY, startTime: "08:00", endTime: "17:00" };
    expect(shiftNettoMinutes(shift, turns18, TENANT_DEFAULTS)).toBe(510);
    // the day before the birthday is still a minor day
    const dayBefore = { ...shift, date: new Date("2026-11-15T00:00:00.000Z") };
    expect(shiftNettoMinutes(dayBefore, turns18, TENANT_DEFAULTS)).toBe(480);
  });

  it("a zero-length shift has no break and no netto for a minor either", () => {
    const shift = { date: DAY, startTime: "08:00", endTime: "08:00" };
    expect(shiftBreakMinutes(shift, MINOR, TENANT_DEFAULTS)).toBe(0);
    expect(shiftNettoMinutes(shift, MINOR, TENANT_DEFAULTS)).toBe(0);
  });
});

describe("one break rule for the roster and the recording (Issue #1011)", () => {
  const PROFILES: Array<[string, AutoBreakEmployee]> = [
    ["adult", NO_OVERRIDE],
    [
      "adult with overrides 45/60",
      { ...NO_OVERRIDE, breakOver6hOverride: 45, breakOver9hOverride: 60 },
    ],
    ["minor", MINOR],
    ["minor with override 45", { ...MINOR, breakOver6hOverride: 45 }],
  ];
  const TENANT_AUTO = { ...TENANT_DEFAULTS, autoBreakEnabled: true, defaultBreakStart: null };
  const START = Date.UTC(2026, 10, 16, 8, 0);

  for (const [label, employee] of PROFILES) {
    it(`${label}: shiftBreakMinutes equals breakAmountFor for every presence 0..720 min (15-min steps), and planAutoBreak places the same amount`, () => {
      let planned = 0;
      for (let presence = 0; presence <= 720; presence += 15) {
        const end = new Date(START + presence * 60000);
        const hh = String(end.getUTCHours()).padStart(2, "0");
        const mm = String(end.getUTCMinutes()).padStart(2, "0");
        const shift = { date: DAY, startTime: "08:00", endTime: `${hh}:${mm}` };
        const fromRoster = shiftBreakMinutes(shift, employee, TENANT_DEFAULTS);
        const fromRule =
          presence === 0
            ? 0 // a shift of no length has no break
            : breakAmountFor({
                employee,
                tenantConfig: TENANT_DEFAULTS,
                presenceMin: presence,
                isMinor: isMinorAtDate(employee.birthDate, DAY),
              }).amountMin;
        expect(fromRoster, `presence ${presence}`).toBe(fromRule);

        const plan = planAutoBreak({
          employee,
          tenantConfig: TENANT_AUTO,
          start: new Date(START),
          end,
          entryDate: DAY,
          tz: "Europe/Berlin",
        });
        if (plan) {
          planned += 1;
          expect(plan.amountMin, `presence ${presence}`).toBe(fromRoster);
        }
      }
      // the recording placed a break for at least some presences, so the comparison is not vacuous
      expect(planned).toBeGreaterThan(0);
    });
  }
});
