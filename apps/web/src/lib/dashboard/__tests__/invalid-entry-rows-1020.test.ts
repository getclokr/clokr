import { describe, it, expect } from "vitest";
import { invalidEntryRows } from "../invalid-entry-rows";
import { endEntryHref } from "$lib/time-entries/open-earlier-entry";

const dayShort = (iso: string) => "D" + iso;

describe("invalidEntryRows (Issue #1020)", () => {
  it("is empty without an answer or with no invalid entry", () => {
    expect(invalidEntryRows(null, dayShort)).toEqual([]);
    expect(invalidEntryRows(undefined, dayShort)).toEqual([]);
    expect(invalidEntryRows({ invalidEntries: 0, invalidEntryDays: [] }, dayShort)).toEqual([]);
  });

  it("keeps today's single count row for an older answer without the day list", () => {
    expect(invalidEntryRows({ invalidEntries: 2 }, dayShort)).toEqual([
      {
        key: "invalid",
        title: "2 Einträge zu korrigieren",
        subtitle: "Bitte prüfen und korrigieren.",
        chip: "Prüfen",
        tone: "warn",
        href: "/ich/zeiten",
        action: "Öffnen",
      },
    ]);
    expect(invalidEntryRows({ invalidEntries: 1 }, dayShort)[0].title).toBe(
      "1 Eintrag zu korrigieren",
    );
  });

  it("names a day with an open entry and links into the Ende-eintragen flow", () => {
    const rows = invalidEntryRows(
      {
        invalidEntries: 1,
        invalidEntryDays: [{ date: "2026-09-30", entryId: "e1", open: true }],
      },
      dayShort,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("invalid-2026-09-30");
    expect(rows[0].title).toBe("D2026-09-30 Ausstempeln fehlt");
    expect(rows[0].href).toBe(endEntryHref({ id: "e1", day: "2026-09-30" }));
    expect(rows[0].action).toBe("Ende eintragen");
  });

  it("names a closed invalid day and links to the day list", () => {
    const rows = invalidEntryRows(
      {
        invalidEntries: 1,
        invalidEntryDays: [{ date: "2026-09-29", entryId: "e2", open: false }],
      },
      dayShort,
    );
    expect(rows[0].title).toBe("D2026-09-29 Eintrag prüfen");
    expect(rows[0].href).toBe("/ich/zeiten?view=list&date=2026-09-29");
    expect(rows[0].action).toBe("Öffnen");
  });

  it("gives ONE row for a day with two entries and words it as open when one is", () => {
    const rows = invalidEntryRows(
      {
        invalidEntries: 2,
        invalidEntryDays: [
          { date: "2026-09-30", entryId: "closed", open: false },
          { date: "2026-09-30", entryId: "open", open: true },
        ],
      },
      dayShort,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("D2026-09-30 Ausstempeln fehlt");
    expect(rows[0].href).toBe(endEntryHref({ id: "open", day: "2026-09-30" }));
  });

  // Issue #1028 (P-07) changes the two cap cases below on purpose: Mein Tag's list widget pages every
  // day, so the cap of five days and its summary row „N weitere Tage zu prüfen“ are gone. The cases are
  // not loosened - they now prove that NO day is lost: every day is a row, newest first.
  it("names EVERY day as a row, newest first, with no summary row", () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      date: `2026-09-0${d}`,
      entryId: `e${d}`,
      open: false,
    }));
    const rows = invalidEntryRows({ invalidEntries: 7, invalidEntryDays: days }, dayShort);
    expect(rows.map((r) => r.key)).toEqual([
      "invalid-2026-09-07",
      "invalid-2026-09-06",
      "invalid-2026-09-05",
      "invalid-2026-09-04",
      "invalid-2026-09-03",
      "invalid-2026-09-02",
      "invalid-2026-09-01",
    ]);
    expect(rows.some((r) => /weitere/.test(r.title))).toBe(false);
    expect(rows.some((r) => r.testId === "dashboard-invalid-more")).toBe(false);
  });

  it("a day beyond the former cap is still a row with its own link", () => {
    const days = [1, 2, 3, 4, 5, 6].map((d) => ({
      date: `2026-09-0${d}`,
      entryId: `e${d}`,
      open: false,
    }));
    const rows = invalidEntryRows({ invalidEntries: 6, invalidEntryDays: days }, dayShort);
    expect(rows).toHaveLength(6);
    expect(rows[5].href).toBe("/ich/zeiten?view=list&date=2026-09-01");
  });
});
