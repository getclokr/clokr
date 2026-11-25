/**
 * Issue #1069 (O-7) — the read-only Bestand list: its pure classification and its strict CLI
 * (no database).
 */
import { describe, it, expect } from "vitest";
import {
  classifyShutdownBookings,
  monthSegments,
  parseCli,
  type AbsenceRow,
  type PersonRow,
  type RequestRow,
  type ShutdownRow,
} from "../audit-1069-company-shutdown-bookings";

const shutdown = (over: Partial<ShutdownRow> = {}): ShutdownRow => ({
  id: "s1",
  tenantId: "t",
  startDay: "2027-03-29",
  endDay: "2027-04-02",
  deductsFromVacation: true,
  deleted: false,
  exceptedEmployeeIds: [],
  ...over,
});
const person = (over: Partial<PersonRow> = {}): PersonRow => ({
  id: "e1",
  hireDay: "2020-01-01",
  exitDay: null,
  ...over,
});
const absence = (over: Partial<AbsenceRow> = {}): AbsenceRow => ({
  employeeId: "e1",
  type: "COMPANY_SHUTDOWN",
  startDay: "2027-03-29",
  endDay: "2027-03-31",
  companyShutdownId: "s1",
  deleted: false,
  ...over,
});
const request = (over: Partial<RequestRow> = {}): RequestRow => ({
  employeeId: "e1",
  status: "APPROVED",
  startDay: "2027-03-29",
  endDay: "2027-03-31",
  companyShutdownId: "s1",
  ...over,
});

function classify(over: {
  shutdowns?: ShutdownRow[];
  persons?: PersonRow[];
  requests?: RequestRow[];
  absences?: AbsenceRow[];
  closedMonths?: string[];
}) {
  return classifyShutdownBookings({
    shutdowns: over.shutdowns ?? [shutdown()],
    persons: over.persons ?? [person()],
    requests: over.requests ?? [],
    absences: over.absences ?? [],
    closedMonths: new Set(over.closedMonths ?? []),
  });
}

describe("Issue #1069 — read-only Betriebsurlaub Bestand list", () => {
  it("splits a range at calendar month boundaries", () => {
    expect(monthSegments("2027-03-29", "2027-04-02")).toEqual([
      { start: "2027-03-29", end: "2027-03-31" },
      { start: "2027-04-01", end: "2027-04-02" },
    ]);
  });

  it("a shutdown nobody booked is MISSING per person and month", () => {
    const lines = classify({});
    expect(lines.map((l) => [l.employeeId, l.month, l.state])).toEqual([
      ["e1", "2027-03", "MISSING"],
      ["e1", "2027-04", "MISSING"],
    ]);
  });

  it("an active absence of the shutdown makes the month BOOKED and counts the generated requests by status", () => {
    const lines = classify({
      absences: [absence()],
      requests: [request(), request({ status: "CANCELLED" })],
    });
    const march = lines.find((l) => l.month === "2027-03");
    expect(march).toMatchObject({
      state: "BOOKED",
      generatedRequests: { APPROVED: 1, CANCELLED: 1 },
    });
    expect(lines.find((l) => l.month === "2027-04")?.state).toBe("MISSING");
  });

  it("a soft-deleted absence books nothing; a closed month without a booking is CLOSED_MONTH, not MISSING", () => {
    const lines = classify({
      absences: [absence({ deleted: true })],
      closedMonths: ["e1|2027-03"],
    });
    expect(lines.find((l) => l.month === "2027-03")?.state).toBe("CLOSED_MONTH");
  });

  it("a person on the exception list is EXCEPTED, never MISSING", () => {
    const lines = classify({ shutdowns: [shutdown({ exceptedEmployeeIds: ["e1"] })] });
    expect(lines.every((l) => l.state === "EXCEPTED")).toBe(true);
  });

  it("only the months of the person's employment inside the shutdown are listed", () => {
    expect(classify({ persons: [person({ hireDay: "2027-04-01" })] }).map((l) => l.month)).toEqual([
      "2027-04",
    ]);
    expect(classify({ persons: [person({ exitDay: "2027-03-30" })] }).map((l) => l.month)).toEqual([
      "2027-03",
    ]);
    expect(classify({ persons: [person({ hireDay: "2027-05-01" })] })).toEqual([]);
  });

  it("counts the days other Urlaub already holds, never the shutdown's own requests or cancelled ones", () => {
    const lines = classify({
      requests: [
        request({ companyShutdownId: null, startDay: "2027-03-30", endDay: "2027-03-31" }),
        request({
          companyShutdownId: null,
          status: "REJECTED",
          startDay: "2027-03-29",
          endDay: "2027-03-29",
        }),
        request(),
      ],
    });
    expect(lines.find((l) => l.month === "2027-03")?.otherLeaveDays).toBe(2);
  });

  it("a soft-deleted shutdown is listed only where generated rows still stand", () => {
    const deleted = shutdown({ deleted: true });
    expect(classify({ shutdowns: [deleted] })).toEqual([]);
    const lines = classify({
      shutdowns: [deleted],
      absences: [absence()],
      closedMonths: ["e1|2027-03"],
    });
    expect(lines.map((l) => [l.month, l.state, l.shutdownDeleted])).toEqual([
      ["2027-03", "BOOKED", true],
    ]);
  });

  it("a line carries exactly ids, codes and counts and nothing else", () => {
    const [line] = classify({});
    expect(Object.keys(line).sort()).toEqual(
      [
        "deductsFromVacation",
        "employeeId",
        "generatedRequests",
        "month",
        "otherLeaveDays",
        "shutdownDeleted",
        "shutdownId",
        "state",
        "tenantId",
      ].sort(),
    );
  });

  it("parseCli accepts --help and --tenant only and rejects every write flag", () => {
    expect(parseCli([])).toEqual({ help: false, tenantId: null });
    expect(parseCli(["--help"])).toEqual({ help: true, tenantId: null });
    expect(parseCli(["--tenant", "abc"])).toEqual({ help: false, tenantId: "abc" });
    expect(() => parseCli(["--confirm"])).toThrow();
    expect(() => parseCli(["--apply"])).toThrow();
    expect(() => parseCli(["--dry-run"])).toThrow();
  });
});

