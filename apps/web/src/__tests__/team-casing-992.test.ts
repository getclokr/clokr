// Issue #992 (D-992-26) — the Team area sets no capitals and no letter-spacing either. #991 guarded the
// shell and the Ich area (`ich-casing-991.test.ts`); the 16.11. retest still saw a capital-letter label
// („SOLL-STATUS“) in the Team area. This guard parses the real <style> blocks of a walked set of files;
// there is no exception list.

import { describe, expect, it } from "vitest";

import {
  SRC_ROOT,
  svelteStyleBlocks,
  titleStyleViolations,
  walkFiles,
  type SourceFile,
} from "./design-source-files";

const ALL = walkFiles(SRC_ROOT, [".svelte"], { includeTests: false });

const ROUTE_DIRS = ["team", "inbox", "shifts", "reports", "admin/availability"].map(
  (dir) => `routes/(app)/${dir}/`,
);
const COMPONENT_DIRS = ["team", "reports"].map((dir) => `lib/components/${dir}/`);
const SINGLE_FILES = ["lib/components/employees/PersonenTable.svelte"];

const WALKED: SourceFile[] = ALL.filter(
  (file) =>
    ROUTE_DIRS.some((dir) => file.rel.startsWith(dir)) ||
    COMPONENT_DIRS.some((dir) => file.rel.startsWith(dir)) ||
    SINGLE_FILES.includes(file.rel),
);

describe("no capitals and no letter-spacing in the Team area (D-992-26)", () => {
  it("walks at least 25 files and names the roster page and the single component", () => {
    expect(WALKED.length).toBeGreaterThanOrEqual(25);
    const rels = WALKED.map((file) => file.rel);
    expect(rels).toContain("routes/(app)/shifts/+page.svelte");
    for (const rel of SINGLE_FILES) expect(rels, rel).toContain(rel);
  });

  it("reads real style blocks (at least 15 of the walked files carry one)", () => {
    const withStyle = WALKED.filter((file) => svelteStyleBlocks(file.text).length > 0);
    expect(withStyle.length).toBeGreaterThanOrEqual(15);
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
