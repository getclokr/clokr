import { describe, expect, it } from "vitest";
import { countNoun, countWord, monthsLabel, personsLabel } from "../count-word";

describe("countWord (Issue #946)", () => {
  it("uses the singular exactly for 1", () => {
    expect(monthsLabel(1)).toBe("1 Monat");
    expect(personsLabel(1)).toBe("1 Person");
  });
  it("uses the plural for 0 and for more than one", () => {
    expect(monthsLabel(0)).toBe("0 Monate");
    expect(monthsLabel(2)).toBe("2 Monate");
    expect(personsLabel(5)).toBe("5 Personen");
    expect(countWord(3, "Tag", "Tage")).toBe("3 Tage");
  });
  it("countNoun gives the noun alone, for a KPI unit next to its figure (Issue #1114)", () => {
    expect(countNoun(1, "Monat", "Monate")).toBe("Monat");
    expect(countNoun(0, "Monat", "Monate")).toBe("Monate");
    expect(countNoun(2, "Monat", "Monate")).toBe("Monate");
  });
});
