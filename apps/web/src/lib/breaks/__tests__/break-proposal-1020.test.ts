import { describe, it, expect } from "vitest";
import { proposeBreakSlot, FALLBACK_BREAK_START } from "../break-proposal";

const slot = (
  defaultBreakStart: string | null | undefined,
  entryStart: string | null,
  entryEnd: string | null,
  minutes: number,
) => proposeBreakSlot({ defaultBreakStart, entryStart, entryEnd, minutes });

describe("proposeBreakSlot (Issue #1020)", () => {
  it("starts at the tenant's default time, not at 12:00", () => {
    expect(slot("13:00", "08:45", "19:00", 45)).toEqual({ start: "13:00", end: "13:45" });
  });

  it("falls back to 12:00 when the default is unknown or malformed", () => {
    expect(FALLBACK_BREAK_START).toBe("12:00");
    for (const d of [null, undefined, "25:99", "12", ""]) {
      expect(slot(d, "08:00", "17:00", 30)).toEqual({ start: "12:00", end: "12:30" });
    }
  });

  it("never starts before the entry", () => {
    expect(slot("12:00", "14:00", "22:00", 30)).toEqual({ start: "14:00", end: "14:30" });
  });

  it("moves earlier so the slot ends by the entry end", () => {
    expect(slot("12:00", "06:00", "12:15", 30)).toEqual({ start: "11:45", end: "12:15" });
  });

  it("applies only the start bound to an open entry", () => {
    expect(slot("12:30", "08:00", null, 30)).toEqual({ start: "12:30", end: "13:00" });
  });

  it("ignores the end bound of an overnight entry", () => {
    expect(slot("12:00", "22:00", "06:00", 30)).toEqual({ start: "22:00", end: "22:30" });
  });

  it("never reaches outside an entry shorter than the break", () => {
    expect(slot("12:00", "10:00", "10:20", 30)).toEqual({ start: "10:00", end: "10:20" });
  });

  it("never passes 23:59", () => {
    expect(slot("23:50", "08:00", null, 30)).toEqual({ start: "23:50", end: "23:59" });
  });

  it("treats an unparsable entry start as unknown", () => {
    expect(slot("13:00", "", null, 30)).toEqual({ start: "13:00", end: "13:30" });
  });
});
