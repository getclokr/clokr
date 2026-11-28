// Issue #992 (D-992-16) — the one date wording of the Ich and Team areas: no leading zeros.
import { describe, it, expect } from "vitest";
import { dateTimeLabel, dayLabel, dayRangeLabel, instantDayLabel } from "../day-label";

describe("dayLabel (Issue #992)", () => {
  it("prints day and month without leading zeros", () => {
    expect(dayLabel("2026-12-01")).toBe("1.12.");
    expect(dayLabel("2026-11-26")).toBe("26.11.");
  });

  it("adds the year on request", () => {
    expect(dayLabel("2026-12-01", { year: true })).toBe("1.12.2026");
  });

  it("adds the weekday of the calendar day, not of a local midnight", () => {
    expect(dayLabel("2026-12-01", { weekday: true, year: true })).toBe("Di 1.12.2026");
    expect(dayLabel("2026-11-26", { weekday: true, year: true })).toBe("Do 26.11.2026");
    expect(dayLabel("2026-11-29", { weekday: true })).toBe("So 29.11.");
    expect(dayLabel("2026-11-30", { weekday: true })).toBe("Mo 30.11.");
  });

  it("takes the date part of a full ISO timestamp", () => {
    expect(dayLabel("2026-12-01T00:00:00.000Z", { year: true })).toBe("1.12.2026");
  });

  it("hands an unparsable string back unchanged", () => {
    expect(dayLabel("morgen")).toBe("morgen");
    expect(dayLabel("")).toBe("");
  });
});

describe("dayRangeLabel (Issue #992)", () => {
  it("prints a range with an en dash and the year once", () => {
    expect(dayRangeLabel("2026-12-01", "2026-12-02")).toBe("1.12.–2.12.");
    expect(dayRangeLabel("2026-12-01", "2026-12-02", { year: true })).toBe("1.12.–2.12.2026");
  });

  it("keeps both years when the range crosses a year", () => {
    expect(dayRangeLabel("2026-12-28", "2027-01-02", { year: true })).toBe("28.12.2026–2.1.2027");
    expect(dayRangeLabel("2026-12-28", "2027-01-02")).toBe("28.12.–2.1.");
  });

  it("prints one day as one date", () => {
    expect(dayRangeLabel("2026-12-01", "2026-12-01")).toBe("1.12.");
    expect(dayRangeLabel("2026-12-01", "2026-12-01", { year: true })).toBe("1.12.2026");
  });

  it("hands an unparsable range back unchanged", () => {
    expect(dayRangeLabel("a", "b")).toBe("a–b");
  });
});

describe("instantDayLabel and dateTimeLabel (Issue #1168)", () => {
  // Local-time constructors on purpose: both helpers read the instant in the zone of the browser.
  const instant = new Date(2026, 8, 7, 8, 5, 9);

  it("names the browser-zone day of an instant without leading zeros", () => {
    expect(instantDayLabel(instant)).toBe("7.9.");
    expect(instantDayLabel(instant, { year: true })).toBe("7.9.2026");
  });

  it("appends the time of day as HH:MM, with seconds on request", () => {
    expect(dateTimeLabel(instant)).toBe("7.9.2026, 08:05");
    expect(dateTimeLabel(instant, { seconds: true })).toBe("7.9.2026, 08:05:09");
  });

  it("returns an empty string for an invalid date", () => {
    expect(instantDayLabel(new Date("nope"))).toBe("");
    expect(dateTimeLabel(new Date("nope"))).toBe("");
  });
});
