// Issue #991 (N-15, D-991-13) — one dialog footer shape. The Dialog footer is right-aligned,
// secondary controls first, the primary (or danger) button last (Designkonzept §11). The scan walks
// every `{#snippet footer()}` of the production sources, states a floor and proves its matcher on
// in-memory controls, so a moved directory or a loosened regex turns it red instead of green.

import { describe, it, expect } from "vitest";
import postcss from "postcss";

import { SRC_ROOT, walkFiles } from "./design-source-files";

const SOURCES = walkFiles(SRC_ROOT, [".css", ".svelte"], { includeTests: false });
const APP_CSS = SOURCES.find((f) => f.rel === "app.css")!;
const SVELTE = SOURCES.filter((f) => f.rel.endsWith(".svelte"));

/** The body of every `{#snippet footer()}…{/snippet}` in a Svelte source. */
export function footerBodies(text: string): string[] {
  const bodies: string[] = [];
  const re = /\{#snippet footer\(\)\}([\s\S]*?)\{\/snippet\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) bodies.push(m[1]);
  return bodies;
}

const PRIMARY_RE = /class\s*=\s*["'{][^"'}]*\bbtn-(?:primary|danger)\b/g;
const CONTROL_RE = /<button\b|<a\b[^>]*class\s*=\s*["'][^"']*\bbtn\b/g;

/**
 * True when a control follows the last primary/danger button of a footer: a primary that is not
 * last. A footer without a primary button is clean.
 */
export function primaryIsNotLast(body: string): boolean {
  let lastPrimary = -1;
  let m: RegExpExecArray | null;
  const primary = new RegExp(PRIMARY_RE.source, "g");
  while ((m = primary.exec(body))) lastPrimary = m.index;
  if (lastPrimary < 0) return false;
  const control = new RegExp(CONTROL_RE.source, "g");
  while ((m = control.exec(body))) {
    // The button that carries the last primary class starts before the class attribute.
    if (m.index > lastPrimary) return true;
  }
  return false;
}

describe("Dialog footer — right-aligned (#991 N-15)", () => {
  it("app.css .modal-foot has justify-content: flex-end", () => {
    let found = false;
    postcss.parse(APP_CSS.text).walkRules(".modal-foot", (rule) => {
      rule.each((node) => {
        if (
          node.type === "decl" &&
          node.prop === "justify-content" &&
          node.value.trim() === "flex-end"
        ) {
          found = true;
        }
      });
    });
    expect(found).toBe(true);
  });
});

describe("Dialog footer — secondary first, primary last (#991 D-991-13)", () => {
  const footers = SVELTE.flatMap((f) => footerBodies(f.text).map((body) => ({ rel: f.rel, body })));

  it("finds the footers (floor)", () => {
    expect(footers.length).toBeGreaterThanOrEqual(45);
  });

  it("no footer has a control after its last primary/danger button", () => {
    const offenders = footers.filter((f) => primaryIsNotLast(f.body)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  describe("controls (the matcher flags what it should)", () => {
    it("flags „primary, then Abbrechen“", () => {
      const body = `
        <button class="btn btn-primary" type="submit">Speichern</button>
        <button class="btn btn-ghost" type="button">Abbrechen</button>`;
      expect(primaryIsNotLast(body)).toBe(true);
    });
    it("flags a danger button that is not last", () => {
      const body = `<button class="btn btn-danger">Löschen</button><a class="btn btn-ghost" href="/x">Mehr</a>`;
      expect(primaryIsNotLast(body)).toBe(true);
    });
    it("passes „Abbrechen, primary“", () => {
      const body = `
        <button class="btn btn-ghost" type="button">Abbrechen</button>
        <button class="btn btn-primary" type="submit">Speichern</button>`;
      expect(primaryIsNotLast(body)).toBe(false);
    });
    it("passes a footer with only one secondary button", () => {
      expect(primaryIsNotLast(`<button class="btn btn-ghost">Schließen</button>`)).toBe(false);
    });
    it("extracts a footer snippet body", () => {
      const src = `<Modal>{#snippet footer()}<button class="btn">A</button>{/snippet}</Modal>`;
      expect(footerBodies(src)).toEqual([`<button class="btn">A</button>`]);
    });
  });
});
