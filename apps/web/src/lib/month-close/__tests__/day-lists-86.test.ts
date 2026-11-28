// Issue #86 (D-02) - the month-close page shows counts where the server withheld the day lists.
// Rows are shaped exactly as the API returns them (86b-02): redaction empties the arrays and sets
// dayDetailsWithheld, the count fields stay.
import { describe, expect, it } from "vitest";
import {
  DAY_DETAILS_WITHHELD_HINT,
  anyDayDetailsWithheld,
  breakFindingCountOf,
  breakFindingHintFor,
  daysWithoutEntryText,
  formatMissingDates,
  formatMissingShort,
  gapCountOf,
  karenzOverrunCountOf,
  karenzOverrunTitle,
  missingDaysText,
  type DayListRow,
} from "$lib/month-close/day-lists";

const visible: DayListRow = {
  dayDetailsWithheld: false,
  missingDates: ["2026-09-03", "2026-09-04"],
  missingDateCount: 2,
  breakFindingDays: ["2026-09-07"],
  breakFindingDayCount: 1,
  karenzOverrunDays: ["2026-09-08", "2026-09-09"],
  karenzOverrunDayCount: 2,
};
const withheld: DayListRow = {
  dayDetailsWithheld: true,
  missingDates: [],
  missingDateCount: 3,
  breakFindingDays: [],
  breakFindingDayCount: 2,
  karenzOverrunDays: [],
  karenzOverrunDayCount: 1,
};
const withheldZero: DayListRow = {
  dayDetailsWithheld: true,
  missingDates: [],
  missingDateCount: 0,
  breakFindingDays: [],
  breakFindingDayCount: 0,
};

describe("day lists of a visible row", () => {
  it("shows the dates, short form with a rest counter", () => {
    expect(missingDaysText(visible)).toBe("3.9., 4.9.");
    expect(
      missingDaysText(
        { missingDates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"] },
        { short: true },
      ),
    ).toBe("1.9., 2.9., 3.9. (+2)");
    // The deferred list names its days the German way, with the year and without leading zeros
    // (Issue #1149; it used to print the stored YYYY-MM-DD strings, visual baseline 09).
    expect(
      missingDaysText({ gapDates: ["2026-09-03", "2026-09-04"], gapCount: 2 }, { year: true }),
    ).toBe("3.9.2026, 4.9.2026");
    expect(
      missingDaysText({ gapDates: [], gapCount: 3, dayDetailsWithheld: true }, { year: true }),
    ).toBe("3 Tage ohne Eintrag");
    expect(formatMissingDates(["2026-09-03"])).toBe("3.9.");
    expect(formatMissingShort(["2026-09-03"])).toBe("3.9.");
  });

  it("names a day without a leading zero, the short list too (Issue #1155)", () => {
    expect(formatMissingDates(["2026-01-02", "2026-11-10"])).toBe("2.1., 10.11.");
    expect(formatMissingShort(["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"])).toBe(
      "2.1., 5.1., 6.1. (+1)",
    );
  });

  it("break finding and Karenz chips keep their dates", () => {
    expect(breakFindingHintFor(visible)?.label).toBe("Pausenverstoß offen (1)");
    expect(breakFindingHintFor(visible)?.title).toContain("07.09.");
    expect(karenzOverrunTitle(visible)).toContain("8.9., 9.9.");
  });
});

describe("day lists of a withheld row", () => {
  it("never reads an emptied array as 'no gaps'", () => {
    expect(gapCountOf(withheld)).toBe(3);
    expect(missingDaysText(withheld)).toBe("3 Tage ohne Eintrag");
    expect(missingDaysText({ ...withheld, missingDateCount: 1 })).toBe("1 Tag ohne Eintrag");
    expect(daysWithoutEntryText(1)).toBe("1 Tag ohne Eintrag");
  });

  it("the empty wording is for a count of 0 only", () => {
    expect(gapCountOf(withheldZero)).toBe(0);
    expect(missingDaysText(withheldZero)).toBe("");
    expect(breakFindingHintFor(withheldZero)).toBeNull();
  });

  it("break finding and Karenz come out as counts, without dates", () => {
    expect(breakFindingCountOf(withheld)).toBe(2);
    expect(breakFindingHintFor(withheld)?.label).toBe("Pausenverstoß offen (2)");
    expect(karenzOverrunCountOf(withheld)).toBe(1);
    expect(karenzOverrunTitle(withheld)).toMatch(/: 1$/);
  });

  it("the count field wins over the array length", () => {
    expect(gapCountOf({ dayDetailsWithheld: true, missingDates: [], missingDateCount: 5 })).toBe(5);
    // no count field and withheld: unknown, never derived from the emptied array
    expect(gapCountOf({ dayDetailsWithheld: true, missingDates: [] })).toBe(0);
  });
});

describe("year-status entries and deferred employees", () => {
  it("year-status missing[] entries: dates when visible, count when withheld", () => {
    expect(
      missingDaysText({
        missingDates: ["2026-01-05"],
        missingDateCount: 1,
        dayDetailsWithheld: false,
      }),
    ).toBe("5.1.");
    expect(
      missingDaysText(
        { missingDates: [], missingDateCount: 4, dayDetailsWithheld: true },
        { short: true },
      ),
    ).toBe("4 Tage ohne Eintrag");
  });

  it("deferred employees use gapDates / gapCount", () => {
    expect(gapCountOf({ gapDates: ["2026-01-05"], gapCount: 1, dayDetailsWithheld: false })).toBe(
      1,
    );
    expect(missingDaysText({ gapDates: [], gapCount: 2, dayDetailsWithheld: true })).toBe(
      "2 Tage ohne Eintrag",
    );
    expect(gapCountOf({ gapDates: [], gapCount: 0, dayDetailsWithheld: true })).toBe(0);
  });
});

describe("anyDayDetailsWithheld", () => {
  it("is true when any row was withheld, false otherwise and for empty input", () => {
    expect(anyDayDetailsWithheld([visible, withheld])).toBe(true);
    expect(anyDayDetailsWithheld([visible])).toBe(false);
    expect(anyDayDetailsWithheld([])).toBe(false);
    expect(anyDayDetailsWithheld([null, undefined])).toBe(false);
  });

  it("the neutral hint names the reach and says the count stays", () => {
    expect(DAY_DETAILS_WITHHELD_HINT).toBe(
      "Die Tage siehst du nur mit Leserecht auf die Zeiteinträge, die Anzahl bleibt.",
    );
  });
});
