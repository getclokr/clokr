// Issue #854 (plan 854-07) - source pins of Regeln › Arbeitszeit & Verträge. The page cannot be mounted
// here (no `$app` alias), so, like admin-system-save-wiring, this reads the sources:
//  - the page registers ONE unsaved id, gated on the loaded baseline, and shows every section only
//    under `mayOpenSection` of its registry section (D-854-05);
//  - every section of the page is rendered by a component that the page imports and that sends its
//    PUT only as `pickSection(…, settingsSection("<its id>").keys)` or a literal inside its section;
//  - no text/number input of those components writes inline (D-02, docs/ADMIN_STRUCTURE.md §3.2.1).
// The key-level rules (one place per key, keys known to the API schema, every key sent) are
// settings-pages-854.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARBEITSZEIT_TAB_ALIASES,
  ARBEITSZEIT_TABS,
  visibleArbeitszeitTabs,
} from "$lib/settings/arbeitszeit-tabs";
import { SETTINGS_SECTIONS, sectionsOfPage } from "$lib/settings/settings-pages";

import { SRC_ROOT } from "./design-source-files";

const PAGE_HREF = "/verwalten/regeln/arbeitszeit";
const PAGE_REL = "routes/(app)/verwalten/regeln/arbeitszeit/+page.svelte";
const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");
const PAGE = read(PAGE_REL);
const SECTIONS = sectionsOfPage(PAGE_HREF);
const TABS = ARBEITSZEIT_TABS;

describe("the Arbeitszeit page", () => {
  it("has its sections registered (not vacuous)", () => {
    expect(SECTIONS.length).toBeGreaterThanOrEqual(5);
    for (const section of SECTIONS) expect(section.id).toMatch(/^arbeitszeit-/);
  });

  it("registers one unsaved id, gated on the loaded baseline, and cleans it up", () => {
    expect(PAGE.match(/markUnsaved\("/g)?.length).toBe(2);
    expect(PAGE).toContain('markUnsaved("regeln-arbeitszeit", snapshotsReady && totalChanges > 0)');
    expect(PAGE).toContain('return () => markUnsaved("regeln-arbeitszeit", false)');
  });

  it.each(SECTIONS.map((s) => [s.id, s] as const))(
    "%s: shown only under mayOpenSection, rendered by an imported component",
    (id, section) => {
      // Issue #951: the sections sit in tabs (arbeitszeit-tabs.ts) and each is still gated on its own.
      expect(TABS.some((tab) => tab.sections.includes(id))).toBe(true);
      expect(PAGE).toContain(`mayOpenSection(user, settingsSection("${id}"))`);
      const component = section.renderedBy.split("/").at(-1)!.replace(".svelte", "");
      expect(PAGE).toContain(`import ${component} from`);
      expect(PAGE).toMatch(new RegExp(`<${component}\\s`));
    },
  );

  it("groups every section into exactly one tab, a tab offered when one of its sections is (Issue #951)", () => {
    expect(TABS.flatMap((tab) => tab.sections).sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    const holder = (permissions: string[]) => visibleArbeitszeitTabs({ permissions });
    expect(holder([])).toEqual([]);
    expect(holder(["tenant-settings:update:ZUGEWIESEN"]).length).toBe(TABS.length);
    expect(TABS.length).toBe(5);
    // every old per-section hash still lands on the tab that holds its section
    for (const [hash, tab] of Object.entries(ARBEITSZEIT_TAB_ALIASES))
      expect(TABS.find((t) => t.value === tab)?.sections.length, hash).toBeGreaterThan(1);
    // the Urlaub page alternative opens only the sections that came from the Urlaub page
    expect(holder(["leave-config:manage:ZUGEWIESEN"]).length).toBeGreaterThan(0);
    expect(holder(["leave-config:manage:ZUGEWIESEN"]).length).toBeLessThan(TABS.length);
  });

  it("sums the section counts into one registration", () => {
    expect(PAGE).toContain("const totalChanges = $derived(");
    expect(PAGE.match(/bind:changes=\{changes\./g)?.length).toBe(SECTIONS.length);
  });
});

describe("the section components", () => {
  const files = [...new Set(SECTIONS.map((s) => s.renderedBy))];

  it.each(files)("%s sends its PUT only as its own section", (rel) => {
    const source = read(rel);
    const puts = [...source.matchAll(/api\.put(?:<[^()]*>)?\(\s*"([^"]+)",/g)];
    expect(puts.length).toBeGreaterThanOrEqual(1);
    const mine = SETTINGS_SECTIONS.filter((s) => s.renderedBy === rel).map((s) => s.id);
    for (const match of puts) {
      const rest = source.slice(match.index!, match.index! + 400);
      const picked = /settingsSection\(\s*"([^"]+)"\s*\)\.keys/.exec(rest)?.[1];
      expect(
        picked,
        `${rel}: a PUT that is not pickSection(…, settingsSection(id).keys)`,
      ).toBeDefined();
      expect(mine).toContain(picked);
    }
    // No spread of a whole configuration.
    expect(source).not.toMatch(/api\.put\([^)]*\.\.\./);
  });

  it.each(files)("%s: no text/number input writes inline (D-02)", (rel) => {
    const source = read(rel);
    for (const tag of source.match(/<input\b[\s\S]*?>/g) ?? []) {
      const type = tag.match(/type="([a-z]+)"/)?.[1];
      if (type !== "number" && type !== "text") continue;
      expect(tag).not.toMatch(/\bon(?:blur|change|input)=/);
    }
  });
});
