// Issue #992 (N-05, N-21, N-07; D-992-10..12, D-992-26) - source pins of Team › Zeiten.
//
// The page cannot be mounted here (`$app/*`, about fifteen requests on mount; see
// team-salon-view-85.test.ts), so the wiring is proven by reading the source: the address helpers are
// used where person, month, day and mode change, `eintragen=1` opens the dialog only with the create
// right, hours never wrap and the phone cell drops the unit, and the page style has no capitals.
import { describe, expect, it } from "vitest";

import { svelteStyleBlocks, titleStyleViolations } from "./design-source-files";
import source from "../routes/(app)/team/time-entries/+page.svelte?raw";

const PAGE: string = source;

/** The body of `function <name>(` up to the next top-level function or section comment. */
function functionBody(name: string): string {
  const start = PAGE.search(new RegExp(`(?:async )?function ${name}\\(`));
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.search(/\n {2}(?:async )?function |\n {2}\/\/ ──/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("Team › Zeiten keeps person and day in the address (#992 N-05)", () => {
  it("[vacuity gate] the page source is loaded and is the Zeiten page", () => {
    expect(PAGE.length).toBeGreaterThan(20000);
    expect(PAGE).toContain('title={pageLabel("/team/time-entries")}');
  });

  it("the address is written only through teamZeitenSearch and replaceState", () => {
    const sync = functionBody("syncAddress");
    expect(sync).toContain("teamZeitenSearch(");
    expect(sync).toContain("replaceState(");
    expect(PAGE).toMatch(/import \{ goto, replaceState \} from "\$app\/navigation"/);
    expect(PAGE.match(/replaceState\(/g)).toHaveLength(1);
  });

  it("choosing a person, moving the month and switching the mode write the address", () => {
    for (const name of [
      "selectEmployee",
      "gotoMonth",
      "gotoMonthYear",
      "gotoToday",
      "setTeamMode",
    ]) {
      expect(functionBody(name), name).toContain("syncAddress()");
    }
  });
});

describe("eintragen=1 (#992 N-07, D-992-12)", () => {
  it("opens the add dialog only with the create right, checked before anything opens", () => {
    const gate = PAGE.indexOf('hasPermission($authStore.user, "time-entry:create:ZUGEWIESEN")');
    expect(gate).toBeGreaterThan(-1);
    const use = PAGE.indexOf("if (addOnLoad && teamMode");
    expect(use).toBeGreaterThan(-1);
    // `addOnLoad` is defined from the permission check, and nothing opens the dialog before it.
    const definition = PAGE.indexOf("const addOnLoad");
    expect(definition).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(definition);
    expect(definition).toBeLessThan(use);
    expect(PAGE).toContain("addOnArrival(page.url.searchParams)");
  });

  it("opens the dialog after the choice and clears the flag first (never survives a second choice)", () => {
    const pick = functionBody("pickEmployee");
    expect(pick).toContain("const addNow = addAfterPick;");
    expect(pick.indexOf("addAfterPick = false")).toBeLessThan(pick.indexOf("selectEmployee("));
    expect(pick).toContain("if (addNow) openAdd(todayStr);");
  });

  it("shows the line under the picker and focuses it", () => {
    expect(PAGE).toContain("Wähle eine Person, um ihre Zeit einzutragen.");
    expect(PAGE).toContain("bind:this={pickerHost}");
    expect(functionBody("focusPicker")).toContain('querySelector("input")');
  });
});

describe("hours never wrap, the phone shows 8:00 (#992 N-21, D-992-11)", () => {
  const css = svelteStyleBlocks(PAGE).join("\n");

  it("the hours span is nowrap", () => {
    expect(css).toMatch(/\.day-worked\s*\{[^}]*white-space:\s*nowrap/);
  });

  it("the unit sits in its own span, hidden inside the phone block, kept in the cell title", () => {
    expect(PAGE).toContain('<span class="day-unit">&thinsp;h</span>');
    const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(phone).toMatch(/\.day-unit\s*\{\s*display:\s*none/);
    expect(PAGE).toMatch(/`\$\{fmtMin\(day\.workedMin\)\} h`/);
  });
});

describe("no capitals in the page style (#992 D-992-26)", () => {
  it("has no text-transform uppercase/capitalize and no letter-spacing", () => {
    const css = svelteStyleBlocks(PAGE).join("\n");
    expect(css.length).toBeGreaterThan(2000);
    expect(titleStyleViolations(css)).toEqual([]);
    // Control: the matcher fires on both forms.
    expect(
      titleStyleViolations(".x { text-transform: uppercase; letter-spacing: 0.04em }"),
    ).toHaveLength(2);
    expect(titleStyleViolations(".x { text-transform: none; letter-spacing: 0 }")).toEqual([]);
  });
});
