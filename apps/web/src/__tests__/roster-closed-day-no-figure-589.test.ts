import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #589 (owner 16.11.2026): a closed day of the roster shows no staffing figure, so a grey
// "0 / 2" can never be read as a shortfall. Pinned on the page's staffing snippet.
const PAGE = readFileSync(resolve(__dirname, "../routes/(app)/shifts/+page.svelte"), "utf8");

describe("#589 — closed days carry no staffing figure", () => {
  it("renders the bar and the x / y figure only when the day is open", () => {
    const start = PAGE.indexOf("{#snippet staffing(");
    expect(start, "the staffing snippet exists").toBeGreaterThan(-1);
    const body = PAGE.slice(start, PAGE.indexOf("{/snippet}", start));
    const guard = body.indexOf("{#if closed}");
    const figure = body.indexOf('data-testid="staffing-figure"');
    const elseBranch = body.indexOf("{:else}", guard);
    expect(guard, "a closed branch exists").toBeGreaterThan(-1);
    expect(figure, "the figure is rendered").toBeGreaterThan(-1);
    expect(
      figure > elseBranch && elseBranch > guard,
      "the figure sits in the open-day branch",
    ).toBe(true);
    expect(body.slice(guard, elseBranch)).not.toContain("staffingFigure(");
  });
});
