// Issue #993 (N-13, D-993-13) - one person list per reader. Whoever has Verwalten › Personen in the menu is
// taken there from /team/personen; the Salonleitung keeps the read list. The redirect target is
// `personListHref()`, so the proof is that decision for each persona (positive and negative control) plus a
// source pin that the page redirects before any request is sent.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { personListHref } from "$lib/nav/routes";
import personas from "$lib/nav/__tests__/fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const on = { availabilityEnabled: true };
// Every persona also holds the Mitarbeiter role.
const holder = (persona: string) => ({ permissions: [...P[persona], ...P.EMPLOYEE] });

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(here, "../routes/(app)/team/personen/+page.svelte"), "utf8");

describe("the person list a reader is sent to (#993 N-13)", () => {
  it("sends the Personalabteilung, the Inhaber and the Admin to Verwalten › Personen", () => {
    expect(personListHref(holder("HR"), on)).toBe("/verwalten/personen");
    expect(personListHref(holder("OWNER"), on)).toBe("/verwalten/personen");
    expect(personListHref(holder("ADMIN"), on)).toBe("/verwalten/personen");
  });

  it("keeps the Salonleitung on Team › Personen (negative control)", () => {
    expect(personListHref(holder("SALON_MANAGER"), on)).toBe("/team/personen");
  });
});

describe("Team › Personen page (#993 N-13)", () => {
  it("decides the redirect through personListHref and carries the query over with a replace", () => {
    expect(page).toContain("personListHref(");
    expect(page).toMatch(
      /goto\(\s*target\s*\+\s*page\.url\.search\s*,\s*\{\s*replace:\s*true\s*\}/,
    );
  });

  it("sends no request while a redirect target exists", () => {
    const start = page.indexOf("if (!contextLoaded) return;");
    expect(start).toBeGreaterThan(-1);
    const effect = page.slice(start);
    const guard = effect.indexOf("redirectTo !== null");
    const loadCall = effect.indexOf("void load()");
    expect(guard).toBeGreaterThan(-1);
    expect(loadCall).toBeGreaterThan(guard);
  });
});
