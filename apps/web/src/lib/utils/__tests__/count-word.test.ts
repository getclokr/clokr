import { describe, expect, it } from "vitest";
import { countWord, monthsLabel, personsLabel } from "../count-word";

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
});
