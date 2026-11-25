/**
 * Issue #1056 (D-01, D-05, D-06, D-08) — the SHIFT_BASED roster Soll nets a planned shift with the
 * ONE break rule `breakAmountFor` (§ 11 JArbSchG for a person under 18 on the shift date, § 18
 * Abs. 2 ArbZG; § 4 ArbZG otherwise), the same rule the recording and the Dienstplan use.
 *
 * DB-free: builds `CloseMonthInput` objects by hand. Pins
 *   - `rosterShiftBreakMinutes` at the § 11 thresholds, the 17th and the 18th birthday, and against
 *     the Dienstplan's `shiftNettoMinutes` (parity sweep);
 *   - the core: a minor's October (four shifts 08:00-17:00, worked with the prescribed 60 min break)
 *     closes at 0, the same input without a birth date at -120 (the pre-#1056 adult rule);
 *   - adults and persons without a birth date stay byte-identical (the WHOLE result);
 *   - the ROSTER-basis sick-day relief of a minor (Lohnausfallprinzip, § 4 EFZG);
 *   - other schedule types never read the birth date.
 */
import { describe, it, expect } from "vitest";
import {
  closeEmployeeMonth,
  rosterShiftBreakMinutes,
  type CloseMonthInput,
  type LeaveCreditBasis,
} from "../close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../timezone";
import { shiftNettoMinutes } from "../../scheduling";
import { getEffectiveBreakDuration } from "../../time-tracking";

const TZ = "Europe/Berlin";
const TENANT = { defaultBreakOver6h: 30, defaultBreakOver9h: 45 };
const SHIFT_DATE = new Date("2026-10-12T00:00:00Z");

const NO_OVERRIDES = { breakOver6hOverride: null, breakOver9hOverride: null };
const born = (iso: string | null) => (iso === null ? null : new Date(iso + "T00:00:00Z"));

