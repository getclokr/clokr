// Issue #992 — a dialog never gives its first focus to an InfoHint trigger (it would open the popover).
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "../Dialog.svelte"), "utf-8");

describe("Dialog first focus skips InfoHint triggers (Issue #992)", () => {
  it("falls back to the first tabbable control that is no .ih-trigger", () => {
    expect(SRC).toContain(
      'querySelector<HTMLElement>("[data-autofocus]") ?? firstTabbableExceptHint()',
    );
    const fn = SRC.slice(SRC.indexOf("function firstTabbableExceptHint"));
    expect(fn).toContain('el.classList.contains("ih-trigger")');
    expect(fn).toContain("continue;");
  });

  it("only steps in when the dialog holds an InfoHint, otherwise bits-ui keeps its choice", () => {
    const fn = SRC.slice(SRC.indexOf("function firstTabbableExceptHint"));
    expect(fn).toContain('if (!contentEl?.querySelector(".ih-trigger")) return null;');
  });
});
