import { describe, it, expect } from "vitest";
import { missingDaysOfMonth, pastWeeksOfMonth, serverMissingDatesOf } from "../heute-im-salon";

describe("pastWeeksOfMonth (Issue #987)", () => {
  it("names the Mondays of the earlier weeks of the month, never the current week", () => {
    // Monday 16 Nov 2026: weeks of 26 Oct (holds 1 Nov), 2 Nov and 9 Nov
    expect(pastWeeksOfMonth("2026-11-16")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
  });
  it("is empty on the first day of a month", () => {
    expect(pastWeeksOfMonth("2026-12-01")).toEqual([]);
  });
  it("on a Wednesday the current week is skipped, the earlier ones stay", () => {
    expect(pastWeeksOfMonth("2026-11-11")).toEqual(["2026-10-26", "2026-11-02"]);
  });
});

describe("missingDaysOfMonth (Issue #987)", () => {
  const week = (days: Array<[string, string]>) => ({
    team: [
      {
        id: "p1",
        name: "Tina Brandt",
        days: days.map(([date, status]) => ({ date, status })),
      },
      { id: "p2", name: "Vera Kühn", days: [{ date: "2026-11-05", status: "present" }] },
    ],
  });

  it("collects only server-missing past days of the month, once per day", () => {
    const rows = missingDaysOfMonth(
      [
        week([
          ["2026-10-30", "missing"], // previous month
          ["2026-11-06", "missing"],
          ["2026-11-07", "none"],
        ]),
        week([
          ["2026-11-06", "missing"], // the same day in a second answer
          ["2026-11-13", "missing"],
          ["2026-11-16", "missing"], // today is not past
        ]),
      ],
      "2026-11-16",
    );
    expect(rows).toEqual([{ id: "p1", name: "Tina Brandt", days: ["2026-11-06", "2026-11-13"] }]);
  });

  it("is empty when nothing is missing", () => {
    expect(missingDaysOfMonth([week([["2026-11-06", "present"]])], "2026-11-16")).toEqual([]);
  });
});

describe("serverMissingDatesOf (Issue #987)", () => {
  const w = (status: string) => ({
    team: [{ id: "p1", name: "T", days: [{ date: "2026-11-06", status }] }],
  });
  it("collects the missing days of one person", () => {
    expect([...(serverMissingDatesOf([w("missing")], "p1") ?? [])]).toEqual(["2026-11-06"]);
  });
  it("is null when the server made no statement about the person", () => {
    expect(serverMissingDatesOf([w("missing")], "other")).toBeNull();
  });
});

describe("Mein Tag links (Issue #987)", () => {
  it("„Dein Antrag wartet“ opens the Anträge tab, not the calendar view", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../../routes/(app)/dashboard/+page.svelte"),
      "utf8",
    );
    expect(src).toContain('href: "/ich/abwesenheiten?tab=antraege"');
    expect(src).not.toContain("view=requests");
  });
});

describe("#987 — „Für dich“ names at most five missing days", () => {
  it("keeps the five newest days in order and counts the rest", async () => {
    const { capMissingDays, FOR_YOU_MISSING_DAYS_SHOWN } = await import("../heute-im-salon");
    expect(FOR_YOU_MISSING_DAYS_SHOWN).toBe(5);
    const days = [
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
    ];
    expect(capMissingDays(days)).toEqual({
      shown: ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"],
      more: 2,
    });
  });

  it("shows every day and no summary when there are five or fewer, duplicates counted once", async () => {
    const { capMissingDays } = await import("../heute-im-salon");
    expect(capMissingDays(["2026-11-06", "2026-11-03", "2026-11-06"])).toEqual({
      shown: ["2026-11-03", "2026-11-06"],
      more: 0,
    });
  });
});
