/**
 * Issue #1030 - the pure builder of the hours raster: minutes per cell, the Stichtag cut, which rows
 * can become minutes, the order of the rows and the sums. DB-free.
 */
import { describe, it, expect } from "vitest";
import {
  absentDaysOf,
  buildSalonHoursBlock,
  type SalonHoursBlockInput,
  type SalonHoursEntryRow,
  type SalonHoursPerson,
} from "../salon-hours-cells";
import { personDayKey } from "../team-entry-scope";

const SALON = "salon-a";
const OTHER = "salon-b";
const THIRD = "salon-c";
const NAMES = new Map([
  [SALON, "Nord"],
  [OTHER, "Süd"],
  [THIRD, "Ost"],
]);
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
  extra: Partial<SalonHoursBlockInput> = {},
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
    salonNames: NAMES,
    showElsewhere: true,
    ...extra,
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

describe("cell states (Issue #1030)", () => {
  it("names the other salons of a counted day, sorted, never this salon", () => {
    const block = build(
      [person("p1", "Aa")],
      [
        row("p1", "2026-03-09", { salonId: THIRD, hours: 2 }),
        row("p1", "2026-03-09", { salonId: OTHER, hours: 1 }),
        row("p1", "2026-03-09", { salonId: OTHER, hours: 1 }),
        row("p1", "2026-03-09", { hours: 3 }),
      ],
    );
    const cell = block.rows[0].cells[0];
    expect(cell.elsewhere).toEqual([
      { salonId: THIRD, salonName: "Ost" },
      { salonId: OTHER, salonName: "Süd" },
    ]);
    // Only this salon's rows are minutes.
    expect(cell.minutes).toBe(180);
  });

  it("names no other salon on a day that is not counted or when the block does not ask for it", () => {
    const rows = [
      row("p1", "2026-03-13", { salonId: OTHER }),
      row("p1", "2026-03-09", { salonId: OTHER }),
    ];
    expect(build([person("p1", "Aa")], rows).rows[0].cells[4].elsewhere).toEqual([]);
    const helpers = build([person("p1", "Aa")], rows, "2026-03-12", { showElsewhere: false });
    expect(helpers.rows[0].cells[0].elsewhere).toEqual([]);
  });

  it("an open or invalid row of another salon is no time there", () => {
    const block = build(
      [person("p1", "Aa")],
      [
        row("p1", "2026-03-09", { salonId: OTHER, endTime: null }),
        row("p1", "2026-03-10", { salonId: OTHER, isInvalid: true }),
      ],
    );
    expect(block.rows[0].cells.every((c) => c.elsewhere.length === 0)).toBe(true);
  });

  it("marks hidden valid time only on counted days and carries neither minutes nor a salon", () => {
    const block = build([person("p1", "Aa")], [], "2026-03-12", {
      hiddenValidCounts: new Map([
        [personDayKey("p1", "2026-03-10"), 1],
        [personDayKey("p1", "2026-03-13"), 2],
      ]),
    });
    expect(block.rows[0].cells.map((c) => c.elsewhereHidden)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(block.rows[0].cells[1].minutes).toBe(0);
    expect(block.rows[0].cells[1].elsewhere).toEqual([]);
  });

  it("marks absent days from the given set, on any day, and a person without a set is never absent", () => {
    const block = build([person("p1", "Aa"), person("p2", "Bb")], [], "2026-03-12", {
      absentByPerson: new Map([["p1", new Set(["2026-03-11", "2026-03-13"])]]),
    });
    expect(block.rows[0].cells.map((c) => c.absent)).toEqual([false, false, true, false, true]);
    expect(block.rows[1].cells.every((c) => !c.absent)).toBe(true);
  });

  it("carries a helper's Stammsalon and withholds the Personalnummer on request", () => {
    const helper: SalonHoursPerson = {
      ...person("h1", "Aa"),
      homeSalonId: OTHER,
      homeSalonName: "Süd",
    };
    const none: SalonHoursPerson = {
      ...person("h2", "Bb"),
      homeSalonId: null,
      homeSalonName: null,
    };
    const block = build([helper, none], [], "2026-03-12", { withholdNumbers: true });
    expect(block.rows[0]).toMatchObject({
      homeSalonId: OTHER,
      homeSalonName: "Süd",
      employeeNumber: null,
    });
    expect(block.rows[1]).toMatchObject({ homeSalonId: null, homeSalonName: null });
    // A Stammteam row (no home fields) stays without them.
    const stamm = build([person("p1", "Aa")], []);
    expect(stamm.rows[0]).not.toHaveProperty("homeSalonId");
    expect(stamm.rows[0].employeeNumber).toBe("N-p1");
  });
});

describe("absentDaysOf (Issue #1030)", () => {
  const home = (map: Record<string, string | null>) => new Map(Object.entries(map));
  const period = (employeeId: string, start: string, end: string) => ({
    employeeId,
    startDate: new Date(`${start}T00:00:00Z`),
    endDate: new Date(`${end}T00:00:00Z`),
  });

  it("covers the days of a leave period or an absence on which the Stammsalon is this salon", () => {
    const result = absentDaysOf({
      salonId: SALON,
      days: DAYS,
      personIds: ["p1"],
      homeByPerson: new Map([["p1", home(Object.fromEntries(DAYS.map((d) => [d, SALON])))]]),
      covers: [period("p1", "2026-03-10", "2026-03-11")],
    });
    expect([...(result.get("p1") ?? [])]).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("skips days homed in another salon or nowhere, and persons without a home map", () => {
    const result = absentDaysOf({
      salonId: SALON,
      days: DAYS,
      personIds: ["p1", "p2"],
      homeByPerson: new Map([
        [
          "p1",
          home({
            "2026-03-09": OTHER,
            "2026-03-10": OTHER,
            "2026-03-11": SALON,
            "2026-03-12": null,
          }),
        ],
      ]),
      covers: [period("p1", "2026-03-09", "2026-03-12"), period("p2", "2026-03-09", "2026-03-13")],
    });
    expect([...(result.get("p1") ?? [])]).toEqual(["2026-03-11"]);
    expect(result.has("p2")).toBe(false);
  });

  it("ignores a cover of another person and a cover outside the window", () => {
    const result = absentDaysOf({
      salonId: SALON,
      days: DAYS,
      personIds: ["p1"],
      homeByPerson: new Map([["p1", home(Object.fromEntries(DAYS.map((d) => [d, SALON])))]]),
      covers: [period("p9", "2026-03-09", "2026-03-13"), period("p1", "2026-04-01", "2026-04-02")],
    });
    expect(result.size).toBe(0);
  });
});
