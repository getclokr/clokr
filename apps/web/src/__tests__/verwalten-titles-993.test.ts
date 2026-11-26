// Issue #993 (U-04 of the 16.11. retest, D-993-11) - the person detail, the Salons list and the salon detail
// set a page title, so a screen reader and the browser tab no longer announce an untitled page. These pages
// need many GETs to mount, so the pins read the sources; the helper is proven on a positive and a negative
// control first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SRC_ROOT } from "./design-source-files";

/** The code of the page that decides the title: no comment, no script-only text. */
export function markupOf(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
}

/** The inner source of the `<title>` inside `<svelte:head>`, or null when the page sets none. */
export function titleSourceOf(text: string): string | null {
  const head = /<svelte:head[^>]*>([\s\S]*?)<\/svelte:head\s*>/.exec(markupOf(text));
  if (!head) return null;
  const title = /<title\s*>([\s\S]*?)<\/title\s*>/.exec(head[1]);
  return title ? title[1] : null;
}

const read = (rel: string) => readFileSync(join(SRC_ROOT, "routes/(app)/admin", rel), "utf8");

describe("titleSourceOf (controls)", () => {
  it("finds the title of a page that sets one", () => {
    expect(titleSourceOf("<svelte:head><title>{a} – Clokr</title></svelte:head>\n<div/>")).toBe(
      "{a} – Clokr",
    );
  });

  it("returns null for a page without a title, and ignores a title that only sits in a comment", () => {
    expect(titleSourceOf("<div>no head</div>")).toBeNull();
    expect(titleSourceOf("<!-- <svelte:head><title>x</title></svelte:head> --><div/>")).toBeNull();
  });
});

describe("Verwalten page titles (U-04, D-993-11)", () => {
  it("the person detail names the person and the Personen page", () => {
    const title = titleSourceOf(read("employees/[id]/+page.svelte"));
    expect(title).not.toBeNull();
    expect(title).toContain('displayName || "Person"');
    expect(title).toContain('pageLabel("/verwalten/personen")');
    expect(title).toContain("Clokr");
  });

  it("the Salons list carries the page label", () => {
    const title = titleSourceOf(read("salons/+page.svelte"));
    expect(title).not.toBeNull();
    expect(title).toContain('pageLabel("/admin/salons")');
    expect(title).toContain("Clokr");
  });

  it("the salon detail names the salon (or the create form) and the Salons label", () => {
    const text = read("salons/[id]/+page.svelte");
    const title = titleSourceOf(text);
    expect(title).not.toBeNull();
    expect(title).toContain("{pageTitle}");
    expect(title).toContain("Clokr");
    const derived = /const pageTitle = \$derived\(([\s\S]*?)\n {2}\);/.exec(markupOf(text));
    expect(derived?.[1]).toContain('"Neuer Salon"');
    expect(derived?.[1]).toContain("salon?.name");
    expect(derived?.[1]).toContain('pageLabel("/admin/salons")');
  });

  it("the person detail names a person, never „Mitarbeiter“, when it has no name or no record", () => {
    const text = markupOf(read("employees/[id]/+page.svelte"));
    expect(text).toContain('{loadError || "Person nicht gefunden."}');
    expect(text).not.toContain('"Mitarbeiter"');
    expect(text).not.toContain("Mitarbeiter nicht gefunden");
  });
});
