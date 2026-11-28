import { describe, it, expect } from "vitest";
import { breakBlocksCloseFor } from "../month-close-break-block";

describe("breakBlocksCloseFor (Issue #522)", () => {
  const on = { blockMonthCloseOnUnconfirmedBreak: true };
  const off = { blockMonthCloseOnUnconfirmedBreak: false };

  it("is true with the flag on and an unconfirmed-break day", () => {
    expect(breakBlocksCloseFor({ unconfirmedBreakDays: [{}], breakFindingDays: [] }, on)).toBe(
      true,
    );
  });

  it("is true with the flag on and a break-finding day", () => {
    expect(breakBlocksCloseFor({ unconfirmedBreakDays: [], breakFindingDays: [{}] }, on)).toBe(
      true,
    );
  });

  it("is false with the flag on and both lists empty or absent", () => {
    expect(breakBlocksCloseFor({ unconfirmedBreakDays: [], breakFindingDays: [] }, on)).toBe(false);
    expect(breakBlocksCloseFor({}, on)).toBe(false);
  });

  it("is false with the flag off, unset or the config missing, even with break days", () => {
    const row = { unconfirmedBreakDays: [{}], breakFindingDays: [{}] };
    expect(breakBlocksCloseFor(row, off)).toBe(false);
    expect(breakBlocksCloseFor(row, {})).toBe(false);
    expect(breakBlocksCloseFor(row, null)).toBe(false);
    expect(breakBlocksCloseFor(row, undefined)).toBe(false);
  });
});
