/**
 * Issue #1095 - the pure kernel that decides which Betriebsurlaub days the absence calendar draws:
 * only the runs of a person's COMPANY_SHUTDOWN absence that no leave row of the same person covers.
 */
import { describe, it, expect } from "vitest";
import {
  releaseDayRuns,
  type ShutdownAbsenceRow,
} from "../contexts/absence/company-shutdown/calendar-release-days";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const WINDOW = { from: "2031-03-01", to: "2031-03-31" };

function absence(id: string, employeeId: string, start: string, end: string): ShutdownAbsenceRow {
  return {
    id,
    employeeId,
    startDate: d(start),
    endDate: d(end),
    companyShutdown: { id: "s1", name: "Betriebsurlaub" },
    employee: { id: employeeId, firstName: "A", lastName: "B", userId: null },
  };
}

const runs = (rows: ReturnType<typeof releaseDayRuns>) =>
  rows.map((r) => `${r.employeeId}:${iso(r.startDate)}..${iso(r.endDate)}`);

describe("releaseDayRuns", () => {
  it("returns the whole absence when nothing covers it", () => {
    const out = releaseDayRuns([absence("a1", "p1", "2031-03-03", "2031-03-07")], [], WINDOW);
    expect(runs(out)).toEqual(["p1:2031-03-03..2031-03-07"]);
    expect(out[0].companyShutdownId).toBe("s1");
    expect(out[0].companyShutdown).toEqual({ id: "s1", name: "Betriebsurlaub" });
  });

  it("drops the days a leave row of the SAME person covers and keeps the rest as runs", () => {
    const out = releaseDayRuns(
      [absence("a1", "p1", "2031-03-03", "2031-03-07")],
      [{ employeeId: "p1", startDate: d("2031-03-04"), endDate: d("2031-03-05") }],
      WINDOW,
    );
    expect(runs(out)).toEqual(["p1:2031-03-03..2031-03-03", "p1:2031-03-06..2031-03-07"]);
  });

  it("returns nothing for a fully covered absence", () => {
    const out = releaseDayRuns(
      [absence("a1", "p1", "2031-03-03", "2031-03-04")],
      [{ employeeId: "p1", startDate: d("2031-03-01"), endDate: d("2031-03-31") }],
      WINDOW,
    );
    expect(out).toEqual([]);
  });

  it("does not let another person's leave swallow a release day", () => {
    const out = releaseDayRuns(
      [absence("a1", "p1", "2031-03-03", "2031-03-04")],
      [{ employeeId: "p2", startDate: d("2031-03-03"), endDate: d("2031-03-04") }],
      WINDOW,
    );
    expect(runs(out)).toEqual(["p1:2031-03-03..2031-03-04"]);
  });

  it("clips to the window and gives every run a stable, distinct id", () => {
    const rows = [absence("a1", "p1", "2031-02-27", "2031-03-04")];
    const covering = [{ employeeId: "p1", startDate: d("2031-03-02"), endDate: d("2031-03-02") }];
    const first = releaseDayRuns(rows, covering, WINDOW);
    expect(runs(first)).toEqual(["p1:2031-03-01..2031-03-01", "p1:2031-03-03..2031-03-04"]);
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
    expect(releaseDayRuns(rows, covering, WINDOW).map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});