describe("rosterShiftBreakMinutes — the one roster-break rule of the Arbeitszeitkonto", () => {
  const BRUTTO = [270, 271, 360, 361, 540, 541, 600];

  it("minor (born 2010-05-01): § 11 JArbSchG thresholds 4.5 h -> 30, 6 h -> 60", () => {
    const minor = { ...NO_OVERRIDES, birthDate: born("2010-05-01") };
    expect(BRUTTO.map((b) => rosterShiftBreakMinutes(minor, TENANT, b, SHIFT_DATE))).toEqual([
      0, 30, 30, 60, 60, 60, 60,
    ]);
  });

  it("adult (born 1990-01-01): the pre-#1056 rule, equal to getEffectiveBreakDuration", () => {
    const adult = { ...NO_OVERRIDES, birthDate: born("1990-01-01") };
    expect(BRUTTO.map((b) => rosterShiftBreakMinutes(adult, TENANT, b, SHIFT_DATE))).toEqual([
      0, 0, 0, 30, 30, 45, 45,
    ]);
    for (const b of BRUTTO) {
      expect(rosterShiftBreakMinutes(adult, TENANT, b, SHIFT_DATE)).toBe(
        getEffectiveBreakDuration(adult, TENANT, b),
      );
    }
  });

  it("overrides 0/0 (the golden Azubi shape): a minor still gets the § 11 minimum, an adult none", () => {
    const zero = { breakOver6hOverride: 0, breakOver9hOverride: 0 };
    expect(
      rosterShiftBreakMinutes({ ...zero, birthDate: born("2010-05-01") }, TENANT, 540, SHIFT_DATE),
    ).toBe(60);
    expect(
      rosterShiftBreakMinutes({ ...zero, birthDate: born("1990-01-01") }, TENANT, 540, SHIFT_DATE),
    ).toBe(0);
  });

  it("a configured break above the minimum stays for a minor (75 > 60)", () => {
    const e = {
      breakOver6hOverride: 75,
      breakOver9hOverride: null,
      birthDate: born("2010-05-01"),
    };
    expect(rosterShiftBreakMinutes(e, TENANT, 540, SHIFT_DATE)).toBe(75);
  });

  it("the age is decided per shift date: the 18th birthday itself is adult (§ 187 Abs. 2 S. 2 BGB)", () => {
    const d = (iso: string) => new Date(iso + "T00:00:00Z");
    const turns18 = { ...NO_OVERRIDES, birthDate: born("2008-10-14") };
    expect(rosterShiftBreakMinutes(turns18, TENANT, 540, d("2026-10-13"))).toBe(60);
    expect(rosterShiftBreakMinutes(turns18, TENANT, 540, d("2026-10-14"))).toBe(30);
    expect(rosterShiftBreakMinutes(turns18, TENANT, 540, d("2026-10-15"))).toBe(30);
    // The 17th birthday changes nothing: still a minor.
    const turns17 = { ...NO_OVERRIDES, birthDate: born("2009-10-14") };
    for (const day of ["2026-10-13", "2026-10-14", "2026-10-15"]) {
      expect(rosterShiftBreakMinutes(turns17, TENANT, 540, d(day))).toBe(60);
    }
  });

  it("a null or undefined birth date gives the adult value (fail-open)", () => {
    expect(
      rosterShiftBreakMinutes({ ...NO_OVERRIDES, birthDate: null }, TENANT, 540, SHIFT_DATE),
    ).toBe(30);
    expect(
      rosterShiftBreakMinutes({ ...NO_OVERRIDES, birthDate: undefined }, TENANT, 540, SHIFT_DATE),
    ).toBe(30);
  });

  it("parity sweep: the Konto and the Dienstplan net the same shift the same way", () => {
    const persons = [
      { ...NO_OVERRIDES, birthDate: born("1990-01-01") },
      { breakOver6hOverride: 45, breakOver9hOverride: 60, birthDate: born("1990-01-01") },
      { ...NO_OVERRIDES, birthDate: born("2010-05-01") },
      { breakOver6hOverride: 0, breakOver9hOverride: 0, birthDate: born("2010-05-01") },
      { breakOver6hOverride: 45, breakOver9hOverride: 45, birthDate: born("2010-05-01") },
      { ...NO_OVERRIDES, birthDate: null },
    ];
    const bruttos: number[] = [271, 361, 541];
    for (let b = 15; b <= 720; b += 15) bruttos.push(b);
    const hm = (min: number) =>
      `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    for (const person of persons) {
      for (const brutto of bruttos) {
        const shift = { date: SHIFT_DATE, startTime: "08:00", endTime: hm(8 * 60 + brutto) };
        const konto = Math.max(
          0,
          brutto - rosterShiftBreakMinutes(person, TENANT, brutto, SHIFT_DATE),
        );
        expect(konto, `brutto ${brutto}, ${JSON.stringify(person)}`).toBe(
          shiftNettoMinutes(shift, person, TENANT),
        );
        if (person.birthDate === null || person.birthDate.getUTCFullYear() === 1990) {
          expect(rosterShiftBreakMinutes(person, TENANT, brutto, SHIFT_DATE)).toBe(
            getEffectiveBreakDuration(person, TENANT, brutto),
          );
        }
      }
    }
  });
});

// ── closeEmployeeMonth ──────────────────────────────────────────────────────

const SHIFT_40_5: Record<string, unknown> = {
  type: "SHIFT_BASED",
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
const FIXED_40_5: Record<string, unknown> = { ...SHIFT_40_5, type: "FIXED_SCHEDULE" };

/** 540 min presence (08:00-17:00 UTC) with the 60 min break a minor is prescribed -> 480 worked. */
function mkEntry(dateStr: string): CloseMonthInput["entries"][number] {
  return {
    date: new Date(dateStr + "T00:00:00Z"),
    startTime: new Date(dateStr + "T08:00:00Z"),
    endTime: new Date(dateStr + "T17:00:00Z"),
    breakMinutes: 60,
  };
}

function mkShift(dateStr: string): CloseMonthInput["shifts"][number] {
  return { date: new Date(dateStr + "T00:00:00Z"), startTime: "08:00", endTime: "17:00" };
}

function mkLeave(
  start: string,
  end: string,
  creditBasis: LeaveCreditBasis,
): CloseMonthInput["approvedLeave"][number] {
  return {
    startDate: new Date(start + "T00:00:00Z"),
    endDate: new Date(end + "T00:00:00Z"),
    halfDay: false,
    isOvertimeCompensation: false,
    creditBasis,
  };
}

const WEEK_DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];

function octoberInput(
  schedule: Record<string, unknown>,
  extra: Partial<CloseMonthInput> = {},
): CloseMonthInput {
  const { start: monthStart, end: monthEnd } = monthRangeUtc(2026, 10, TZ);
  const { firstDay: monthFirstDay, lastDay: monthLastDay } = monthDayBounds(
    monthStart,
    monthEnd,
    TZ,
  );
  return {
    employeeId: "emp-1056",
    monthStart,
    monthEnd,
    monthFirstDay,
    monthLastDay,
    tz: TZ,
    carryOverIn: 0,
    schedule,
    hireDate: new Date("2026-10-01T00:00:00Z"),
    exitDate: null,
    isTimeTrackingExempt: false,
    breakOver6hOverride: null,
    breakOver9hOverride: null,
    entries: WEEK_DAYS.map(mkEntry),
    shifts: WEEK_DAYS.map(mkShift),
    approvedLeave: [],
    absences: [],
    holidayDateStrings: new Set<string>(),
    tenantConfig: TENANT,
    ...extra,
  };
}

describe("closeEmployeeMonth — Issue #1056 roster Soll of a minor", () => {
  it("born 2009-10-14 (17 all October): balance 0, the same input without birthDate -120", () => {
    const without = closeEmployeeMonth(octoberInput(SHIFT_40_5));
    expect(without.balanceMinutes).toBe(-120);
    const minor = closeEmployeeMonth(octoberInput(SHIFT_40_5, { birthDate: born("2009-10-14") }));
    expect(minor.balanceMinutes).toBe(0);
    expect(minor.workedMinutes).toBe(1920);
    expect(minor.workedMinutes).toBe(without.workedMinutes);
    expect(minor.expectedMinutes).toBe(without.expectedMinutes);
  });

  it("born 2008-10-14 (18 from 14.10.): -60 — two shifts at 60 min break, two at 30", () => {
    const r = closeEmployeeMonth(octoberInput(SHIFT_40_5, { birthDate: born("2008-10-14") }));
    expect(r.balanceMinutes).toBe(-60);
  });

  it("adult and no birth date: the WHOLE result equals the result without birthDate", () => {
    const reference = closeEmployeeMonth(octoberInput(SHIFT_40_5));
    expect(closeEmployeeMonth(octoberInput(SHIFT_40_5, { birthDate: born("1990-01-01") }))).toEqual(
      reference,
    );
    expect(closeEmployeeMonth(octoberInput(SHIFT_40_5, { birthDate: null }))).toEqual(reference);
    expect(reference.balanceMinutes).toBe(-120);
  });

  it("ROSTER sick day on a shift: a minor's relief is the netto with the § 11 break (480, not 510)", () => {
    const extra = {
      shifts: [...WEEK_DAYS, "2026-10-16"].map(mkShift),
      entries: WEEK_DAYS.map(mkEntry),
      approvedLeave: [mkLeave("2026-10-16", "2026-10-16", "ROSTER")],
    };
    const without = closeEmployeeMonth(octoberInput(SHIFT_40_5, extra));
    const minor = closeEmployeeMonth(
      octoberInput(SHIFT_40_5, { ...extra, birthDate: born("2009-10-14") }),
    );
    expect(minor.expectedMinutes).toBe(without.expectedMinutes + 30);
    expect(minor.balanceMinutes).toBe(0);
    const adult = closeEmployeeMonth(
      octoberInput(SHIFT_40_5, { ...extra, birthDate: born("1990-01-01") }),
    );
    expect(adult).toEqual(without);
  });

  it("FIXED_SCHEDULE never reads the birth date: the WHOLE result is identical", () => {
    expect(closeEmployeeMonth(octoberInput(FIXED_40_5, { birthDate: born("2009-10-14") }))).toEqual(
      closeEmployeeMonth(octoberInput(FIXED_40_5)),
    );
  });
});
