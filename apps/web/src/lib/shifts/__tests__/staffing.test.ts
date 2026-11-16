// Issue #850 — the Besetzung of a day reads "x / y", never a decimal such as "1.00".
import { describe, it, expect } from "vitest";
import {
  STAFFING_EXPLANATION,
  formatStaff,
  staffingFigure,
  staffingStatusText,
  staffingTooltip,
  type StaffingDay,
} from "../staffing";

const day = (over: Partial<StaffingDay> = {}): StaffingDay => ({
  effectiveStaff: 2,
  minStaff: 3,
  hasSupervisor: true,
  unsupervisedAzubis: 0,
  coverageStatus: "under",
  ...over,
});

describe("staffing display (Issue #850)", () => {
  it("shows whole numbers without decimals", () => {
    expect(staffingFigure(day())).toBe("2 / 3");
    expect(staffingFigure(day({ effectiveStaff: 1, minStaff: 2 }))).toBe("1 / 2");
    expect(staffingFigure(day({ effectiveStaff: 0, minStaff: 2 }))).toBe("0 / 2");
  });

  it("keeps a real fraction with a German comma, never a dot", () => {
    expect(staffingFigure(day({ effectiveStaff: 1.5, minStaff: 2 }))).toBe("1,5 / 2");
    expect(formatStaff(0.75)).toBe("0,75");
  });

  it("never prints a decimal-dot value such as 1.00", () => {
    for (const v of [0, 1, 1.5, 2, 2.25, 10]) {
      expect(formatStaff(v)).not.toMatch(/\./);
      expect(formatStaff(v)).not.toMatch(/,0+$/);
    }
  });

  it("words the status and the hover text", () => {
    expect(staffingStatusText("ok")).toBe("besetzt");
    expect(staffingStatusText("under")).toBe("zu wenig");
    expect(staffingStatusText("supervision-missing")).toBe("Aufsicht fehlt");
    expect(staffingTooltip(day())).toContain("2 von 3 besetzt");
    expect(staffingTooltip(undefined)).toBe("");
    expect(
      staffingTooltip(
        day({ coverageStatus: "supervision-missing", unsupervisedAzubis: 1, hasSupervisor: false }),
      ),
    ).toContain("ohne Aufsicht");
  });
});

// Issue #589 (owner decision 19.10.2026, OD-589-1; AC-589-7)
describe("staffing of a closed day and the explanation (Issue #589)", () => {
  it("a closed day reads as closed, never as a shortfall or a missing supervisor", () => {
    const tip = staffingTooltip(day({ closed: true, coverageStatus: "ok", effectiveStaff: 0 }));
    expect(tip.startsWith("Geschlossen – keine Mindestbesetzung")).toBe(true);
    expect(tip).not.toContain("Unterbesetzt");
    expect(tip).not.toContain("Aufsicht fehlt");
    // Even a stale status field cannot make a closed day read red.
    const stale = staffingTooltip(
      day({ closed: true, coverageStatus: "under", unsupervisedAzubis: 1, hasSupervisor: false }),
    );
    expect(stale).not.toContain("Unterbesetzt");
    expect(stale).not.toContain("ohne Aufsicht");
  });

  it("an open day keeps its tooltip, with or without the closed field", () => {
    expect(staffingTooltip(day({ closed: false }))).toContain("2 von 3 besetzt");
    expect(staffingTooltip(day({ closed: false }))).toContain("Unterbesetzt");
    expect(staffingTooltip(day())).toContain("Unterbesetzt");
  });

  it("the explanation names contract workdays, the shift-only models and the closed day", () => {
    expect(STAFFING_EXPLANATION).toContain("laut Vertrag");
    expect(STAFFING_EXPLANATION).toContain("Nach Schichtplan");
    expect(STAFFING_EXPLANATION).toContain("Monatsstunden");
    expect(STAFFING_EXPLANATION).toContain("geschlossenen Tagen gibt es keine Mindestbesetzung");
  });
});