describe("Issue #1079 — a salon-scoped Betriebsurlaub is judged by the Stammsalon per day", () => {
  const homeDays = (entries: Array<[string, string | null]>) => new Map(entries);
  const allDays = (salonId: string | null, from: string, to: string) => {
    const days: Array<[string, string | null]> = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 24 * 60 * 60 * 1000) {
      days.push([new Date(t).toISOString().slice(0, 10), salonId]);
    }
    return days;
  };
  const scoped = (over: Partial<ShutdownRow> = {}) => shutdown({ salonIds: ["a"], ...over });

  function classifyScoped(over: {
    shutdowns?: ShutdownRow[];
    home: Map<string, Map<string, string | null>>;
    absences?: AbsenceRow[];
    closedMonths?: string[];
  }) {
    return classifyShutdownBookings({
      shutdowns: over.shutdowns ?? [scoped()],
      persons: [person()],
      requests: [],
      absences: over.absences ?? [],
      closedMonths: new Set(over.closedMonths ?? []),
      homeSalonDays: over.home,
    });
  }

  it("a person never homed in the named salons yields no line", () => {
    const lines = classifyScoped({
      home: new Map([["e1", homeDays(allDays("b", "2027-03-29", "2027-04-02"))]]),
    });
    expect(lines).toEqual([]);
  });

  it("a person without any Stammsalon day yields no line", () => {
    expect(classifyScoped({ home: new Map() })).toEqual([]);
  });

  it("a person homed there for part of a month gets one line for that month, BOOKED only when every affected segment is covered", () => {
    const days = [
      ...allDays("a", "2027-03-29", "2027-03-30"),
      ...allDays("b", "2027-03-31", "2027-03-31"),
      ...allDays("a", "2027-04-01", "2027-04-02"),
    ];
    const home = new Map([["e1", homeDays(days)]]);

    const missing = classifyScoped({ home });
    expect(missing.map((l) => [l.month, l.state])).toEqual([
      ["2027-03", "MISSING"],
      ["2027-04", "MISSING"],
    ]);

    const booked = classifyScoped({
      home,
      absences: [
        absence({ startDay: "2027-03-29", endDay: "2027-03-30" }),
        absence({ startDay: "2027-04-01", endDay: "2027-04-02" }),
      ],
    });
    expect(booked.map((l) => [l.month, l.state])).toEqual([
      ["2027-03", "BOOKED"],
      ["2027-04", "BOOKED"],
    ]);

    // Two segments in one month, only the first covered: not BOOKED.
    const twoRuns = new Map([
      [
        "e1",
        homeDays([
          ...allDays("a", "2027-03-29", "2027-03-29"),
          ...allDays("b", "2027-03-30", "2027-03-30"),
          ...allDays("a", "2027-03-31", "2027-03-31"),
        ]),
      ],
    ]);
    const partial = classifyScoped({
      home: twoRuns,
      absences: [absence({ startDay: "2027-03-29", endDay: "2027-03-29" })],
    });
    expect(partial.map((l) => [l.month, l.state])).toEqual([["2027-03", "MISSING"]]);
  });

  it("an unternehmensweit shutdown yields the identical lines with or without day maps", () => {
    const without = classify({ absences: [absence()] });
    const withMaps = classifyShutdownBookings({
      shutdowns: [shutdown()],
      persons: [person()],
      requests: [],
      absences: [absence()],
      closedMonths: new Set(),
      homeSalonDays: new Map([["e1", homeDays(allDays("b", "2027-03-29", "2027-04-02"))]]),
    });
    expect(withMaps).toEqual(without);
  });
});
