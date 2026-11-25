// Issue #1030 - the pure web module of the Salonansicht hours raster: period state, request path,
// labels and the cell wording. No `$app` import, no request.
import { describe, expect, it } from "vitest";
import {
  cellDisplay,
  countedThroughLabel,
  dayColumnLabel,
  dayFullLabel,
  defaultSalonPeriod,
  salonHoursRequestPath,
  salonPeriodEnd,
  salonPeriodLabel,
  salonPeriodNextDisabled,
  salonPeriodStart,
  salonPeriodWithZoom,
  shiftSalonPeriod,
  teamModeFor,
  type SalonPeriod,
} from "../salon-hours";

const WEEK = (anchor: string): SalonPeriod => ({ zoom: "woche", anchor });
const MONTH = (anchor: string): SalonPeriod => ({ zoom: "monat", anchor });

describe("defaultSalonPeriod", () => {
  it("is the week of tenant-local yesterday, anchored on its Monday", () => {
    expect(defaultSalonPeriod("2026-11-24")).toEqual(WEEK("2026-11-23"));
    expect(defaultSalonPeriod("2026-11-26")).toEqual(WEEK("2026-11-23"));
  });

  it("never opens an empty week on a Monday: yesterday is the Sunday before", () => {
    expect(defaultSalonPeriod("2026-11-23")).toEqual(WEEK("2026-11-16"));
  });

  it("crosses a year boundary by calendar days, not by host time", () => {
    expect(defaultSalonPeriod("2027-01-01")).toEqual(WEEK("2026-12-28"));
  });
});

describe("shiftSalonPeriod", () => {
  it("moves a week by seven days", () => {
    expect(shiftSalonPeriod(WEEK("2026-11-23"), -1)).toEqual(WEEK("2026-11-16"));
    expect(shiftSalonPeriod(WEEK("2026-11-23"), 1)).toEqual(WEEK("2026-11-30"));
  });

  it("moves a month to the first day of the neighbouring month", () => {
    expect(shiftSalonPeriod(MONTH("2026-11-01"), -1)).toEqual(MONTH("2026-10-01"));
    expect(shiftSalonPeriod(MONTH("2026-12-01"), 1)).toEqual(MONTH("2027-01-01"));
    expect(shiftSalonPeriod(MONTH("2026-01-01"), -1)).toEqual(MONTH("2025-12-01"));
  });
});

describe("period bounds and the next arrow", () => {
  it("names the first and last day", () => {
    expect(salonPeriodStart(WEEK("2026-11-23"))).toBe("2026-11-23");
    expect(salonPeriodEnd(WEEK("2026-11-23"))).toBe("2026-11-29");
    expect(salonPeriodEnd(MONTH("2026-02-01"))).toBe("2026-02-28");
    expect(salonPeriodEnd(MONTH("2028-02-01"))).toBe("2028-02-29");
  });

  it("disables next when the following period starts after today", () => {
    // today Tue 24.11.: the week of 23.11. is the running one, the next starts 30.11.
    expect(salonPeriodNextDisabled(WEEK("2026-11-23"), "2026-11-24")).toBe(true);
    expect(salonPeriodNextDisabled(WEEK("2026-11-16"), "2026-11-24")).toBe(false);
    expect(salonPeriodNextDisabled(MONTH("2026-11-01"), "2026-11-24")).toBe(true);
    expect(salonPeriodNextDisabled(MONTH("2026-10-01"), "2026-11-24")).toBe(false);
    // a period that starts exactly today is still reachable
    expect(salonPeriodNextDisabled(WEEK("2026-11-16"), "2026-11-23")).toBe(false);
  });
});

describe("salonPeriodWithZoom", () => {
  it("keeps the period when the zoom does not change", () => {
    const p = WEEK("2026-11-23");
    expect(salonPeriodWithZoom(p, "woche", "2026-11-24")).toBe(p);
  });

  it("turns a week into the month it starts in and a month into its first week", () => {
    expect(salonPeriodWithZoom(WEEK("2026-11-23"), "monat", "2026-11-24")).toEqual(
      MONTH("2026-11-01"),
    );
    expect(salonPeriodWithZoom(MONTH("2026-10-01"), "woche", "2026-11-24")).toEqual(
      WEEK("2026-09-28"),
    );
  });

  it("falls back to the default week rather than a week in the future", () => {
    expect(salonPeriodWithZoom(MONTH("2026-12-01"), "woche", "2026-11-24")).toEqual(
      defaultSalonPeriod("2026-11-24"),
    );
  });
});

describe("labels", () => {
  it("words a week with its ISO week number and range", () => {
    expect(salonPeriodLabel(WEEK("2026-11-23"))).toBe("KW 48 · 23.–29.11.2026");
    expect(salonPeriodLabel(WEEK("2026-11-30"))).toBe("KW 49 · 30.11.–6.12.2026");
    expect(salonPeriodLabel(WEEK("2026-12-28"))).toBe("KW 53 · 28.12.2026–3.1.2027");
  });

  it("words a month", () => {
    expect(salonPeriodLabel(MONTH("2026-11-01"))).toBe("November 2026");
    expect(salonPeriodLabel(MONTH("2027-03-01"))).toBe("März 2027");
  });

  it("names the Stichtag of the counted hours", () => {
    expect(countedThroughLabel("2026-11-24")).toBe("bis Di, 24.11.2026");
    expect(countedThroughLabel(null)).toBe("noch nichts gezählt");
  });

  it("heads a day column with weekday and day", () => {
    expect(dayColumnLabel("2026-11-23")).toBe("Mo 23.");
    expect(dayColumnLabel("2026-11-29")).toBe("So 29.");
    expect(dayFullLabel("2026-11-23")).toBe("Montag, 23.11.2026");
  });
});

describe("salonHoursRequestPath", () => {
  it("builds the request of a week and of a month", () => {
    expect(salonHoursRequestPath("s-1", WEEK("2026-11-23"))).toBe(
      "/salon-hours?salonId=s-1&period=week&date=2026-11-23",
    );
    expect(salonHoursRequestPath("s-1", MONTH("2026-11-01"))).toBe(
      "/salon-hours?salonId=s-1&period=month&date=2026-11-01",
    );
  });

  it("encodes the salon id", () => {
    expect(salonHoursRequestPath("a b", WEEK("2026-11-23"))).toContain("salonId=a%20b");
  });
});

describe("teamModeFor", () => {
  it("opens the Salonansicht only when its tab exists", () => {
    expect(teamModeFor("salon", true)).toBe("salon");
    expect(teamModeFor("salon", false)).toBe("person");
    expect(teamModeFor("person", true)).toBe("person");
    expect(teamModeFor("person", false)).toBe("person");
  });
});

describe("cellDisplay", () => {
  it("shows H:MM for worked minutes", () => {
    const d = cellDisplay({ date: "2026-11-23", minutes: 450, counted: true }, "Pat Test");
    expect(d.text).toBe("7:30");
    expect(d.chips).toEqual([]);
    expect(d.label).toBe("Pat Test, Montag, 23.11.2026: 7:30 im Salon");
  });

  it("shows a dash on a counted day without hours and nothing on a day not counted yet", () => {
    expect(cellDisplay({ date: "2026-11-23", minutes: 0, counted: true }).text).toBe("–");
    expect(cellDisplay({ date: "2026-11-30", minutes: 0, counted: false }).text).toBe("");
  });
});
