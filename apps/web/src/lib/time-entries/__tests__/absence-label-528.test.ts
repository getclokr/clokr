import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEAVE_TYPES } from "$lib/leave/team-calendar-visibility";
import { OTHER_ABSENCE_LABEL, calendarAbsenceLabel } from "../absence-label";

// Issue #528: a calendar cell for an absence outside the old five-code map printed the raw enum
// code (EDUCATION, UNPAID, MATERNITY, PARENTAL). The cell now reads the mapping the absence pages
// use, and a code without a label reads „Sonstige Abwesenheit“, never an enum value.

describe("#528 — calendarAbsenceLabel", () => {
  it("gives every catalogue code the label of the absence pages", () => {
    for (const t of LEAVE_TYPES) expect(calendarAbsenceLabel(t.code)).toBe(t.label);
  });

  it("names the codes the cell used to print raw in German", () => {
    expect(calendarAbsenceLabel("EDUCATION")).toBe("Bildungsurlaub");
    expect(calendarAbsenceLabel("UNPAID")).toBe("Unbezahlter Urlaub");
    expect(calendarAbsenceLabel("MATERNITY")).toBe("Mutterschutz");
    expect(calendarAbsenceLabel("PARENTAL")).toBe("Elternzeit");
  });

  it("never returns an enum value: an unknown code reads „Sonstige Abwesenheit“", () => {
    expect(OTHER_ABSENCE_LABEL).toBe("Sonstige Abwesenheit");
    for (const code of ["SOMETHING_NEW", "", "vacation"]) {
      expect(calendarAbsenceLabel(code)).toBe("Sonstige Abwesenheit");
    }
  });

  it("never prints a code-shaped string for any catalogue code", () => {
    for (const t of LEAVE_TYPES) expect(calendarAbsenceLabel(t.code)).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("#528 — both calendars read the resolver", () => {
  const pages = {
    own: "../../../routes/(app)/time-entries/+page.svelte",
    team: "../../../routes/(app)/team/time-entries/+page.svelte",
  };

  for (const [name, rel] of Object.entries(pages)) {
    const src = readFileSync(resolve(__dirname, rel), "utf8");

    it(`${name}: cell, tooltip, sheet and phone row go through calendarAbsenceLabel`, () => {
      expect(src).toContain('from "$lib/time-entries/absence-label"');
      // The cell label span of the month grid.
      expect(src).toMatch(
        /<span class="cal-abs-type"\s*>\{calendarAbsenceLabel\(day\.absenceType\)\}/,
      );
      expect(src).toMatch(/day\.absenceType\s*\?\s*calendarAbsenceLabel\(day\.absenceType\)/);
    });

    it(`${name}: no private label map falls back to the raw code`, () => {
      expect(src).not.toMatch(/function absenceLabel\(/);
      expect(src).not.toMatch(/labels\[type\] \?\? type/);
      // The legend and the cell share the one fallback wording.
      expect(src).toContain("label: OTHER_ABSENCE_LABEL");
      expect(src).not.toContain('"Sonstige Abwesenheit"');
    });
  }
});
