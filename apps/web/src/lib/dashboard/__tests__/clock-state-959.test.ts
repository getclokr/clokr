// Issue #959 — the stage's clock state follows the server's answer which open entry the clock acts
// on. A session across midnight (yesterday's open entry inside the tenant bound) is running on the
// stage; beyond the bound the server names nothing and the stage stays idle.
import { describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("$api/client", () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
  ApiError: class extends Error {
    constructor(
      public status: number,
      message = "err",
    ) {
      super(message);
    }
  },
}));
vi.mock("$lib/utils/logger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn() } }));

import { ApiError } from "$api/client";
import { resolveDayState, primaryClockLabel, type ClockDayEntry } from "../day-state";
import {
  clockRows,
  crossDaySession,
  crossDaySessionText,
  crossDaySinceLabel,
  loadClockState,
  type ClockStateAnswer,
} from "../clock-state";

const yesterdayOpen: ClockDayEntry = {
  id: "y1",
  date: "2026-11-09T00:00:00.000Z",
  startTime: new Date(2026, 10, 9, 20, 0).toISOString(),
  endTime: null,
  breakMinutes: 0,
  isLocked: false,
};
const session: ClockStateAnswer = { entry: yesterdayOpen, crossDay: true };

describe("clockRows + resolveDayState", () => {
  it("inside the bound: an empty today with the cross-day session is RUNNING with Ausstempeln", () => {
    const day = resolveDayState(clockRows([], session));
    expect(day.kind).toBe("running");
    expect(day.entry?.id).toBe("y1");
    expect(primaryClockLabel(day)).toBe("Ausstempeln");
  });

  it("beyond the bound (server names nothing): idle with Einstempeln — the old entry blocks nothing", () => {
    const day = resolveDayState(clockRows([], { entry: null, crossDay: false }));
    expect(day.kind).toBe("idle");
    expect(primaryClockLabel(day)).toBe("Einstempeln");
  });

  it("unknown clock state (load failed) keeps the per-day state of before #959", () => {
    expect(resolveDayState(clockRows([], null)).kind).toBe("idle");
  });

  it("a same-day answer (crossDay false) adds nothing — today's rows already carry it", () => {
    const todayOpen = { ...yesterdayOpen, id: "t1", date: "2026-11-10T00:00:00.000Z" };
    expect(clockRows([todayOpen], { entry: todayOpen, crossDay: false })).toEqual([todayOpen]);
    expect(crossDaySession({ entry: todayOpen, crossDay: false })).toBeNull();
  });

  it("the cross-day session outranks a closed row of today, like the resolver (D-03)", () => {
    const closedToday: ClockDayEntry = {
      id: "t2",
      date: "2026-11-10T00:00:00.000Z",
      startTime: new Date(2026, 10, 10, 6, 0).toISOString(),
      endTime: new Date(2026, 10, 10, 7, 0).toISOString(),
    };
    const day = resolveDayState(clockRows([closedToday], session));
    expect(day.kind).toBe("running");
    expect(day.entry?.id).toBe("y1");
  });

  it("never adds the session twice", () => {
    expect(clockRows([yesterdayOpen], session)).toEqual([yesterdayOpen]);
  });
});

describe("the cross-day wording", () => {
  it("names the start with its day, in du-form", () => {
    expect(crossDaySinceLabel(yesterdayOpen)).toBe("gestern, 20:00");
    const text = crossDaySessionText(yesterdayOpen);
    expect(text.title).toBe("Du bist seit gestern, 20:00 Uhr eingestempelt.");
    expect(text.detail).toContain("Ausstempeln beendet diesen Eintrag jetzt.");
  });
});

describe("loadClockState", () => {
  it("reads the server's answer", async () => {
    apiGet.mockResolvedValueOnce(session);
    await expect(loadClockState()).resolves.toEqual(session);
    expect(apiGet).toHaveBeenCalledWith("/time-entries/clock-state");
  });

  it("any failure is unknown (null), never a thrown error", async () => {
    apiGet.mockRejectedValueOnce(new ApiError(500, "err"));
    await expect(loadClockState()).resolves.toBeNull();
    apiGet.mockRejectedValueOnce(new ApiError(403, "err"));
    await expect(loadClockState()).resolves.toBeNull();
  });
});
