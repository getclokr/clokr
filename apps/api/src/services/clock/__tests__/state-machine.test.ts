import { describe, it, expect } from "vitest";
import { decide, crossDaySessionRuns } from "../state-machine";
import type { ClockState } from "../types";

describe("services/clock/state-machine — decide()", () => {
  describe("intent = AUTO (NFC tap, WIFI connected)", () => {
    it("NO_OPEN_ENTRY + AUTO → START", () => {
      const state: ClockState = { kind: "NO_OPEN_ENTRY" };
      expect(decide(state, "AUTO", "NFC")).toEqual({ kind: "START" });
    });

    it("OPEN_ENTRY same source + AUTO → STOP (toggle close)", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "NFC" };
      expect(decide(state, "AUTO", "NFC")).toEqual({ kind: "STOP", entryId: "entry-1" });
    });

    it("OPEN_ENTRY cross source + AUTO, presence-only → CONFIRM (WIFI re-detects NFC entry)", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "NFC" };
      expect(decide(state, "AUTO", "WIFI", true)).toEqual({ kind: "CONFIRM", entryId: "entry-1" });
    });

    it("OPEN_ENTRY cross source + AUTO, human act → STOP (Issue #818: NFC tap on a MOBILE entry)", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "MOBILE" };
      expect(decide(state, "AUTO", "NFC")).toEqual({ kind: "STOP", entryId: "entry-1" });
      expect(decide(state, "AUTO", "NFC", false)).toEqual({ kind: "STOP", entryId: "entry-1" });
    });

    it("OPEN_ENTRY same source + AUTO, presence-only → STOP (toggle unchanged)", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "WIFI" };
      expect(decide(state, "AUTO", "WIFI", true)).toEqual({ kind: "STOP", entryId: "entry-1" });
    });
  });

  describe("intent = IN (explicit /clock-in)", () => {
    it("NO_OPEN_ENTRY + IN → START", () => {
      const state: ClockState = { kind: "NO_OPEN_ENTRY" };
      expect(decide(state, "IN", "MOBILE")).toEqual({ kind: "START" });
    });

    it("OPEN_ENTRY + IN → CONFLICT ALREADY_CLOCKED_IN", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "MOBILE" };
      expect(decide(state, "IN", "MOBILE")).toEqual({
        kind: "CONFLICT",
        reason: "ALREADY_CLOCKED_IN",
      });
    });
  });

  describe("intent = OUT (explicit /clock-out, WIFI disconnected)", () => {
    it("OPEN_ENTRY + OUT → STOP", () => {
      const state: ClockState = { kind: "OPEN_ENTRY", entryId: "entry-1", source: "MOBILE" };
      expect(decide(state, "OUT", "MOBILE")).toEqual({ kind: "STOP", entryId: "entry-1" });
    });

    it("NO_OPEN_ENTRY + OUT → CONFLICT NOT_CLOCKED_IN", () => {
      const state: ClockState = { kind: "NO_OPEN_ENTRY" };
      expect(decide(state, "OUT", "MOBILE")).toEqual({
        kind: "CONFLICT",
        reason: "NOT_CLOCKED_IN",
      });
    });
  });

  describe("source-agnostic — unknown future sources handled gracefully", () => {
    it("AUTO + NO_OPEN_ENTRY + 'SYNTHETIC' source → START (architectural enforcement)", () => {
      const state: ClockState = { kind: "NO_OPEN_ENTRY" };
      expect(decide(state, "AUTO", "SYNTHETIC")).toEqual({ kind: "START" });
    });
  });

  describe("CLOSED_SAME_DAY_ENTRY (D-01 reopen)", () => {
    const closedState: ClockState = {
      kind: "CLOSED_SAME_DAY_ENTRY",
      entryId: "entry-1",
      endTime: new Date(),
      isLocked: false,
    };

    it("CLOSED_SAME_DAY_ENTRY + IN → REOPEN", () => {
      expect(decide(closedState, "IN", "MOBILE")).toEqual({
        kind: "REOPEN",
        entryId: "entry-1",
      });
    });

    it("CLOSED_SAME_DAY_ENTRY + AUTO → REOPEN (NFC tap on day with closed entry)", () => {
      expect(decide(closedState, "AUTO", "NFC")).toEqual({
        kind: "REOPEN",
        entryId: "entry-1",
      });
    });

    it("CLOSED_SAME_DAY_ENTRY + OUT → CONFLICT NOT_CLOCKED_IN (Pitfall 4)", () => {
      expect(decide(closedState, "OUT", "MOBILE")).toEqual({
        kind: "CONFLICT",
        reason: "NOT_CLOCKED_IN",
      });
    });
  });
});

// Issue #959 — whether yesterday's open entry is still the running clock session. Both sides of the
// tenant bound and a shift across midnight; the resolver and the own clock-state read decide
// through this one function.
describe("services/clock/state-machine — crossDaySessionRuns()", () => {
  const H = 3600_000;
  const start = new Date("2026-11-09T19:00:00.000Z"); // 20:00 Europe/Berlin

  it("inside the bound (12 h of 14 h) → running", () => {
    expect(crossDaySessionRuns(start, new Date(start.getTime() + 12 * H), 14, 24)).toBe(true);
  });

  it("exactly at the bound (14 h) → still running", () => {
    expect(crossDaySessionRuns(start, new Date(start.getTime() + 14 * H), 14, 24)).toBe(true);
  });

  it("one millisecond beyond the bound → no longer running", () => {
    expect(crossDaySessionRuns(start, new Date(start.getTime() + 14 * H + 1), 14, 24)).toBe(false);
  });

  it("an overnight shift (23:30 → 00:30) → running", () => {
    expect(
      crossDaySessionRuns(
        new Date("2026-11-09T22:30:00.000Z"),
        new Date("2026-11-09T23:30:00.000Z"),
        14,
        24,
      ),
    ).toBe(true);
  });

  it("bound 0 or missing falls back to the fixed cap, never to 'forever'", () => {
    for (const bound of [0, null, undefined]) {
      expect(crossDaySessionRuns(start, new Date(start.getTime() + 24 * H), bound, 24)).toBe(true);
      expect(crossDaySessionRuns(start, new Date(start.getTime() + 24 * H + 1), bound, 24)).toBe(
        false,
      );
    }
  });
});
