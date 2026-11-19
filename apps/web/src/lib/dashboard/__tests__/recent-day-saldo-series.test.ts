/**
 * Mein Tag „Letzte Tage“: the per-day saldo chip of a SHIFT_BASED person is left out (prod,
 * 19.11.2026). The open month's series is prorated by roster progress, so a full shift read as a
 * loss; until the server states „Ist gegen Schicht“ per day, no chip is shown for SHIFT_BASED.
 */
import { describe, it, expect } from "vitest";
import { recentDays, recentDaySaldoSeries } from "../mein-tag";

const series = new Map([
  ["2026-11-17", 2708],
  ["2026-11-18", 2641],
]);
const entries = [
  {
    id: "e1",
    startTime: "2026-11-18T07:19:00Z",
    endTime: "2026-11-18T17:02:00Z",
    breakMinutes: 45,
  },
];
const totals = () => ({ breakMinutes: 45, workingMinutes: 598 });

describe("recentDaySaldoSeries", () => {
  it("drops the series for SHIFT_BASED, so the day carries no saldo chip", () => {
    const rows = recentDays(
      entries as never,
      recentDaySaldoSeries("SHIFT_BASED", series),
      new Set(),
      totals,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].saldoMinutes).toBeNull();
  });

  it.each(["FIXED_SCHEDULE", "FLEXTIME", "MONTHLY_HOURS", null, undefined])(
    "keeps the series for %s (the day-to-day change as before)",
    (type) => {
      const rows = recentDays(
        entries as never,
        recentDaySaldoSeries(type, series),
        new Set(),
        totals,
      );
      expect(rows[0].saldoMinutes).toBe(2641 - 2708);
    },
  );
});
