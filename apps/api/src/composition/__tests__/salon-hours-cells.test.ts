/**
 * Issue #1030 - the pure builder of the hours raster: minutes per cell, the Stichtag cut, which rows
 * can become minutes, the order of the rows and the sums. DB-free.
 */
import { describe, it, expect } from "vitest";
import {
  absentDaysOf,
  buildExchange,
  buildOpenItems,
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

describe("open cells and open items (Issue #1030, P-08)", () => {
  const open = (id: string, date: string, opts: Partial<SalonHoursEntryRow> = {}) =>
    row(id, date, { endTime: null, ...opts });
  const byPerson = (rows: SalonHoursEntryRow[]) => {
    const m = new Map<string, SalonHoursEntryRow[]>();
    for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
    return m;
  };
  const label = (d: Date) => `T${d.toISOString().slice(11, 16)}`;

  it("marks the cell of a past day with an open WORK row in this salon, never minutes", () => {
    const block = build([person("p1", "Aa")], [open("p1", "2026-03-10"), row("p1", "2026-03-09")]);
    expect(block.rows[0].cells.map((c) => c.open)).toEqual([false, true, false, false, false]);
    expect(block.rows[0].cells[1].minutes).toBe(0);
    expect(block.rows[0].totalMinutes).toBe(480);
  });

  it("an open row in another salon does not open this salon's cell", () => {
    const block = build([person("p1", "Aa")], [open("p1", "2026-03-10", { salonId: OTHER })]);
    expect(block.rows[0].cells.every((c) => !c.open)).toBe(true);
  });

  it("an open row of a day that is not counted yet is no open cell", () => {
    const block = build([person("p1", "Aa")], [open("p1", "2026-03-13")]);
    expect(block.rows[0].cells.every((c) => !c.open)).toBe(true);
  });

  it("lists the open rows of this salon dated through yesterday, ordered by date, start, name", () => {
    const rows = [
      open("p2", "2026-03-11"),
      open("p1", "2026-03-11", { startTime: new Date("2026-03-11T06:00:00Z") }),
      open("p1", "2026-03-09"),
      open("p1", "2026-03-12", { salonId: OTHER }), // another salon
      open("p2", "2026-03-13"), // after yesterday
      row("p1", "2026-03-10"), // closed
    ];
    const items = buildOpenItems({
      salonId: SALON,
      yesterday: YESTERDAY,
      persons: [person("p1", "Aa", "Zed"), person("p2", "Bb", "Amy")],
      rowsByPerson: byPerson(rows),
      timeOf: label,
    });
    expect(items).toEqual([
      { employeeId: "p1", employeeName: "Zed Aa", date: "2026-03-09", startTime: "T08:00" },
      { employeeId: "p1", employeeName: "Zed Aa", date: "2026-03-11", startTime: "T06:00" },
      { employeeId: "p2", employeeName: "Amy Bb", date: "2026-03-11", startTime: "T08:00" },
    ]);
  });
});

describe("buildExchange (Issue #1030, P-04)", () => {
  const helper = (id: string, last: string, homeSalonId: string | null, minutes: number) => ({
    employeeId: id,
    employeeName: `Pp ${last}`,
    employeeNumber: `N-${id}`,
    totalMinutes: minutes,
    cells: [],
    homeSalonId,
    homeSalonName: homeSalonId === null ? null : (NAMES.get(homeSalonId) ?? null),
  });
  const byPerson = (rows: SalonHoursEntryRow[]) => {
    const m = new Map<string, SalonHoursEntryRow[]>();
    for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
    return m;
  };

  it("groups the Aushilfen by Stammsalon with persons and minutes, null last, sorted by salon name", () => {
    const exchange = buildExchange({
      salonId: SALON,
      yesterday: YESTERDAY,
      countedThrough: "2026-03-12",
      salonNames: NAMES,
      helpers: [
        helper("h1", "Aa", OTHER, 120),
        helper("h2", "Bb", null, 60),
        helper("h3", "Cc", THIRD, 30),
        helper("h4", "Dd", OTHER, 15),
      ],
      stammteamPersons: [],
      rowsByPerson: new Map(),
    });
    expect(
      exchange.fromOtherSalons.map((g) => [g.salonId, g.salonName, g.persons, g.minutes]),
    ).toEqual([
      [THIRD, "Ost", 1, 30],
      [OTHER, "Süd", 2, 135],
      [null, null, 1, 60],
    ]);
    expect(exchange.fromOtherSalons[1].people.map((p) => p.employeeId)).toEqual(["h1", "h4"]);
    expect(exchange.ownTeamElsewhere).toEqual([]);
  });

  it("sums the Stammteam's closed valid counted time in other salons by entry salon", () => {
    const rows = [
      row("p1", "2026-03-09", { salonId: OTHER, hours: 4 }),
      row("p1", "2026-03-10", { salonId: OTHER, hours: 2 }),
      row("p1", "2026-03-10", { salonId: THIRD, hours: 1 }),
      row("p2", "2026-03-11", { salonId: OTHER, hours: 3 }),
      row("p1", "2026-03-11", { salonId: OTHER, endTime: null }), // open: no minutes
      row("p1", "2026-03-11", { salonId: THIRD, isInvalid: true }), // invalid
      row("p1", "2026-03-13", { salonId: OTHER }), // after the Stichtag
      row("p1", "2026-03-12", { salonId: SALON }), // this salon
    ];
    const exchange = buildExchange({
      salonId: SALON,
      yesterday: YESTERDAY,
      countedThrough: "2026-03-12",
      salonNames: NAMES,
      helpers: [],
      stammteamPersons: [person("p1", "Aa"), person("p2", "Bb")],
      rowsByPerson: byPerson(rows),
    });
    expect(
      exchange.ownTeamElsewhere.map((g) => [g.salonId, g.salonName, g.persons, g.minutes]),
    ).toEqual([
      [THIRD, "Ost", 1, 60],
      [OTHER, "Süd", 2, 540],
    ]);
    expect(exchange.ownTeamElsewhere[1].people.map((p) => [p.employeeId, p.minutes])).toEqual([
      ["p1", 360],
      ["p2", 180],
    ]);
  });

  it("counts nothing when no day is counted yet", () => {
    const exchange = buildExchange({
      salonId: SALON,
      yesterday: YESTERDAY,
      countedThrough: null,
      salonNames: NAMES,
      helpers: [],
      stammteamPersons: [person("p1", "Aa")],
      rowsByPerson: byPerson([row("p1", "2026-03-09", { salonId: OTHER })]),
    });
    expect(exchange.ownTeamElsewhere).toEqual([]);
  });
});
