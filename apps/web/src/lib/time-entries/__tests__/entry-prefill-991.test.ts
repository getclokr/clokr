// Issue #991 N-09 / M-44 (D-991-06) - what a NEW single entry on an empty day is prefilled with.
//
// Before: always 09:00-17:00, with a break row only when the tenant has a default break start. A
// person with a 08:30-17:00 day and a 30 minute break got a form that was wrong in three places and
// two ArbZG warnings she had not caused. Now the form starts from her usual day, else from the
// contract hours of that weekday, else from the old default. The server stays the authority for
// every rule; this only fills fields.
import { describe, expect, it } from "vitest";
import { prefillNewEntry, type PrefillEntryRow } from "../day-entry-actions";

// Local wall-clock instants (any time zone): the helper formats them back with the same zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m, 0).toISOString();
const dateKey = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

function row(
  day: number,
  start: [number, number],
  end: [number, number] | null,
  extra: Partial<PrefillEntryRow> = {},
): PrefillEntryRow {
  return {
    date: `${dateKey(day)}T00:00:00.000Z`,
    startTime: at(day, ...start),
    endTime: end ? at(day, ...end) : null,
    breaks: [],
    type: "WORK",
    isInvalid: false,
    ...extra,
  };
}

const BASE = {
  entries: [] as PrefillEntryRow[],
  dayContractMinutes: 0,
  defaultBreakStart: null as string | null,
  breakOver6h: 30,
  breakOver9h: 45,
};

// 2026-11-12 is a Thursday; 10.11. and 17.11. are Tuesdays, 11.11. a Wednesday, 5.11. a Thursday.
const TARGET = dateKey(12);

describe("prefillNewEntry - the person's usual day", () => {
  it("copies start, end and breaks of the latest one-entry closed day", () => {
    const usual = row(10, [8, 30], [17, 0], {
      breaks: [{ startTime: at(10, 12, 30), endTime: at(10, 13, 0) }],
    });
    const got = prefillNewEntry(TARGET, { ...BASE, entries: [usual] });
    expect(got).toEqual({
      start: "08:30",
      end: "17:00",
      breaks: [{ start: "12:30", end: "13:00" }],
      source: { kind: "usual", day: dateKey(10) },
    });
  });

  it("prefers the same weekday over a more recent other weekday", () => {
    const sameWeekday = row(5, [9, 0], [16, 0]); // Thursday, like the target
    const moreRecent = row(11, [7, 0], [15, 0]); // Wednesday
    const got = prefillNewEntry(TARGET, { ...BASE, entries: [sameWeekday, moreRecent] });
    expect(got.source).toEqual({ kind: "usual", day: dateKey(5) });
    expect(got.start).toBe("09:00");
    expect(got.end).toBe("16:00");
  });

  it("without a same-weekday day it takes the latest of the others", () => {
    const older = row(3, [7, 0], [15, 0]);
    const newer = row(11, [8, 0], [16, 0]);
    const got = prefillNewEntry(TARGET, { ...BASE, entries: [older, newer] });
    expect(got.source).toEqual({ kind: "usual", day: dateKey(11) });
  });

  it("skips a day with two entries", () => {
    const entries = [row(10, [8, 0], [12, 0]), row(10, [13, 0], [17, 0])];
    const got = prefillNewEntry(TARGET, { ...BASE, entries });
    expect(got.source.kind).toBe("default");
  });

  it("skips an invalid entry, an open entry, a trip and a pending Zeitnachtrag row", () => {
    const entries = [
      row(9, [8, 0], [16, 0], { isInvalid: true }),
      row(10, [8, 0], null),
      row(11, [8, 0], [16, 0], { activityKind: "TRAVEL" }),
      row(5, [8, 0], [16, 0], { retroRequestId: "r1" }),
    ];
    expect(prefillNewEntry(TARGET, { ...BASE, entries }).source.kind).toBe("default");
  });

  it("never uses the target day itself", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, entries: [row(12, [6, 0], [14, 0])] });
    expect(got.source.kind).toBe("default");
  });

  it("wins over the contract hours", () => {
    const got = prefillNewEntry(TARGET, {
      ...BASE,
      entries: [row(10, [8, 0], [16, 0])],
      dayContractMinutes: 480,
    });
    expect(got.source.kind).toBe("usual");
  });
});

describe("prefillNewEntry - the contract hours of the weekday", () => {
  it("8 h without a default break start: 09:00-17:30 and no break row", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, dayContractMinutes: 480 });
    expect(got).toEqual({
      start: "09:00",
      end: "17:30",
      breaks: [],
      source: { kind: "contract", minutes: 480 },
    });
  });

  it("8 h with a default break start 12:00: the break 12:00-12:30", () => {
    const got = prefillNewEntry(TARGET, {
      ...BASE,
      dayContractMinutes: 480,
      defaultBreakStart: "12:00",
    });
    expect(got.end).toBe("17:30");
    expect(got.breaks).toEqual([{ start: "12:00", end: "12:30" }]);
  });

  it("10 h gets the 45 minute break: 09:00-19:45", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, dayContractMinutes: 600 });
    expect(got.start).toBe("09:00");
    expect(got.end).toBe("19:45");
  });

  it("5 h needs no break: 09:00-14:00", () => {
    const got = prefillNewEntry(TARGET, {
      ...BASE,
      dayContractMinutes: 300,
      defaultBreakStart: "12:00",
    });
    expect(got.end).toBe("14:00");
    expect(got.breaks).toEqual([]);
  });

  it("uses the tenant's break durations", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, dayContractMinutes: 480, breakOver6h: 45 });
    expect(got.end).toBe("17:45");
  });

  it("caps the end at 23:59", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, dayContractMinutes: 900 });
    expect(got.end).toBe("23:59");
  });

  it("a default break start outside the work period gives no break row (never invented)", () => {
    const got = prefillNewEntry(TARGET, {
      ...BASE,
      dayContractMinutes: 480,
      defaultBreakStart: "06:00",
    });
    expect(got.breaks).toEqual([]);
  });
});

describe("prefillNewEntry - nothing known", () => {
  it("is 09:00-17:00, as before", () => {
    expect(prefillNewEntry(TARGET, BASE)).toEqual({
      start: "09:00",
      end: "17:00",
      breaks: [],
      source: { kind: "default" },
    });
  });

  it("keeps today's break rule: a row only with a default break start (30 minutes for 8 h)", () => {
    const got = prefillNewEntry(TARGET, { ...BASE, defaultBreakStart: "12:00" });
    expect(got.breaks).toEqual([{ start: "12:00", end: "12:30" }]);
    expect(got.source).toEqual({ kind: "default" });
  });
});
