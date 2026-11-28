/**
 * Issue #1117 — the one German day label of API notification texts: day and month without a
 * leading zero, the year once, a range with an en dash and no spaces (glossary row "Datum (Ich
 * und Team)"). Pure unit proof; the real notification texts are proven in their own suites.
 */
import { describe, it, expect } from "vitest";
import { dayLabelDe, dayRangeLabelDe } from "../day-label-de";

const ISO_DAY = /\d{4}-\d{2}-\d{2}/;

describe("dayLabelDe (Issue #1117)", () => {
  it("prints day and month without a leading zero and the year", () => {
    expect(dayLabelDe("2026-12-01")).toBe("1.12.2026");
    expect(dayLabelDe("2026-10-15")).toBe("15.10.2026");
    expect(dayLabelDe("2027-03-05")).toBe("5.3.2027");
  });

  it("reads a @db.Date value (UTC midnight) by its UTC calendar day", () => {
    expect(dayLabelDe(new Date("2026-12-01T00:00:00.000Z"))).toBe("1.12.2026");
    expect(dayLabelDe(new Date("2026-01-01T00:00:00.000Z"))).toBe("1.1.2026");
  });

  it("returns a string that is not exactly YYYY-MM-DD unchanged and never throws", () => {
    expect(dayLabelDe("abc")).toBe("abc");
    expect(dayLabelDe("2026-12-01T10:00:00Z")).toBe("2026-12-01T10:00:00Z");
    expect(dayLabelDe("")).toBe("");
  });

  it("returns an invalid Date as a string instead of throwing", () => {
    expect(() => dayLabelDe(new Date("nope"))).not.toThrow();
  });

  it("never emits an ISO day", () => {
    expect(dayLabelDe("2026-12-01")).not.toMatch(ISO_DAY);
    expect(dayLabelDe(new Date("2026-12-01T00:00:00.000Z"))).not.toMatch(ISO_DAY);
  });
});

describe("dayRangeLabelDe (Issue #1117)", () => {
  it("prints the year once when both ends share it", () => {
    expect(dayRangeLabelDe("2026-12-01", "2026-12-02")).toBe("1.12.–2.12.2026");
    expect(dayRangeLabelDe("2027-03-01", "2027-03-05")).toBe("1.3.–5.3.2027");
  });

  it("names one date for a one-day range", () => {
    expect(dayRangeLabelDe("2026-12-01", "2026-12-01")).toBe("1.12.2026");
  });

  it("names both years across New Year", () => {
    expect(dayRangeLabelDe("2026-12-29", "2027-01-02")).toBe("29.12.2026–2.1.2027");
  });

  it("gives the same strings for Date inputs", () => {
    const a = new Date("2026-12-01T00:00:00.000Z");
    const b = new Date("2026-12-02T00:00:00.000Z");
    expect(dayRangeLabelDe(a, b)).toBe("1.12.–2.12.2026");
    expect(dayRangeLabelDe(a, a)).toBe("1.12.2026");
    expect(
      dayRangeLabelDe(new Date("2026-12-29T00:00:00.000Z"), new Date("2027-01-02T00:00:00.000Z")),
    ).toBe("29.12.2026–2.1.2027");
  });

  it("falls back to both inputs for a non-day string and never throws", () => {
    expect(() => dayRangeLabelDe("abc", "2026-12-01")).not.toThrow();
    expect(dayRangeLabelDe("abc", "def")).toBe("abc–def");
  });

  it("never emits an ISO day", () => {
    expect(dayRangeLabelDe("2026-12-01", "2026-12-02")).not.toMatch(ISO_DAY);
    expect(dayRangeLabelDe("2026-12-29", "2027-01-02")).not.toMatch(ISO_DAY);
  });
});
