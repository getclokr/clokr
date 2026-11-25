// Issue #606 - the one wording module: every id has a text, everything addresses the reader with du and
// the legal anchors of the draft are present (owner wording review in the PR).
import { describe, expect, it } from "vitest";
import {
  COVERAGE_TEXT,
  PROGRAMS_TEXT,
  PURPOSE_TEXT,
  READERS_ANCHOR_HREF,
  READERS_TEXT,
  WHY_CLOCK_TEXT,
  purposeLine,
} from "../time-transparency";

function allTexts(): string[] {
  const collect = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(collect)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(collect)
          : [];
  return [
    ...collect(COVERAGE_TEXT),
    ...collect(PURPOSE_TEXT),
    ...collect(READERS_TEXT),
    ...collect(PROGRAMS_TEXT),
    ...collect(WHY_CLOCK_TEXT),
  ];
}

describe("time-transparency wording (Issue #606)", () => {
  it("has a text for every coverage and purpose id the server can send", () => {
    expect(Object.keys(COVERAGE_TEXT).sort()).toEqual([
      "homeSalon",
      "person",
      "wholeTenant",
      "workSalon",
    ]);
    expect(Object.keys(PURPOSE_TEXT).sort()).toEqual(["hours", "payroll", "protection"]);
    for (const text of [...Object.values(COVERAGE_TEXT), ...Object.values(PURPOSE_TEXT)]) {
      expect(text.length).toBeGreaterThan(3);
    }
  });

  it("joins the purposes as a German list", () => {
    expect(purposeLine(["protection"])).toBe("Zweck: Arbeitsschutz");
    expect(purposeLine(["hours", "protection"])).toBe("Zweck: Stundenkonto und Arbeitsschutz");
    expect(purposeLine(["hours", "payroll", "protection"])).toBe(
      "Zweck: Stundenkonto, Lohnabrechnung und Arbeitsschutz",
    );
    expect(purposeLine([])).toBe("");
  });

  it("addresses the reader with du, never with Sie, Ihnen or Ihr", () => {
    const texts = allTexts();
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) {
      expect(text, text).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre|Ihrer|Ihres|Ihrem|Ihren)\b/);
    }
  });

  it("names the legal anchors of the three points and of the profile footnote", () => {
    const first = WHY_CLOCK_TEXT.points[0].text;
    expect(first).toContain("C-55/18");
    expect(first).toContain("1 ABR 22/21");
    expect(first).toContain("§ 3 Abs. 2 Nr. 1 ArbSchG");
    expect(first).toContain("§ 16 Abs. 2 ArbZG");
    expect(WHY_CLOCK_TEXT.points[1].text).toContain("§§ 3 bis 5 ArbZG");
    expect(WHY_CLOCK_TEXT.points).toHaveLength(3);
    expect(WHY_CLOCK_TEXT.legalBasis).toContain("Art. 6 Abs. 1 lit. b und c DSGVO");
    expect(WHY_CLOCK_TEXT.legalBasis).toContain("§ 26 Abs. 1 BDSG");
  });

  it("points the footer at the profile section", () => {
    expect(READERS_ANCHOR_HREF).toBe("/ich/profil#wer-sieht-meine-zeiten");
    expect(WHY_CLOCK_TEXT.footerLinkLabel).toContain(READERS_TEXT.title);
  });
});
