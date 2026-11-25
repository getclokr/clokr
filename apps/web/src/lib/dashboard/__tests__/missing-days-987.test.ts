import { describe, it, expect } from "vitest";
import { missingDaysOfMonth, pastWeeksOfMonth, serverMissingDatesOf } from "../heute-im-salon";
import { forYouItems } from "../for-you";
import { pageSlice } from "$lib/lists/list-page";

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
    // Issue #1028: the „Für dich“ rows are derived in for-you.ts now (the page only renders them).
    const src = readFileSync(resolve(__dirname, "../for-you.ts"), "utf8");
    expect(src).toContain('href: "/ich/abwesenheiten?tab=antraege"');
    expect(src).not.toContain("view=requests");
    const page = readFileSync(
      resolve(__dirname, "../../../routes/(app)/dashboard/+page.svelte"),
      "utf8",
    );
    expect(page).not.toContain("view=requests");
  });
});

// Issue #1028 (P-07, AC12) ADAPTED, NOT LOOSENED. #987 capped „Für dich“ at the five newest missing days
// and summed the rest into one row „N weitere Tage ohne Zeiteintrag“. Mein Tag's list widget now pages
// EVERY day, so the cap and its summary row are gone and this block proves the stronger claim: no day
// is lost (every day is a row, exactly once over the pages) and the first page at the default size is
// still exactly the five newest days #987 showed.
describe("#987 / #1028 — „Für dich“ lists every missing day, page 1 is the five newest", () => {
  const dayShort = (iso: string) => `D${iso}`;
  const karenz = { count: 0, earliestDay: null, targetRequestId: null, label: "" };
  // 12 missing days, deliberately unsorted and with a duplicate across the two lists of the answer
  const DAYS = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-16",
    "2026-11-17",
  ];
  const items = () =>
    forYouItems({
      breakDays: [],
      openItems: {
        missingDays: [DAYS[11], DAYS[10], DAYS[3]],
        missingDaysInMonth: [...DAYS].reverse(),
        pendingRequests: 0,
        invalidEntries: 0,
      },
      karenz,
      dayShort,
    });

  it("has one row per missing day and no summary row", () => {
    const rows = items();
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => /weitere/.test(r.title))).toBe(false);
    expect(rows.some((r) => r.testId === "dashboard-missing-more")).toBe(false);
    expect(new Set(rows.map((r) => r.key)).size).toBe(12);
  });

  it("page 1 at the default size is exactly the five newest days #987 showed", () => {
    const first = pageSlice(items(), 1, 5).map((r) => r.key.replace("miss-", ""));
    // #987 showed the five newest in chronological order; the widget lists newest first, same five days.
    expect([...first].sort()).toEqual(DAYS.slice(-5));
    expect(first).toEqual([...DAYS.slice(-5)].reverse());
  });

  it("the pages together contain every day exactly once", () => {
    const rows = items();
    const seen = [1, 2, 3].flatMap((p) => pageSlice(rows, p, 5)).map((r) => r.key);
    expect(seen).toHaveLength(12);
    expect(new Set(seen)).toEqual(new Set(DAYS.map((d) => `miss-${d}`)));
    expect(pageSlice(rows, 4, 5)).toEqual([]);
  });

  it("every day keeps its own link into the day's list", () => {
    for (const row of items()) {
      expect(row.href).toBe(`/ich/zeiten?view=list&date=${row.key.replace("miss-", "")}`);
    }
  });
});
