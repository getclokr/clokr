// Issue #992 (S-03, S-02; D-992-24, D-992-23) — two source pins of the shell: the rail's role line stays on
// one line with an ellipsis and carries its full text as a tooltip; the phone crumb swaps the plain page
// name for the qualified one in a phone-only span. Source reads: the components cannot be laid out in jsdom.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

import { svelteStyleBlocks } from "../../../../__tests__/design-source-files";

const read = (rel: string) => readFileSync(`src/lib/components/layout/${rel}`, "utf8");

/** The declarations of the top-level rules whose selector is exactly `selector` (media blocks are skipped). */
function declarationsOf(css: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type !== "root" || !rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => {
      found[decl.prop] ??= decl.value.trim();
    });
  });
  return found;
}

describe("the rail's role line (S-03, D-992-24)", () => {
  const sidebar = read("Sidebar.svelte");
  const css = svelteStyleBlocks(sidebar).join("\n");

  it("stays on one line and ends in an ellipsis", () => {
    const role = declarationsOf(css, ".userinfo .role");
    expect(role["white-space"]).toBe("nowrap");
    expect(role["overflow"]).toBe("hidden");
    expect(role["text-overflow"]).toBe("ellipsis");
  });

  it("carries the full text as its tooltip", () => {
    expect(sidebar).toMatch(/<div class="role" title=\{roleNamesLabel\(\$salonContext\)\}>/);
  });

  it("control: the name line above it already has the same three declarations", () => {
    const name = declarationsOf(css, ".userinfo .name");
    expect(name["white-space"]).toBe("nowrap");
    expect(name["text-overflow"]).toBe("ellipsis");
  });
});

describe("the phone crumb (S-02, D-992-23)", () => {
  const topbar = read("Topbar.svelte");
  const css = svelteStyleBlocks(topbar).join("\n");

  it("renders the qualified name next to the plain one", () => {
    expect(topbar).toContain("phoneCrumbLabel(");
    expect(topbar).toContain('class="topbar-crumb-plain"');
    expect(topbar).toContain('class="topbar-crumb-qualified"');
  });

  it("shows the qualified span only in the phone block", () => {
    expect(declarationsOf(css, ".topbar-crumb-qualified").display).toBe("none");
    const phone = css.slice(css.indexOf("@media (max-width: 759.98px)"));
    expect(phone).toMatch(/\.topbar-crumb-plain\s*\{\s*display:\s*none/);
    expect(phone).toMatch(/\.topbar-crumb-qualified\s*\{\s*display:\s*inline/);
  });
});
