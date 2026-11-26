// Issue #991 N-08 / N-07 — the shell and the Ich area set no capitals and no letter-spacing, and
// the rail mark starts at the same left edge as the area headings and the item icons.
//
// D-842-12 says "no capitals, no letter-spacing", but until now it was guarded only for app.css
// (design-guards-842) and for Verwalten (section-titles-854). The shell and the employee's own area
// kept leftover capital-letter labels ("ICH" in the avatar menu, "NEUE FUNKTIONEN" in What's New,
// the Mehr sheet headings, the saldo card kickers ...). This guard parses the real <style> blocks of
// a walked set of files; there is no exception list.

import { describe, expect, it } from "vitest";
import postcss from "postcss";

import {
  SRC_ROOT,
  svelteStyleBlocks,
  titleStyleViolations,
  walkFiles,
  type SourceFile,
} from "./design-source-files";

const ALL = walkFiles(SRC_ROOT, [".svelte"], { includeTests: false });

const COMPONENT_DIRS = [
  "layout",
  "availability",
  "dashboard",
  "leave",
  "me",
  "saldo",
  "settings",
  "time-entries",
].map((dir) => `lib/components/${dir}/`);
const ROUTE_DIRS = ["dashboard", "time-entries", "leave", "availability", "ich", "settings"].map(
  (dir) => `routes/(app)/${dir}/`,
);
const SINGLE_FILES = [
  "lib/components/ui/CommandPalette.svelte",
  "lib/components/ui/MonthBar.svelte",
];

function walkedFiles(): SourceFile[] {
  return ALL.filter(
    (file) =>
      COMPONENT_DIRS.some((dir) => file.rel.startsWith(dir)) ||
      ROUTE_DIRS.some((dir) => file.rel.startsWith(dir)) ||
      SINGLE_FILES.includes(file.rel),
  );
}

const WALKED = walkedFiles();

describe("no capitals and no letter-spacing in the shell and the Ich area (N-08, D-991-04)", () => {
  it("walks at least 60 files and names the Topbar and the two single ui files", () => {
    expect(WALKED.length).toBeGreaterThanOrEqual(60);
    const rels = WALKED.map((file) => file.rel);
    expect(rels).toContain("lib/components/layout/Topbar.svelte");
    for (const rel of SINGLE_FILES) expect(rels, rel).toContain(rel);
  });

  it("reads real style blocks (at least 30 of the walked files carry one)", () => {
    const withStyle = WALKED.filter((file) => svelteStyleBlocks(file.text).length > 0);
    expect(withStyle.length).toBeGreaterThanOrEqual(30);
  });

  it("control: an uppercase, letter-spaced rule is flagged twice, a plain one is clean", () => {
    expect(titleStyleViolations(".x{text-transform:uppercase;letter-spacing:.08em}")).toHaveLength(
      2,
    );
    expect(titleStyleViolations(".x{letter-spacing:0;text-transform:none}")).toEqual([]);
  });

  for (const file of WALKED) {
    it(`${file.rel}: no uppercase / capitalize and no letter-spacing`, () => {
      expect(svelteStyleBlocks(file.text).flatMap(titleStyleViolations)).toEqual([]);
    });
  }
});

/** The `padding` of the first rule whose selector is exactly `selector`, as a four-value tuple. */
function paddingOf(css: string, selector: string): [string, string, string, string] {
  let found: string | null = null;
  postcss.parse(css).walkRules((rule) => {
    if (found !== null || rule.parent?.type !== "root") return;
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls("padding", (decl) => {
      found ??= decl.value;
    });
  });
  if (found === null) throw new Error(`no padding on ${selector}`);
  const parts = (found as string).trim().split(/\s+/);
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left];
}

function declOf(css: string, selector: string, prop: string): string | null {
  let value: string | null = null;
  postcss.parse(css).walkRules((rule) => {
    if (value !== null || rule.parent?.type !== "root") return;
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(prop, (decl) => {
      value ??= decl.value.trim();
    });
  });
  return value;
}

const px = (value: string) => Number.parseFloat(value);

/** The rail-edge rule: the mark is left-aligned and its edge equals the heading and icon edge. */
function railEdgeViolations(css: string): string[] {
  const hits: string[] = [];
  const justify = declOf(css, ".sidebar-brand", "justify-content");
  if (justify !== "flex-start") hits.push(`.sidebar-brand justify-content is ${justify}`);
  const brand = px(paddingOf(css, ".sidebar-brand")[3]);
  const label = px(paddingOf(css, ".sidebar-section-label")[3]);
  const icon = px(paddingOf(css, ".sidebar-nav")[3]) + px(paddingOf(css, ".nav-item")[3]);
  if (brand !== label) hits.push(`mark edge ${brand}px differs from heading edge ${label}px`);
  if (label !== icon) hits.push(`heading edge ${label}px differs from icon edge ${icon}px`);
  return hits;
}

describe("the rail mark shares the 18 px edge of the area headings and the item icons (N-07, D-991-05)", () => {
  const sidebar = ALL.find((file) => file.rel === "lib/components/layout/Sidebar.svelte");
  const css = sidebar ? svelteStyleBlocks(sidebar.text).join("\n") : "";

  it("Sidebar.svelte is found and carries its style", () => {
    expect(sidebar).toBeDefined();
    expect(css).toContain(".sidebar-brand");
  });

  it("the mark, the headings and the icons all start at 18 px", () => {
    expect(railEdgeViolations(css)).toEqual([]);
    expect(px(paddingOf(css, ".sidebar-brand")[3])).toBe(18);
  });

  it("control: a centred mark or a different edge is flagged", () => {
    const centred = css.replace(
      /(\.sidebar-brand,[\s\S]*?justify-content:\s*)flex-start/,
      "$1center",
    );
    expect(centred).not.toBe(css);
    expect(railEdgeViolations(centred)).toHaveLength(1);
    const shifted = css.replace("padding: 20px 18px 8px;", "padding: 20px 12px 8px;");
    expect(shifted).not.toBe(css);
    expect(railEdgeViolations(shifted).length).toBeGreaterThan(0);
  });
});
