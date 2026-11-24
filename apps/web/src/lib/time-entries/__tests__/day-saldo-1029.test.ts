// Issue #1029 - a calendar cell's day difference IS the server's `days[].balanceMinutes` of
// GET /overtime/month-saldo; the running saldo (`cumulativeSaldoMinutes`) appears only labelled.
// Unit part: the one mapping module. Source part: region-scoped pins on the two Zeiten pages
// (explicit paths, never a tree walk - not-a-guard for lint-guard-vacuity.ts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DAY_DIFF_TITLE,
  RUNNING_SALDO_LABEL,
  dayDiffText,
  daySaldoByDate,
  daySaldoTitle,
} from "../day-saldo";

// A recorded `days` array of an open month (SHIFT_BASED): the second day is a fully worked shift day
// whose § 615 step is NEGATIVE (roster proration, D-09) - the figure the owner asked about.
const OPEN_MONTH_DAYS = [
  { date: "2026-11-02", cumulativeSaldoMinutes: 3600, balanceMinutes: 6 },
  { date: "2026-11-03", cumulativeSaldoMinutes: 3558, balanceMinutes: -42 },
  { date: "2026-11-04", cumulativeSaldoMinutes: 3594, balanceMinutes: 36 },
];

describe("daySaldoByDate", () => {
  it("maps every date to the server's step verbatim and the running series", () => {
    const map = daySaldoByDate(OPEN_MONTH_DAYS);
    for (const d of OPEN_MONTH_DAYS) {
      expect(map.get(d.date)).toEqual({
        diffMin: d.balanceMinutes,
        runningMin: d.cumulativeSaldoMinutes,
      });
    }
    expect(map.get("2026-11-03")?.diffMin).toBe(-42);
  });

  it("the step is exactly the difference of two cumulative values (account arithmetic, not the web's)", () => {
    const map = daySaldoByDate(OPEN_MONTH_DAYS);
    expect(map.get("2026-11-03")!.runningMin - map.get("2026-11-02")!.runningMin).toBe(
      map.get("2026-11-03")!.diffMin,
    );
  });

  it("a closed month's single terminal entry has no step, only the stored carry-over", () => {
    const map = daySaldoByDate([{ date: "2026-10-31", cumulativeSaldoMinutes: 1234 }]);
    expect(map.get("2026-10-31")).toEqual({ diffMin: null, runningMin: 1234 });
  });

  it("withheld day details (#86) and a missing series give no figure at all", () => {
    expect(daySaldoByDate(OPEN_MONTH_DAYS, true).size).toBe(0);
    expect(daySaldoByDate(null).size).toBe(0);
    expect(daySaldoByDate(undefined).size).toBe(0);
  });
});

describe("day figure wording", () => {
  it("formats like the list chips and the day view", () => {
    expect(dayDiffText(30)).toBe("+0:30");
    expect(dayDiffText(0)).toBe("±0:00");
    expect(dayDiffText(-75)).toBe("−1:15");
  });

  it("labels the running saldo in the tooltip, never bare", () => {
    expect(daySaldoTitle({ diffMin: 30, runningMin: 3594 })).toBe(
      "Differenz: +0:30 · Gesamtsaldo bis zu diesem Tag: +59:54",
    );
    expect(daySaldoTitle({ diffMin: null, runningMin: 3594 })).toBe(
      "Gesamtsaldo bis zu diesem Tag: +59:54",
    );
    expect(daySaldoTitle(undefined)).toBeUndefined();
    expect(RUNNING_SALDO_LABEL).toBe("Gesamtsaldo bis zu diesem Tag");
    expect(DAY_DIFF_TITLE).toBe("So verändert dieser Tag den Gesamtsaldo.");
  });
});

const WEB_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TEAM = readFileSync(
  path.join(WEB_SRC, "routes/(app)/team/time-entries/+page.svelte"),
  "utf-8",
);
const ICH = readFileSync(path.join(WEB_SRC, "routes/(app)/time-entries/+page.svelte"), "utf-8");

function between(text: string, from: string, to: string, fromAt = 0): string {
  const start = text.indexOf(from, fromAt);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  const end = text.indexOf(to, start + from.length);
  expect(end, `${to} not found after ${from}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("both Zeiten pages read the day series only through day-saldo.ts", () => {
  it("Team › Zeiten: the calendar cell prints the server's step and subtracts nothing", () => {
    expect(TEAM).toContain("daySaldoByDate(");
    const cells = between(TEAM, "{#each calendarDays as day (day.dateStr)}", "<!-- Legende -->");
    expect(cells).toContain("dayDiffText(");
    expect(cells).toContain(".diffMin");
    expect(cells).not.toContain("cumulativeSaldoMinutes");
    expect(cells).not.toMatch(/-\s*day\.expectedMin/);
    expect(cells).not.toContain("creditedMin");
  });

  it("Ich › Zeiten: only the SHIFT_BASED cell is the server's step (P-1029-06)", () => {
    expect(ICH).toContain("daySaldoByDate(");
    const each = between(ICH, "{#each calendarDays as day (day.dateStr)}", "</button>");
    const shiftBranch = between(each, "{#if isShiftBased}", "{:else if");
    expect(shiftBranch).toContain("dayDiffText(");
    expect(shiftBranch).toContain(".diffMin");
    expect(shiftBranch).not.toContain("cumulativeSaldoMinutes");
  });
});
