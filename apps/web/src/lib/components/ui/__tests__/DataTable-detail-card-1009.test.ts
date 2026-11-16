import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #1009: in the narrow card layout an expanded row's detail cell is no labelled cell — it
// spans the card's full width, starts left and prints no label column. Before, the days of an
// expanded Konto month sat in the right half of the screen.
const SRC = readFileSync(resolve(__dirname, "../DataTable.svelte"), "utf8");

function cardBlock(): string {
  const start = SRC.indexOf("@container (max-width: 759.98px)");
  expect(start, "the card-mode container query exists").toBeGreaterThan(-1);
  return SRC.slice(start);
}

function rule(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`);
  expect(at, `rule ${selector} exists in card mode`).toBeGreaterThan(-1);
  return block.slice(at, block.indexOf("}", at));
}

describe("#1009 — the detail cell in card mode", () => {
  it("is a full-width block, left-aligned", () => {
    const r = rule(cardBlock(), ".dt-table td.dt-detail-cell");
    expect(r).toMatch(/display:\s*block/);
    expect(r).toMatch(/text-align:\s*start/);
  });

  it("prints no label column", () => {
    expect(rule(cardBlock(), ".dt-table td.dt-detail-cell::before")).toMatch(/content:\s*none/);
  });

  it("comes after the generic cell rules it overrides", () => {
    const block = cardBlock();
    expect(block.indexOf(".dt-table td.dt-detail-cell {")).toBeGreaterThan(
      block.indexOf(".dt-table td {"),
    );
  });
});
