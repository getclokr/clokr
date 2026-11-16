// Issue #986 — „Monat bis gestern“ of Heute im Salon: the recorded time is never mixed with a
// credit, and „erfasst in diesem Salon“ appears only for the salon's own entries.
import { describe, expect, it, vi } from "vitest";

vi.mock("$api/client", () => ({
  api: { get: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("$lib/utils/logger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn() } }));

import { teamMonthKpi, type TeamTrendMonth, type TeamTrendResponse } from "../team-view";

function response(
  recordedBasis: TeamTrendResponse["recordedBasis"],
  month: Partial<TeamTrendMonth>,
): { resp: TeamTrendResponse; month: TeamTrendMonth } {
  const m: TeamTrendMonth = {
    month: "2026-11",
    workedMinutes: 312 * 60,
    shouldMinutes: null,
    recordedMinutes: 280 * 60,
    toDateWorkedMinutes: null,
    toDateShouldMinutes: null,
    sickDays: 0,
    ...month,
  };
  return {
    resp: {
      salonId: recordedBasis === "SALON_ENTRIES" ? "s-1" : null,
      workedBasis: recordedBasis === "SALON_ENTRIES" ? "SALON_ENTRIES" : "ACCOUNT",
      recordedBasis,
      sollUnavailableReason: "NO_PERMISSION",
      months: [m],
    },
    month: m,
  };
}

describe("teamMonthKpi (Issue #986)", () => {
  it("without Soll shows the recorded time, never the account's Ist with its credits", () => {
    // The user test: account Ist 312:00 (credits and future Berufsschule days inside), 35 recorded
    // entries of 8:00 in the salon view = 280:00.
    const { resp, month } = response("SALON_ENTRIES", {});
    const kpi = teamMonthKpi(resp, month);
    expect(kpi.valueMinutes).toBe(280 * 60);
    expect(kpi.shouldMinutes).toBeNull();
    expect(kpi.explanation).toBe("erfasst in diesem Salon");
  });

  it("names the reach or the whole team, never „in diesem Salon“ without a salon", () => {
    const scoped = response("SCOPE_ENTRIES", {});
    expect(teamMonthKpi(scoped.resp, scoped.month).explanation).toBe(
      "erfasst in deiner Reichweite",
    );
    const all = response("ALL_ENTRIES", {});
    expect(teamMonthKpi(all.resp, all.month).explanation).toBe("erfasst");
    expect(teamMonthKpi(all.resp, all.month).valueMinutes).toBe(280 * 60);
  });

  it("with Soll shows the account's to-date Ist and Soll and names the credit apart", () => {
    const { resp, month } = response("ALL_ENTRIES", {
      shouldMinutes: 320 * 60,
      toDateWorkedMinutes: 296 * 60,
      toDateShouldMinutes: 296 * 60,
    });
    const kpi = teamMonthKpi(resp, month);
    expect(kpi.valueMinutes).toBe(296 * 60);
    expect(kpi.shouldMinutes).toBe(296 * 60);
    expect(kpi.explanation).toBe("Ist / Soll · davon 280:00 h erfasst, 16:00 h Gutschrift");
  });

  it("with Soll and no credit says Ist / Soll only", () => {
    const { resp, month } = response("ALL_ENTRIES", {
      shouldMinutes: 320 * 60,
      toDateWorkedMinutes: 280 * 60,
      toDateShouldMinutes: 296 * 60,
    });
    expect(teamMonthKpi(resp, month).explanation).toBe("Ist / Soll");
  });
});
