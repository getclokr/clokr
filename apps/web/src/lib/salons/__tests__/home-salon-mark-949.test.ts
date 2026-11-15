// Issue #949 - the one wording of a person whose Stammsalon is not one of the reader's salons.
import { describe, expect, it } from "vitest";
import { homeSalonMark, NO_HOME_SALON_FILTER } from "../home-salon-mark";

const VIEW = new Set(["nord"]);

describe("homeSalonMark (#949)", () => {
  it("names a Springer homed outside the reader's salons", () => {
    expect(homeSalonMark("demo", VIEW, true)).toMatchObject({
      kind: "ELSEWHERE",
      label: "Anderer Stammsalon",
    });
  });

  it("names a person without any Stammsalon", () => {
    expect(homeSalonMark(null, VIEW, true)).toMatchObject({
      kind: "NONE",
      label: "Ohne Stammsalon",
    });
  });

  it("says nothing for a person homed in one of the reader's salons", () => {
    expect(homeSalonMark("nord", VIEW, true)).toBeNull();
  });

  it("says nothing while the field was not loaded", () => {
    expect(homeSalonMark(undefined, VIEW, true)).toBeNull();
  });

  it("says nothing in a single-salon tenant", () => {
    expect(homeSalonMark("demo", VIEW, false)).toBeNull();
    expect(homeSalonMark(null, VIEW, false)).toBeNull();
  });

  it("accepts the salon-name map of the person pages as the view", () => {
    expect(homeSalonMark("nord", new Map([["nord", "Nord"]]), true)).toBeNull();
  });

  it("uses a filter value that can never be a salon id", () => {
    expect(NO_HOME_SALON_FILTER).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("short labels for narrow cells (#949)", () => {
  it("names both cases in a few characters", () => {
    expect(homeSalonMark("demo", VIEW, true)?.shortLabel).toBe("Einsatz");
    expect(homeSalonMark(null, VIEW, true)?.shortLabel).toBe("Ohne Salon");
  });
});
