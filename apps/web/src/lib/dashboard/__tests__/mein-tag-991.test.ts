// Issue #991 (M-02, N-04, N-05) — Mein Tag: „Frei“ instead of a zero hero on a day off, week tiles
// that lead somewhere, a history that names the day. The page itself needs ~20 GETs to mount, so
// the wiring is pinned by source reads (same remedy as the other dashboard source tests).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { freeIdleDay, historyWhenLabel, weekStripPhoneText, weekTileHref } from "../mein-tag";

describe("freeIdleDay (D-991-01)", () => {
  it("is true only for an idle day without a shift and without a Soll", () => {
    expect(freeIdleDay({ state: "ruhig", shiftText: null, goalMin: null })).toBe(true);
  });
  it("is false while working, on a break and when finished", () => {
    for (const state of ["arbeitet", "pause", "fertig"] as const) {
      expect(freeIdleDay({ state, shiftText: null, goalMin: null }), state).toBe(false);
    }
  });
  it("is false with a shift or a Soll", () => {
    expect(freeIdleDay({ state: "ruhig", shiftText: "09:00–17:30", goalMin: null })).toBe(false);
    expect(freeIdleDay({ state: "ruhig", shiftText: null, goalMin: 480 })).toBe(false);
  });
});

describe("weekTileHref (D-991-02)", () => {
  it("opens Zeiten for today and for a past day", () => {
    expect(weekTileHref("2026-11-25", "2026-11-25")).toBe("/ich/zeiten?date=2026-11-25");
    expect(weekTileHref("2026-11-23", "2026-11-25")).toBe("/ich/zeiten?date=2026-11-23");
  });
  it("opens the Dienstplan for a future day", () => {
    expect(weekTileHref("2026-11-26", "2026-11-25")).toBe("/ich/dienstplan");
  });
  it("compares ISO days across a month and year boundary", () => {
    expect(weekTileHref("2027-01-01", "2026-12-31")).toBe("/ich/dienstplan");
    expect(weekTileHref("2026-12-31", "2027-01-01")).toBe("/ich/zeiten?date=2026-12-31");
  });
});

describe("weekStripPhoneText (D-991-02)", () => {
  it("lets a time range break after the dash", () => {
    expect(weekStripPhoneText("09:00–17:30")).toBe("09:00–​17:30");
  });
  it("leaves a text without a dash unchanged", () => {
    expect(weekStripPhoneText("Frei")).toBe("Frei");
    expect(weekStripPhoneText("8:00 h")).toBe("8:00 h");
  });
});

describe("historyWhenLabel (D-991-03)", () => {
  const today = "2026-11-25";
  it("shows HH:mm for an instant on the tenant's today", () => {
    expect(historyWhenLabel("2026-11-25T08:15:00.000Z", today, "Europe/Berlin")).toBe("09:15");
  });
  it("shows weekday and date for another day", () => {
    expect(historyWhenLabel("2026-11-23T08:15:00.000Z", today, "Europe/Berlin")).toBe("Mo 23.11.");
  });
  it("files an instant just after Berlin midnight under the Berlin day, not the UTC day", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in Berlin = today.
    expect(historyWhenLabel("2026-11-24T23:30:00.000Z", today, "Europe/Berlin")).toBe("00:30");
    // 23:30 UTC on the 22nd is 00:30 on the 23rd in Berlin: not today, named „Mo 23.11.“.
    expect(historyWhenLabel("2026-11-22T23:30:00.000Z", today, "Europe/Berlin")).toBe("Mo 23.11.");
  });
});

describe("Mein Tag page wiring (source pins)", () => {
  const page = readFileSync(
    resolve(__dirname, "../../../routes/(app)/dashboard/+page.svelte"),
    "utf8",
  );
  const css = page.slice(page.indexOf("<style"));

  it("renders „Frei“ in the hero on a free idle day and drops the duplicate meta fact", () => {
    expect(page).toContain("freeIdleDay(");
    expect(page).toMatch(/\{#if freeDay\}\s*Frei/);
    expect(page).not.toContain('value: "kein Arbeitstag"');
  });

  it("makes every week tile a link to its day", () => {
    expect(page).toMatch(/<a[^>]*class="mt-day-link"[^>]*href=\{weekTileHref\(/);
    expect(page).toContain("weekStripPhoneText(");
  });

  it("keeps the second line of a tile visible on the phone", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 759.98px)"));
    const block = phone.slice(0, phone.indexOf("@media (max-width: 1099.98px)"));
    const rule = /\.mt-day-s\s*\{([^}]*)\}/.exec(block);
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toContain("display: none");
  });

  it("dates the history through historyWhenLabel with the full date as a tooltip", () => {
    expect(page).toContain("historyWhenLabel(");
    expect(page).toMatch(/<time class="mt-when"[^>]*datetime=\{h\.when\}[^>]*title=/);
  });
});
