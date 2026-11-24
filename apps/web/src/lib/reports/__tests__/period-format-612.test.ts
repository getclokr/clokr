// Issue #612 (UI-SPEC "Number format", Pitfall 8) — German hours from minutes and days.

import { describe, it, expect } from "vitest";
import {
  fmtDateDe,
  fmtDateShortDe,
  fmtDaysDe,
  fmtHoursDe,
  monthNameDe,
  runningMonthNote,
  runningMonthStichtag,
} from "../period-format";

describe("fmtHoursDe", () => {
  it("formats minutes as H:MM", () => {
    expect(fmtHoursDe(0)).toBe("0:00");
    expect(fmtHoursDe(59)).toBe("0:59");
    expect(fmtHoursDe(60)).toBe("1:00");
  });

  it("groups the hour part with a German thousands separator", () => {
    expect(fmtHoursDe(59_999)).toBe("999:59");
    expect(fmtHoursDe(60_000)).toBe("1.000:00");
    expect(fmtHoursDe(230_535)).toBe("3.842:15");
    expect(fmtHoursDe(60 * 1_234_567)).toBe("1.234.567:00");
  });

  it("signs with a character when asked: + , U+2212 and ±", () => {
    expect(fmtHoursDe(0, { signed: true })).toBe("±0:00");
    expect(fmtHoursDe(765, { signed: true })).toBe("+12:45");
    expect(fmtHoursDe(-45, { signed: true })).toBe("−0:45");
    expect(fmtHoursDe(-45, { signed: true })).not.toContain("-");
    expect(fmtHoursDe(72_270, { signed: true })).toBe("+1.204:30");
    expect(fmtHoursDe(-72_270, { signed: true })).toBe("−1.204:30");
  });

  it("never shows a negative zero as a minus", () => {
    expect(fmtHoursDe(-0.2, { signed: true })).toBe("±0:00");
  });

  it("keeps the minute part exact (no decimal-hour detour)", () => {
    // 7.1 h as decimal hours would be 426 min; the minutes are the truth
    expect(fmtHoursDe(426)).toBe("7:06");
    expect(fmtHoursDe(1)).toBe("0:01");
  });
});

describe("fmtDaysDe", () => {
  it("uses at most one decimal comma", () => {
    expect(fmtDaysDe(12.5)).toBe("12,5");
    expect(fmtDaysDe(12)).toBe("12");
    expect(fmtDaysDe(0.25)).toBe("0,3");
    expect(fmtDaysDe(0)).toBe("0");
    expect(fmtDaysDe(30.04)).toBe("30");
  });

  it("groups large day counts and keeps a real minus", () => {
    expect(fmtDaysDe(1234.5)).toBe("1.234,5");
    expect(fmtDaysDe(-2.5)).toBe("−2,5");
    expect(fmtDaysDe(-0.01)).toBe("0");
  });
});

describe("dates and month names", () => {
  it("formats an ISO day", () => {
    expect(fmtDateDe("2026-03-31")).toBe("31.03.2026");
    expect(fmtDateShortDe("2026-03-31")).toBe("31.03.");
  });

  it("returns something that is no ISO day unchanged", () => {
    expect(fmtDateDe("n/a")).toBe("n/a");
    expect(fmtDateShortDe("")).toBe("");
  });

  it("names a month", () => {
    expect(monthNameDe(2026, 7)).toBe("Juli 2026");
    expect(monthNameDe(2026, 3)).toBe("März 2026");
  });
});

// Issue #1011: the one running-month rule.
describe("runningMonthStichtag", () => {
  it("is the day itself while it lies before the month's last day", () => {
    expect(runningMonthStichtag("2026-11", "2026-11-14")).toBe("2026-11-14");
    expect(runningMonthStichtag("2026-11", "2026-10-31")).toBe("2026-10-31");
  });

  it("is null for a whole month and for malformed input", () => {
    expect(runningMonthStichtag("2026-10", "2026-10-31")).toBeNull();
    expect(runningMonthStichtag("2026-13", "2026-11-14")).toBeNull();
    expect(runningMonthStichtag("2026-11", "x")).toBeNull();
    expect(runningMonthStichtag("", "")).toBeNull();
  });
});

// Issue #985 (D-01): the period report counts the running month through yesterday, like the account.
describe("runningMonthNote", () => {
  it("names the Stichtag when the answer's last month is still running", () => {
    expect(runningMonthNote("2026-11", "2026-11-14")).toBe(
      "Laufender Monat bis gestern (14.11.): Soll, Ist und Saldo zählen bis zu diesem Tag.",
    );
  });

  it("says nothing for a past month, which runs through its last day", () => {
    expect(runningMonthNote("2026-10", "2026-10-31")).toBeNull();
    expect(runningMonthNote("2026-02", "2026-02-28")).toBeNull();
  });

  it("on the 1st of the running month names the last day of the month before", () => {
    expect(runningMonthNote("2026-11", "2026-10-31")).toBe(
      "Laufender Monat bis gestern (31.10.): Soll, Ist und Saldo zählen bis zu diesem Tag.",
    );
  });

  it("returns null for malformed input", () => {
    expect(runningMonthNote("", "2026-11-14")).toBeNull();
    expect(runningMonthNote("2026-13", "2026-11-14")).toBeNull();
    expect(runningMonthNote("x", "2026-11-14")).toBeNull();
    expect(runningMonthNote("2026-11", "")).toBeNull();
    expect(runningMonthNote("2026-11", "x")).toBeNull();
  });
});
