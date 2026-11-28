/**
 * Issue #156 - month arithmetic on UTC dates must not overflow on day 29-31.
 *
 * `setUTCMonth(getUTCMonth() - n)` on 31 July lands on "31 February" = 3 March, so the six-month
 * overtime-trend window started a month late on those days. `monthWindowFloorUtc` and
 * `addUtcMonthsClamped` build the result from (year, month, day) and cannot overflow.
 */
import { describe, it, expect } from "vitest";
import { addUtcMonthsClamped, monthWindowFloorUtc } from "../utils/month-window";

const iso = (d: Date) => d.toISOString();

/** Independent oracle: last day of the month `monthsBack + 1` months before (year, month0). */
function expectedFloor(year: number, month0: number, monthsBack: number): string {
  const total = year * 12 + month0 - monthsBack - 1;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][tm];
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(days).padStart(2, "0")}T00:00:00.000Z`;
}

describe("monthWindowFloorUtc (Issue #156)", () => {
  it("31 July, 5 months back: the window starts in February (floor = 31 January)", () => {
    expect(iso(monthWindowFloorUtc(new Date("2026-07-31T10:00:00Z"), 5))).toBe(
      "2026-01-31T00:00:00.000Z",
    );
  });

  it("30 and 29 July give the same floor as 15 July (no overflow past the short month)", () => {
    for (const day of ["2026-07-15", "2026-07-29", "2026-07-30", "2026-07-31"]) {
      expect(iso(monthWindowFloorUtc(new Date(`${day}T23:59:59Z`), 5))).toBe(
        "2026-01-31T00:00:00.000Z",
      );
    }
  });

  it("31 March, 1 month back: floor = 31 January, not 28 February", () => {
    expect(iso(monthWindowFloorUtc(new Date("2026-03-31T10:00:00Z"), 1))).toBe(
      "2026-01-31T00:00:00.000Z",
    );
  });

  it("31 August, 6 months back: floor = 31 January (the old code gave 28 February)", () => {
    expect(iso(monthWindowFloorUtc(new Date("2026-08-31T10:00:00Z"), 6))).toBe(
      "2026-01-31T00:00:00.000Z",
    );
  });

  it("rolls the year backwards", () => {
    expect(iso(monthWindowFloorUtc(new Date("2026-03-31T10:00:00Z"), 5))).toBe(
      "2025-09-30T00:00:00.000Z",
    );
  });

  it("matches the independent oracle on every day of a leap and a common year", () => {
    for (const year of [2026, 2028]) {
      for (let month0 = 0; month0 < 12; month0++) {
        const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
        for (let day = 1; day <= lastDay; day++) {
          for (const back of [1, 5, 6]) {
            expect(iso(monthWindowFloorUtc(new Date(Date.UTC(year, month0, day, 12)), back))).toBe(
              expectedFloor(year, month0, back),
            );
          }
        }
      }
    }
  });
});

describe("addUtcMonthsClamped (Issue #156)", () => {
  it("clamps to the end of a shorter target month instead of spilling into the next", () => {
    expect(iso(addUtcMonthsClamped(new Date("2026-08-31T10:30:00Z"), 6))).toBe(
      "2027-02-28T10:30:00.000Z",
    );
    expect(iso(addUtcMonthsClamped(new Date("2027-08-31T10:30:00Z"), 6))).toBe(
      "2028-02-29T10:30:00.000Z",
    );
    expect(iso(addUtcMonthsClamped(new Date("2026-01-31T00:00:00Z"), 1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("keeps the day when the target month is long enough, and the time of day", () => {
    expect(iso(addUtcMonthsClamped(new Date("2026-03-15T08:09:10.011Z"), 6))).toBe(
      "2026-09-15T08:09:10.011Z",
    );
  });

  it("rolls the year forward and handles negative months", () => {
    expect(iso(addUtcMonthsClamped(new Date("2026-11-30T00:00:00Z"), 3))).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(iso(addUtcMonthsClamped(new Date("2026-03-31T00:00:00Z"), -1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});
