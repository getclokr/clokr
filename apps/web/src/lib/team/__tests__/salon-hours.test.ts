// Issue #1030 - the pure web module of the Salonansicht hours raster: period state, request path,
// labels and the cell wording. No `$app` import, no request.
import { describe, expect, it } from "vitest";
import {
  cellDisplay,
  chipSalonName,
  combinedDayTotals,
  countedThroughLabel,
  dayColumnLabel,
  dayFullLabel,
  defaultSalonPeriod,
  elsewhereChipText,
  openItemSubtitle,
  periodAfterSalonChange,
  rowHasContent,
  salonHoursCsvPath,
  salonHoursRequestPath,
  salonPeriodEnd,
  salonPeriodLabel,
  salonPeriodNextDisabled,
  salonPeriodStart,
  salonPeriodWithZoom,
  shiftSalonPeriod,
  teamModeFor,
  type SalonHoursCell,
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
    expect(countedThroughLabel("2026-11-24")).toBe("bis Di 24.11.2026");
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

function cell(over: Partial<SalonHoursCell> = {}): SalonHoursCell {
  return {
    date: "2026-11-23",
    minutes: 0,
    counted: true,
    elsewhere: [],
    elsewhereHidden: false,
    absent: false,
    open: false,
    ...over,
  };
}

describe("cellDisplay", () => {
  it("shows H:MM for worked minutes", () => {
    const d = cellDisplay(cell({ minutes: 450 }), "Pat Test");
    expect(d.text).toBe("7:30");
    expect(d.chips).toEqual([]);
    expect(d.label).toBe("Pat Test, Montag, 23.11.2026: 7:30 im Salon");
  });

  it("shows the muted dash (nil) on a day with nothing, counted or not counted yet", () => {
    for (const d of [
      cellDisplay(cell()),
      cellDisplay(cell({ date: "2026-11-30", counted: false })),
    ]) {
      expect(d.nil).toBe(true);
      expect(d.text).toBe("");
      expect(d.chips).toEqual([]);
    }
    expect(cellDisplay(cell({ minutes: 450 })).nil).toBe(false);
  });

  it("names the other salon of a day as „in <Salon>“", () => {
    const d = cellDisplay(
      cell({ minutes: 240, elsewhere: [{ salonId: "s2", salonName: "Süd" }] }),
      "Pat Test",
    );
    expect(d.chips).toEqual([{ text: "in Süd", tone: "neutral" }]);
    expect(d.label).toBe("Pat Test, Montag, 23.11.2026: 4:00 im Salon, in Süd");
  });

  it("drops the word „Salon“ in the chip (draft: „in Süd“) and keeps it in the accessible name", () => {
    expect(chipSalonName("Salon Nord")).toBe("Nord");
    expect(chipSalonName("Salon")).toBe("Salon");
    expect(chipSalonName("Haarkonzept Mitte")).toBe("Haarkonzept Mitte");
    const d = cellDisplay(cell({ elsewhere: [{ salonId: "s2", salonName: "Salon Nord" }] }));
    expect(d.chips).toEqual([{ text: "in Nord", tone: "neutral" }]);
    expect(d.label).toBe("Montag, 23.11.2026: keine Stunden im Salon, in Salon Nord");
  });

  it("spells out at most two salon names, then „+N“", () => {
    expect(elsewhereChipText(["Süd"])).toBe("in Süd");
    expect(elsewhereChipText(["Süd", "Ost"])).toBe("in Süd, Ost");
    expect(elsewhereChipText(["Süd", "Ost", "West", "Nord"])).toBe("in Süd, Ost +2");
  });

  it("reads hidden time as „anderer Salon“: no hours, no name", () => {
    const d = cellDisplay(cell({ elsewhereHidden: true }), "Pat Test");
    expect(d.text).toBe("");
    expect(d.nil).toBe(false);
    expect(d.chips).toEqual([{ text: "anderer Salon", tone: "neutral" }]);
    expect(d.label).toBe("Pat Test, Montag, 23.11.2026: keine Stunden im Salon, anderer Salon");
  });

  it("reads leave or an absence as „abwesend“ without any kind, also on a day not counted yet", () => {
    const d = cellDisplay(cell({ date: "2026-11-30", counted: false, absent: true }));
    expect(d.text).toBe("");
    expect(d.chips).toEqual([{ text: "abwesend", tone: "info" }]);
    expect(JSON.stringify(d)).not.toMatch(/Urlaub|Krank|Berufsschule|VACATION|SICK/);
  });

  it("shows exactly ONE chip without hours (the most important), all of them in the label", () => {
    const d = cellDisplay(
      cell({
        absent: true,
        elsewhere: [{ salonId: "s2", salonName: "Süd" }],
        elsewhereHidden: true,
      }),
    );
    expect(d.chips.map((c) => c.text)).toEqual(["abwesend"]);
    expect(d.label).toBe(
      "Montag, 23.11.2026: keine Stunden im Salon, abwesend, in Süd, anderer Salon",
    );
  });

  it("shows every state beneath the hours when the day has hours, in a fixed order", () => {
    const d = cellDisplay(
      cell({
        minutes: 60,
        absent: true,
        elsewhere: [{ salonId: "s2", salonName: "Süd" }],
        elsewhereHidden: true,
      }),
    );
    expect(d.text).toBe("1:00");
    expect(d.chips.map((c) => c.text)).toEqual(["abwesend", "in Süd", "anderer Salon"]);
    expect(d.nil).toBe(false);
  });
});

describe("cellDisplay - open (Issue #1030, P-08)", () => {
  it("marks a missing clock-out with the chip „offen“ (warn) and no hours", () => {
    const d = cellDisplay(cell({ open: true }), "Pat Test");
    expect(d.text).toBe("");
    expect(d.chips).toEqual([{ text: "offen", tone: "warn" }]);
    expect(d.label).toBe("Pat Test, Montag, 23.11.2026: keine Stunden im Salon, offen");
  });

  it("puts „offen“ before the other states", () => {
    const d = cellDisplay(cell({ open: true, absent: true, minutes: 60 }));
    expect(d.chips.map((c) => c.text)).toEqual(["offen", "abwesend"]);
    expect(d.text).toBe("1:00");
  });
});

describe("rowHasContent and combinedDayTotals (card layout, one Summe row)", () => {
  it("is true only when a day has hours or a state", () => {
    expect(rowHasContent([cell(), cell({ date: "2026-11-24", counted: false })])).toBe(false);
    expect(rowHasContent([cell(), cell({ minutes: 30 })])).toBe(true);
    expect(rowHasContent([cell({ absent: true })])).toBe(true);
    expect(rowHasContent([cell({ elsewhereHidden: true })])).toBe(true);
    expect(rowHasContent([])).toBe(false);
  });

  it("adds the two server day totals of the groups, day by day", () => {
    expect(
      combinedDayTotals({
        stammteam: { dayTotals: [60, 0, 5] },
        aushilfen: { dayTotals: [30, 10, 0] },
      }),
    ).toEqual([90, 10, 5]);
  });
});

describe("salonHoursCsvPath and openItemSubtitle", () => {
  it("builds the CSV request of the very period the raster shows", () => {
    expect(salonHoursCsvPath("s 1", WEEK("2026-11-23"))).toBe(
      "/salon-hours/csv?salonId=s%201&period=week&date=2026-11-23",
    );
    expect(salonHoursCsvPath("s1", MONTH("2026-11-01"))).toBe(
      "/salon-hours/csv?salonId=s1&period=month&date=2026-11-01",
    );
  });

  it("words an open item as weekday, day and start time", () => {
    expect(
      openItemSubtitle({
        employeeId: "e1",
        employeeName: "Pat Test",
        date: "2026-11-23",
        startTime: "09:00",
      }),
    ).toBe("Mo 23.11. · seit 09:00");
  });
});

describe("periodAfterSalonChange", () => {
  const shown = MONTH("2026-09-01");

  it("returns to the default week when the salon changes", () => {
    expect(periodAfterSalonChange("s1", "s2", shown, "2026-11-24")).toEqual(
      defaultSalonPeriod("2026-11-24"),
    );
    expect(periodAfterSalonChange(null, "s2", shown, "2026-11-24")).toEqual(
      defaultSalonPeriod("2026-11-24"),
    );
    expect(periodAfterSalonChange("s1", null, shown, "2026-11-24")).toEqual(
      defaultSalonPeriod("2026-11-24"),
    );
  });

  it("keeps the shown period when the salon stays", () => {
    expect(periodAfterSalonChange("s1", "s1", shown, "2026-11-24")).toBe(shown);
    expect(periodAfterSalonChange(null, null, shown, "2026-11-24")).toBe(shown);
  });
});
