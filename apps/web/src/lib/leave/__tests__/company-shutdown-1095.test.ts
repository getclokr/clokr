// Issue #1095 — a leave row from a Betriebsurlaub says so, decided by the shutdown FIELD only.
// Pure model: the mark, the chip visual, the day-detail row, the timeline bar and the legend.
import { describe, it, expect } from "vitest";
import {
  COMPANY_SHUTDOWN_CODE,
  legendTypeCode,
  shutdownMark,
  shutdownTitle,
  withShutdownLabel,
  withShutdownTitle,
} from "../company-shutdown";
import { resolveChipVisual, resolveDayDetailRows } from "../team-calendar-visibility";
import { calendarToTimeline, type CalendarDetailedEntry } from "../timeline-model";
import { legendFrom, leaveTypeColor } from "../leave-colors";

const SHUTDOWN = { id: "sd1", name: "Weihnachtsschließung" };

function entry(over: Partial<CalendarDetailedEntry> = {}): CalendarDetailedEntry {
  return {
    id: "r1",
    isOwn: true,
    employeeId: "e1",
    firstName: "A",
    lastName: "B",
    typeCode: "VACATION",
    typeName: "Urlaub",
    startDate: "2026-12-28",
    endDate: "2026-12-30",
    halfDay: false,
    status: "APPROVED",
    isHoliday: false,
    ...over,
  };
}

describe("colour", () => {
  it("Betriebsurlaub has a fill of its own, none of a request type's", () => {
    const shutdown = leaveTypeColor("COMPANY_SHUTDOWN").fill;
    expect(shutdown).toBe("--leave-type-company-shutdown");
    for (const code of ["VACATION", "SICK", "SPECIAL", "UNPAID", "HOLIDAY", "PARENTAL"]) {
      expect(leaveTypeColor(code).fill).not.toBe(shutdown);
    }
  });
});

describe("shutdownMark", () => {
  it("is null for a row without the field, whatever its type text says", () => {
    expect(shutdownMark(null)).toBeNull();
    expect(shutdownMark({})).toBeNull();
    expect(shutdownMark({ companyShutdownId: null, companyShutdown: null })).toBeNull();
    expect(shutdownMark({ companyShutdownId: "" })).toBeNull();
    // The text is never a control value: a request named like the word is still no shutdown row.
    expect(shutdownMark(entry({ typeName: "Betriebsurlaub" }))).toBeNull();
  });

  it("reads the id and the name from the fields", () => {
    expect(shutdownMark({ companyShutdownId: "sd1", companyShutdown: SHUTDOWN })).toEqual({
      id: "sd1",
      name: "Weihnachtsschließung",
    });
    expect(shutdownMark({ companyShutdownId: "sd1" })).toEqual({ id: "sd1", name: null });
    expect(shutdownMark({ companyShutdown: SHUTDOWN })).toEqual({
      id: "sd1",
      name: "Weihnachtsschließung",
    });
  });
});

describe("labels", () => {
  const mark = { id: "sd1", name: "Weihnachtsschließung" };
  it("adds Betriebsurlaub to a request type and says a release day once", () => {
    expect(withShutdownLabel("Urlaub", mark, "VACATION")).toBe("Urlaub · Betriebsurlaub");
    expect(withShutdownLabel("Urlaub", null, "VACATION")).toBe("Urlaub");
    expect(withShutdownLabel("Betriebsurlaub", mark, COMPANY_SHUTDOWN_CODE)).toBe("Betriebsurlaub");
    expect(withShutdownTitle("Urlaub", mark, "VACATION")).toBe(
      "Urlaub · Betriebsurlaub: Weihnachtsschließung",
    );
    expect(withShutdownTitle("Betriebsurlaub", mark, COMPANY_SHUTDOWN_CODE)).toBe(
      "Betriebsurlaub: Weihnachtsschließung",
    );
    expect(shutdownTitle({ id: "x", name: null })).toBe("Betriebsurlaub");
  });

  it("legendTypeCode maps a shutdown row to the Betriebsurlaub code and leaves every other row alone", () => {
    expect(legendTypeCode("VACATION", mark)).toBe("COMPANY_SHUTDOWN");
    expect(legendTypeCode("VACATION", null)).toBe("VACATION");
    expect(legendTypeCode(null, null)).toBeNull();
  });
});

