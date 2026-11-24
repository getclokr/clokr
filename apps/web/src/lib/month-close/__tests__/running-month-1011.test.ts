// Issue #1011 (U-01): the running month opens, a later month and a month without data stay closed.
import { describe, expect, it } from "vitest";
import { canOpenMonth, isRunningMonthStatus } from "../running-month";
import { isRunningMonth, notEndedMonthLabel } from "$lib/saldo/month-status";
import type { MonthStatus } from "../types";

const TODAY = "2026-11-16";
const ms = (month: number, status: MonthStatus["status"], totalCount: number): MonthStatus => ({
  month,
  name: `M${month}`,
  status,
  closedCount: 0,
  totalCount,
});

describe("isRunningMonth / notEndedMonthLabel", () => {
  it("is true only for today's year and month", () => {
    expect(isRunningMonth(2026, 11, TODAY)).toBe(true);
    expect(isRunningMonth(2026, 12, TODAY)).toBe(false);
    expect(isRunningMonth(2025, 11, TODAY)).toBe(false);
    expect(isRunningMonth(2026, 10, TODAY)).toBe(false);
  });

  it("keeps the labels Läuft noch / Zukunft", () => {
    expect(notEndedMonthLabel(2026, 11, TODAY)).toBe("Läuft noch");
    expect(notEndedMonthLabel(2026, 12, TODAY)).toBe("Zukunft");
    expect(notEndedMonthLabel(2025, 11, TODAY)).toBe("Zukunft");
  });
});

describe("canOpenMonth", () => {
  it("never opens a month without data", () => {
    expect(canOpenMonth(ms(5, "no_data", 0), 2026, TODAY)).toBe(false);
  });

  it("opens the running month when it has persons", () => {
    expect(canOpenMonth(ms(11, "future", 2), 2026, TODAY)).toBe(true);
    expect(isRunningMonthStatus(ms(11, "future", 2), 2026, TODAY)).toBe(true);
  });

  it("does not open a running month without persons", () => {
    expect(canOpenMonth(ms(11, "future", 0), 2026, TODAY)).toBe(false);
  });

  it("does not open a later month", () => {
    expect(canOpenMonth(ms(12, "future", 2), 2026, TODAY)).toBe(false);
    expect(isRunningMonthStatus(ms(12, "future", 2), 2026, TODAY)).toBe(false);
  });

  it("keeps every other status openable", () => {
    for (const status of ["closed", "partial", "ready", "open", "blocked"] as const) {
      expect(canOpenMonth(ms(3, status, 2), 2026, TODAY), status).toBe(true);
    }
  });
});
