/**
 * Issue #1079 (D-02, D-03, D-05, D-06) - the pure rule of who a Betriebsurlaub affects on which day.
 * No database: the module is import-free.
 */
import { describe, it, expect } from "vitest";
import {
  shutdownAffectedRuns,
  shutdownBookingSegments,
  shutdownScopesConflict,
} from "../company-shutdown/affected-days";

/** The #1069 month split, kept here verbatim as the reference the equivalence test compares to. */
function legacySplitByMonth(from: string, to: string): Array<{ start: string; end: string }> {
  const segments: Array<{ start: string; end: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const lastOfMonth = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    segments.push({ start: cursor, end: lastOfMonth < to ? lastOfMonth : to });
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  return segments;
}

function dayMap(entries: Array<[string, string | null]>): Map<string, string | null> {
  return new Map(entries);
}

describe("shutdownAffectedRuns / shutdownBookingSegments", () => {
  it("a tenant-wide shutdown is one run from..to whose month segments equal the #1069 split", () => {
    for (const [from, to] of [
      ["2027-01-05", "2027-01-05"],
      ["2027-01-28", "2027-03-02"],
      ["2027-12-20", "2028-01-10"],
      ["2027-02-01", "2027-02-28"],
    ]) {
      const runs = shutdownAffectedRuns({ from, to, salonIds: [] });
      expect(runs).toEqual([{ start: from, end: to }]);
      expect(shutdownBookingSegments(runs)).toEqual(legacySplitByMonth(from, to));
    }
  });

  it("from after to yields no run", () => {
    expect(shutdownAffectedRuns({ from: "2027-01-06", to: "2027-01-05", salonIds: [] })).toEqual(
      [],
    );
    expect(
      shutdownAffectedRuns({
        from: "2027-01-06",
        to: "2027-01-05",
        salonIds: ["a"],
        homeSalonByDay: dayMap([["2027-01-05", "a"]]),
      }),
    ).toEqual([]);
  });

  it("a salon-scoped shutdown yields the contiguous runs of days homed in a named salon", () => {
    const map = dayMap([
      ["2027-03-01", "a"],
      ["2027-03-02", "a"],
      ["2027-03-03", "b"],
      ["2027-03-04", null],
      ["2027-03-05", "c"],
      ["2027-03-06", "c"],
    ]);
    expect(
      shutdownAffectedRuns({
        from: "2027-03-01",
        to: "2027-03-06",
        salonIds: ["a", "c"],
        homeSalonByDay: map,
      }),
    ).toEqual([
      { start: "2027-03-01", end: "2027-03-02" },
      { start: "2027-03-05", end: "2027-03-06" },
    ]);
  });

  it("a day missing from the map breaks a run, a missing map yields none", () => {
    const map = dayMap([
      ["2027-03-01", "a"],
      ["2027-03-03", "a"],
    ]);
    expect(
      shutdownAffectedRuns({
        from: "2027-03-01",
        to: "2027-03-03",
        salonIds: ["a"],
        homeSalonByDay: map,
      }),
    ).toEqual([
      { start: "2027-03-01", end: "2027-03-01" },
      { start: "2027-03-03", end: "2027-03-03" },
    ]);
    expect(shutdownAffectedRuns({ from: "2027-03-01", to: "2027-03-03", salonIds: ["a"] })).toEqual(
      [],
    );
  });

  it("segments split each run at month boundaries", () => {
    expect(
      shutdownBookingSegments([
        { start: "2027-01-30", end: "2027-02-02" },
        { start: "2027-02-10", end: "2027-02-11" },
      ]),
    ).toEqual([
      { start: "2027-01-30", end: "2027-01-31" },
      { start: "2027-02-01", end: "2027-02-02" },
      { start: "2027-02-10", end: "2027-02-11" },
    ]);
  });
});

describe("shutdownScopesConflict", () => {
  const base = { start: "2027-03-01", end: "2027-03-10" };

  it("needs a shared day", () => {
    expect(
      shutdownScopesConflict(
        { ...base, salonIds: [] },
        { start: "2027-03-11", end: "2027-03-12", salonIds: [] },
      ),
    ).toBe(false);
    expect(
      shutdownScopesConflict(
        { ...base, salonIds: [] },
        { start: "2027-03-10", end: "2027-03-12", salonIds: [] },
      ),
    ).toBe(true);
  });

  it("an unternehmensweit one meets every scope on a shared day", () => {
    expect(shutdownScopesConflict({ ...base, salonIds: [] }, { ...base, salonIds: ["a"] })).toBe(
      true,
    );
    expect(shutdownScopesConflict({ ...base, salonIds: ["a"] }, { ...base, salonIds: [] })).toBe(
      true,
    );
  });

  it("salon sets conflict only when they intersect", () => {
    expect(shutdownScopesConflict({ ...base, salonIds: ["a"] }, { ...base, salonIds: ["b"] })).toBe(
      false,
    );
    expect(
      shutdownScopesConflict({ ...base, salonIds: ["a"] }, { ...base, salonIds: ["a", "b"] }),
    ).toBe(true);
  });
});
