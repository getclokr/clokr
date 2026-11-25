// Issue #1075 — the preview labels of a skipped cell in "Muster anwenden" and "Woche kopieren".
import { describe, it, expect } from "vitest";
import {
  copySkipLabel,
  generateSkipLabel,
  sortSkips,
  type RosterSkipReason,
} from "../roster-skip-reasons";

describe("roster skip reasons (Issue #1075)", () => {
  it("keeps the old generate labels for the old reasons", () => {
    expect(generateSkipLabel("leave")).toBe("Urlaub");
    expect(generateSkipLabel("absence")).toBe("Abwesenheit");
    expect(generateSkipLabel("existing")).toBe("Schicht existiert");
    expect(generateSkipLabel("open-day")).toBe("Frei nach Muster");
    expect(generateSkipLabel("availability-unavailable")).toBe("Nicht verfügbar");
    expect(generateSkipLabel("jarbschg")).toBe("Jugendarbeitsschutz");
    expect(generateSkipLabel("no-pattern")).toBe("Kein Muster");
  });

  it("labels the six rule reasons of the shift write gate", () => {
    expect(generateSkipLabel("past")).toBe("Vergangener Tag");
    expect(generateSkipLabel("no-contract")).toBe("Kein Vertrag");
    expect(generateSkipLabel("outside-store-hours")).toBe("Außerhalb der Öffnungszeiten");
    expect(generateSkipLabel("arbzg-daily-max")).toBe("Über 10 Stunden am Tag");
    expect(generateSkipLabel("arbzg-rest-period")).toBe("Ruhezeit unter 11 Stunden");
  });

  it("copy uses the same short labels as generate (the heading already says „Übersprungen“)", () => {
    const reasons: RosterSkipReason[] = [
      "leave",
      "absence",
      "existing",
      "availability-unavailable",
      "jarbschg",
      "past",
      "no-contract",
      "outside-store-hours",
      "arbzg-daily-max",
      "arbzg-rest-period",
    ];
    for (const r of reasons) expect(copySkipLabel(r)).toBe(generateSkipLabel(r));
    expect(copySkipLabel("arbzg-rest-period")).toBe("Ruhezeit unter 11 Stunden");
    // copy never plans from a pattern: those reasons never read „Kein Muster“ there
    expect(copySkipLabel("no-pattern")).toBe("Übersprungen");
    expect(copySkipLabel("open-day")).toBe("Übersprungen");
  });

  it("lists rule reasons first and the nothing-to-plan reasons last, stable within a reason", () => {
    const skips = [
      { id: 1, reason: "no-pattern" as RosterSkipReason },
      { id: 2, reason: "arbzg-rest-period" as RosterSkipReason },
      { id: 3, reason: "leave" as RosterSkipReason },
      { id: 4, reason: "no-pattern" as RosterSkipReason },
      { id: 5, reason: "jarbschg" as RosterSkipReason },
      { id: 6, reason: "open-day" as RosterSkipReason },
    ];
    expect(sortSkips(skips).map((s) => s.id)).toEqual([5, 2, 3, 6, 1, 4]);
    // the input is not reordered in place
    expect(skips.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("an unknown reason keeps the old defaults", () => {
    const unknown = "something-new" as RosterSkipReason;
    expect(generateSkipLabel(unknown)).toBe("Kein Muster");
    expect(copySkipLabel(unknown)).toBe("Übersprungen");
  });
});
