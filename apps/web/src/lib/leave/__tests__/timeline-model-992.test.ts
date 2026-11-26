// Issue #992 (S-14, D-992-28) - the narrow-quarter helpers of the absence timeline.
import { describe, expect, it } from "vitest";
import {
  dayColumns,
  isoWeekColumns,
  loadCellLook,
  periodOf,
  weekHeaderLabels,
} from "../timeline-model";

describe("loadCellLook", () => {
  it("from the minimum width on the cell is the digit", () => {
    expect(loadCellLook(3, 18, 18).text).toBe("3");
    expect(loadCellLook(12, 40, 18).text).toBe("12");
    expect(loadCellLook(0, 40, 18).text).toBe("0");
  });

  it("below the minimum width there is no digit and the level is 0, 1, 2 or 3 for three or more", () => {
    expect(loadCellLook(0, 11, 18)).toEqual({ text: "", level: 0 });
    expect(loadCellLook(1, 11, 18)).toEqual({ text: "", level: 1 });
    expect(loadCellLook(2, 11, 18)).toEqual({ text: "", level: 2 });
    expect(loadCellLook(3, 11, 18)).toEqual({ text: "", level: 3 });
    expect(loadCellLook(9, 11, 18)).toEqual({ text: "", level: 3 });
  });
});

describe("weekHeaderLabels", () => {
  it("labels each ISO week of a quarter once, spanning its columns", () => {
    // Q4 2026: 1 Oct (Thursday, KW 40) to 31 Dec (Thursday, KW 53)
    const columns = dayColumns(periodOf("quartal", "2026-11-15"));
    const labels = weekHeaderLabels(columns);
    expect(labels[0]).toEqual({ index: 0, span: 4, label: "KW 40" }); // partial first week, Thu to Sun
    expect(labels[1]).toEqual({ index: 4, span: 7, label: "KW 41" });
    expect(labels.reduce((sum, l) => sum + l.span, 0)).toBe(columns.length);
    expect(labels.at(-1)?.label).toBe("KW 53");
    expect(labels.at(-1)?.span).toBe(4); // partial last week, Mon to Thu
  });

  it("uses the ISO week numbers isoWeekColumns counts", () => {
    const columns = dayColumns(periodOf("quartal", "2026-11-15"));
    const known = new Map(isoWeekColumns(2026).map((w) => [w.monday, w.isoWeek]));
    for (const label of weekHeaderLabels(columns).slice(1, -1)) {
      const monday = columns[label.index].day;
      expect(label.label).toBe(`KW ${known.get(monday)}`);
    }
  });

  it("returns nothing for no columns", () => {
    expect(weekHeaderLabels([])).toEqual([]);
  });
});
