// Issue #994 (N-30, D-994-13) — the "!" on a shift is explained: the legend key is the same disc, the
// tooltip and the screen-reader text name the approved absence (also on a past day), and the fallback
// toasts say "Person". Source pins, because the page is too heavy to mount.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/(app)/shifts/+page.svelte", "utf8");

function fnBody(name: string): string {
  const start = page.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = page.indexOf("\n  // Issue #", start);
  return page.slice(start, next > start ? next : start + 1200);
}

describe("the roster explains its conflict mark (Issue #994, N-30)", () => {
  it("draws the mark glyph inside the legend key, hidden from assistive technology", () => {
    expect(page).toMatch(
      /<span class="sp-key sp-key--conflict" aria-hidden="true">!<\/span\s*>\s*\{ROSTER_LEGEND_PROBLEMS\.conflict\}/,
    );
  });

  it("looks like the mark on the shift: one declaration block for both", () => {
    expect(page).toMatch(/\.sp-mark,\s*\.sp-key--conflict\s*\{/);
  });

  it("checks the conflict before the past-day note in shiftTitle", () => {
    const body = fnBody("shiftTitle");
    const conflict = body.indexOf("if (s.conflictsWithLeave)");
    const past = body.indexOf("if (past)");
    expect(conflict).toBeGreaterThan(-1);
    expect(past).toBeGreaterThan(conflict);
    expect(body).toContain(
      "Konflikt mit einer genehmigten Abwesenheit – bitte prüfen oder entfernen",
    );
    expect(body).toContain(" · nur lesen");
  });

  it("names the absence in both screen-reader texts next to the mark", () => {
    const texts = page.match(
      /<span class="sr-only">Konflikt mit einer genehmigten Abwesenheit<\/span>/g,
    );
    expect(texts).toHaveLength(2);
    expect(page.match(/<span class="sp-mark" aria-hidden="true">!<\/span>/g)).toHaveLength(2);
  });

  it("says Person in the four fallback toasts and never Mitarbeiter", () => {
    expect(page).toContain("Die Person ist an diesem Tag nicht verfügbar.");
    expect(page).toContain("Die Person ist am Zieltag nicht verfügbar.");
    expect(page).toContain("Die Person hat an diesem Tag eine genehmigte Abwesenheit.");
    expect(page).toContain("Die Person hat am Zieltag eine genehmigte Abwesenheit.");
    expect(page).not.toMatch(/Mitarbeiter ist am/);
    expect(page).not.toMatch(/Mitarbeiter hat Urlaub/);
  });

  it("no longer carries the old tooltip, which named only Urlaub (negative control)", () => {
    expect(page).not.toContain("Konflikt mit Urlaub – bitte überprüfen oder entfernen");
    expect(page).not.toContain('<span class="sr-only">Konflikt mit Urlaub</span>');
  });
});
