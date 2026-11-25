// Issue #1075 — the preview labels of a skipped cell in "Muster anwenden" and "Woche kopieren".
import { describe, it, expect } from "vitest";
import { copySkipLabel, generateSkipLabel, type RosterSkipReason } from "../roster-skip-reasons";

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

  it("keeps the old copy labels and prefixes the new ones the same way", () => {
    expect(copySkipLabel("leave")).toBe("Übersprungen — Urlaub");
    expect(copySkipLabel("absence")).toBe("Übersprungen — Krankheit");
    expect(copySkipLabel("existing")).toBe("Übersprungen — Schicht existiert bereits");
    expect(copySkipLabel("availability-unavailable")).toBe("Übersprungen — nicht verfügbar");
    expect(copySkipLabel("jarbschg")).toBe("Übersprungen — Jugendarbeitsschutz");
    expect(copySkipLabel("past")).toBe("Übersprungen — vergangener Tag");
    expect(copySkipLabel("no-contract")).toBe("Übersprungen — kein Vertrag");
    expect(copySkipLabel("outside-store-hours")).toBe(
      "Übersprungen — außerhalb der Öffnungszeiten",
    );
    expect(copySkipLabel("arbzg-daily-max")).toBe("Übersprungen — über 10 Stunden am Tag");
    expect(copySkipLabel("arbzg-rest-period")).toBe("Übersprungen — Ruhezeit unter 11 Stunden");
  });

  it("an unknown reason keeps the old defaults", () => {
    const unknown = "something-new" as RosterSkipReason;
    expect(generateSkipLabel(unknown)).toBe("Kein Muster");
    expect(copySkipLabel(unknown)).toBe("Übersprungen");
  });
});
