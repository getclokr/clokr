/**
 * Issue #1030 - the pure builder of the hours raster: minutes per cell, the Stichtag cut, which rows
 * can become minutes, the order of the rows and the sums. DB-free.
 */
import { describe, it, expect } from "vitest";
import {
  buildSalonHoursBlock,
  type SalonHoursEntryRow,
  type SalonHoursPerson,
} from "../salon-hours-cells";

const SALON = "salon-a";
const OTHER = "salon-b";
const DAYS = ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"];
const YESTERDAY = new Date("2026-03-12T00:00:00Z");

function row(
  employeeId: string,
  date: string,
  opts: Partial<SalonHoursEntryRow> & { hours?: number } = {},
): SalonHoursEntryRow {
  const hours = opts.hours ?? 8;
  return {
    employeeId,
    date: new Date(`${date}T00:00:00Z`),
    startTime: new Date(`${date}T08:00:00Z`),
    endTime: new Date(`${date}T${String(8 + hours).padStart(2, "0")}:00:00Z`),
    breakMinutes: 0,
    isInvalid: false,
    salonId: SALON,
    ...opts,
  };
}

function person(id: string, lastName: string, firstName = "Pp"): SalonHoursPerson {
  return { id, firstName, lastName, employeeNumber: `N-${id}` };
}

function build(
  persons: SalonHoursPerson[],
  rows: SalonHoursEntryRow[],
  countedThrough: string | null = "2026-03-12",
) {
  const rowsByPerson = new Map<string, SalonHoursEntryRow[]>();
  for (const r of rows)
    rowsByPerson.set(r.employeeId, [...(rowsByPerson.get(r.employeeId) ?? []), r]);
  return buildSalonHoursBlock({
    salonId: SALON,
    days: DAYS,
    countedThrough,
    yesterday: YESTERDAY,
    persons,
    rowsByPerson,
  });
}

describe("buildSalonHoursBlock (Issue #1030)", () => {
  it("puts the minutes of the salon's closed valid rows into the cell of their day", () => {
    const block = build(
      [person("p1", "Aa")],
      [row("p1", "2026-03-09", { breakMinutes: 30 }), row("p1", "2026-03-10", { hours: 4 })],
    );
    const cells = block.rows[0].cells;
    expect(cells.map((c) => c.minutes)).toEqual([450, 240, 0, 0, 0]);
    expect(block.rows[0].totalMinutes).toBe(690);
    expect(block.dayTotals).toEqual([450, 240, 0, 0, 0]);
    expect(block.totalMinutes).toBe(690);
  });

  it("counts several rows of one day together and ignores another salon's rows", () => {
    const block = build(
      [person("p1", "Aa")],
      [
        row("p1", "2026-03-09", { hours: 2 }),
        row("p1", "2026-03-09", { hours: 3 }),
        row("p1", "2026-03-09", { hours: 5, salonId: OTHER }),
      ],
    );
    expect(block.rows[0].cells[0].minutes).toBe(300);
  });

  it("never counts an open row, an invalid row or a day after yesterday", () => {
    const block = build(
      [person("p1", "Aa")],
      [
        row("p1", "2026-03-09", { endTime: null }),
        row("p1", "2026-03-10", { isInvalid: true }),
        row("p1", "2026-03-12"),
        row("p1", "2026-03-13"),
      ],
    );
    expect(block.rows[0].cells.map((c) => c.minutes)).toEqual([0, 0, 0, 480, 0]);
    expect(block.rows[0].cells.map((c) => c.counted)).toEqual([true, true, true, true, false]);
    expect(block.totalMinutes).toBe(480);
  });

  it("marks no day as counted when nothing is counted yet", () => {
    const block = build([person("p1", "Aa")], [row("p1", "2026-03-13")], null);
    expect(block.rows[0].cells.every((c) => !c.counted && c.minutes === 0)).toBe(true);
    expect(block.totalMinutes).toBe(0);
  });

  it("orders the rows by last name, first name, id", () => {
    const block = build(
      [person("p3", "Zz"), person("p2", "Aa", "Bb"), person("p1", "Aa", "Bb"), person("p4", "Äa")],
      [],
    );
    expect(block.rows.map((r) => r.employeeId)).toEqual(["p1", "p2", "p4", "p3"]);
  });

  it("makes every total the sum of its cells", () => {
    const block = build(
      [person("p1", "Aa"), person("p2", "Bb")],
      [
        row("p1", "2026-03-09"),
        row("p1", "2026-03-11", { hours: 3 }),
        row("p2", "2026-03-09", { hours: 6 }),
      ],
    );
    for (const r of block.rows) {
      expect(r.totalMinutes).toBe(r.cells.reduce((s, c) => s + c.minutes, 0));
    }
    DAYS.forEach((_, i) => {
      expect(block.dayTotals[i]).toBe(block.rows.reduce((s, r) => s + r.cells[i].minutes, 0));
    });
    expect(block.totalMinutes).toBe(block.rows.reduce((s, r) => s + r.totalMinutes, 0));
    expect(block.totalMinutes).toBeGreaterThan(0);
  });
});
