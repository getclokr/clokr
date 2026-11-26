// Issue #992 (N-11, N-12, N-21; D-992-19, D-992-20, D-992-21) — the four Dienstplan tabs share ONE head at
// the top level of the page, and the Woche page speaks plain German. Source pins: the pages cannot mount
// without `$app`, so the files are read (comments included — a removed literal is never quoted here).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(`src/${rel}`, "utf8");

const PAGES = {
  woche: "routes/(app)/shifts/+page.svelte",
  bedarf: "routes/(app)/shifts/planning/+page.svelte",
  hinweise: "routes/(app)/shifts/conflicts/+page.svelte",
  verfuegbarkeit: "routes/(app)/admin/availability/+page.svelte",
} as const;

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the four Dienstplan tabs share one head (D-992-20)", () => {
  for (const [name, file] of Object.entries(PAGES)) {
    const text = read(file);

    it(`${name} renders exactly one RosterHead and no head parts of its own`, () => {
      expect(count(text, "<RosterHead")).toBe(1);
      expect(text).not.toContain("<PageHead");
      expect(text).not.toContain("<PageTabs");
    });

    it(`${name} places the RosterHead at the top level, outside .page`, () => {
      const head = text.indexOf("<RosterHead");
      const before = text.slice(0, head);
      // Every `<div class="page"` opened before the head must be closed again before it.
      const opened = count(before, 'class="page"');
      expect(opened).toBe(0);
    });
  }

  it("Bedarf puts the salon scope label below the tabs", () => {
    const text = read(PAGES.bedarf);
    expect(text.indexOf("<SalonScopeLabel")).toBeGreaterThan(text.indexOf("<RosterHead"));
  });

  it("the RosterHead renders the head and the tab row and nothing else", () => {
    const text = read("lib/components/team/RosterHead.svelte");
    expect(text).toContain("<PageHead");
    expect(text).toContain("<PageTabs");
    expect(text).toContain('tabsLabel="Dienstplan"');
    expect(text).not.toMatch(/margin|padding/);
  });
});

describe("the Bedarf columns read as words, the figures as days (D-992-20)", () => {
  const text = read(PAGES.bedarf);

  it("names the columns", () => {
    expect(text).toContain('label: "Noch einzuplanen"');
    expect(text).toContain('label: "Geplant"');
    expect(text).toContain('label: "Differenz"');
    expect(text).not.toContain('label: "noch einzuplanen"');
    expect(text).not.toContain('label: "geplant"');
  });

  it("prints planned and difference through the one day-figure helpers", () => {
    expect(text).toContain("plannedLabel(");
    expect(text).toContain("differenceLabel(");
  });
});

describe("the Woche page speaks plain German (D-992-19, D-992-21)", () => {
  const text = read(PAGES.woche);

  it("no eyebrow names the planning context any other way than Dienstplan", () => {
    expect(text).not.toContain('eyebrow="Schichtplanung"');
    expect(count(text, 'eyebrow="Dienstplan"')).toBeGreaterThanOrEqual(3);
  });

  it("has no placeholder plural and no slash plural", () => {
    expect(text).not.toContain("Schicht(en)");
    expect(text).not.toMatch(/Eintrag\/Einträge/);
  });

  it("offers „Ohne Vorlage“, not a custom entry", () => {
    expect(text).not.toContain("Benutzerdefiniert");
    expect(text).toContain("Ohne Vorlage");
  });

  it("shows no raw exception text in the copy, generate and assign flows", () => {
    expect(text).not.toMatch(/e instanceof Error \? e\.message/);
    expect(text).not.toMatch(/err instanceof Error \? err\.message/);
    expect(text).not.toContain("Vorschau wird erstellt");
    expect(text).toContain("rosterRequestError(");
  });

  it("names days through the one date helper, not as ISO text", () => {
    expect(text).toContain("dayLabel(");
    expect(text).not.toContain("copyDiff.sourceWeekStart}</strong>");
  });

  it("hides the template strip on a phone, where drag and drop does not exist", () => {
    const strip = text.indexOf('class="sp-templates"');
    expect(strip).toBeGreaterThan(-1);
    expect(text).toMatch(/\.sp-templates\s*\{\s*display:\s*none/);
  });

  it("colours the phone day dot with the same tone as the desktop cell", () => {
    expect(text).toContain("staffingTone(");
    expect(text).toContain('.sp-daydot[data-tone="bad"]');
    expect(text).toContain('.sp-daydot[data-tone="warn"]');
  });
});