describe("resolveChipVisual", () => {
  it("shows Betriebsurlaub next to the type, in the Betriebsurlaub colour, only with the field", () => {
    const withField = resolveChipVisual(
      entry({ companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
      false,
    );
    expect(withField.chipLabel).toBe("Urlaub · Betriebsurlaub");
    expect(withField.typeLabel).toBe("Urlaub · Betriebsurlaub: Weihnachtsschließung");
    expect(withField.background).toBe(`var(${leaveTypeColor("COMPANY_SHUTDOWN").fill})`);

    const without = resolveChipVisual(entry(), false);
    expect(without.chipLabel).toBe("Urlaub");
    expect(without.typeLabel).toBe("Urlaub");
    expect(without.background).toBe(`var(${leaveTypeColor("VACATION").fill})`);
  });

  it("a release day reads Betriebsurlaub once", () => {
    const visual = resolveChipVisual(
      entry({
        typeCode: "COMPANY_SHUTDOWN",
        typeName: "Betriebsurlaub",
        companyShutdownId: "sd1",
        companyShutdown: SHUTDOWN,
      }),
      false,
    );
    expect(visual.chipLabel).toBe("Betriebsurlaub");
    expect(visual.typeLabel).toBe("Betriebsurlaub: Weihnachtsschließung");
  });

  it("a viewer who may not learn the type learns nothing of the shutdown either", () => {
    const visual = resolveChipVisual(
      entry({ isOwn: false, companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
      false,
    );
    expect(visual.typeLabel).toBeNull();
    expect(visual.chipLabel).toBe("abwesend");
  });
});

describe("resolveDayDetailRows", () => {
  it("names the shutdown on a row from one and not on another", () => {
    const rows = resolveDayDetailRows(
      [
        entry({ id: "a", companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
        entry({ id: "b" }),
        entry({ id: "c", isOwn: false, companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
      ],
      false,
    );
    expect(rows.map((r) => [r.id, r.typeLabel, r.shutdownName])).toEqual([
      ["a", "Urlaub · Betriebsurlaub", "Weihnachtsschließung"],
      ["b", "Urlaub", null],
      ["c", "abwesend", null],
    ]);
  });
});

describe("calendarToTimeline + legendFrom", () => {
  it("draws a shutdown row as Betriebsurlaub, keeps the request type in the text and the name in the bar", () => {
    const { rows } = calendarToTimeline([
      entry({ id: "a", companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
      entry({ id: "b", startDate: "2026-12-01", endDate: "2026-12-02" }),
    ]);
    const bars = rows[0].bars;
    const shutdownBar = bars.find((b) => b.key === "a")!;
    expect(shutdownBar.typeCode).toBe("COMPANY_SHUTDOWN");
    expect(shutdownBar.label).toBe("Urlaub · Betriebsurlaub");
    expect(shutdownBar.shutdown).toEqual({ id: "sd1", name: "Weihnachtsschließung" });
    const plain = bars.find((b) => b.key === "b")!;
    expect(plain.typeCode).toBe("VACATION");
    expect(plain.label).toBe("Urlaub");
    expect(plain.shutdown).toBeUndefined();
  });

  it("the legend names Betriebsurlaub exactly when a shutdown bar is in view", () => {
    const withShutdown = calendarToTimeline([
      entry({ companyShutdownId: "sd1", companyShutdown: SHUTDOWN }),
    ]);
    expect(legendFrom(withShutdown.rows).typeCodes).toEqual(["COMPANY_SHUTDOWN"]);

    const without = calendarToTimeline([entry()]);
    expect(legendFrom(without.rows).typeCodes).toEqual(["VACATION"]);
  });

  it("a release day without any request is its own bar and legend entry", () => {
    const { rows } = calendarToTimeline([
      entry({
        id: "shutdown-release-x",
        typeCode: "COMPANY_SHUTDOWN",
        typeName: "Betriebsurlaub",
        companyShutdownId: "sd1",
        companyShutdown: SHUTDOWN,
      }),
    ]);
    expect(rows[0].bars[0]).toMatchObject({
      typeCode: "COMPANY_SHUTDOWN",
      label: "Betriebsurlaub",
    });
    expect(legendFrom(rows).typeCodes).toEqual(["COMPANY_SHUTDOWN"]);
  });
});
