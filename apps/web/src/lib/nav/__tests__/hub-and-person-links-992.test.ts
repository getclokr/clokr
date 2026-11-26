// Issue #992 (N-13 of 14.11., N-14; D-992-05, D-992-08) - two pure answers of the route table:
// what a hub row says it contains (only the children the reader sees) and which person list the reader has
// in her menu. Personas are the shared fixture; the Salonleitung also holds the Mitarbeiter role.
import { describe, expect, it } from "vitest";
import {
  hubRowDescription,
  personListHref,
  routeByKey,
  visibleChildren,
  type AppRoute,
} from "../routes";
import personas from "./fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const on = { availabilityEnabled: true };
const holder = (persona: string) => ({ permissions: P[persona] });
const salonleitung = { permissions: [...P.SALON_MANAGER, ...P.EMPLOYEE] };

const route = (href: string): AppRoute => {
  const found = routeByKey(href);
  if (found === null) throw new Error(`${href} is not in the route table`);
  return found;
};

describe("hubRowDescription (#992 N-13)", () => {
  it("returns the own description of a page entry", () => {
    const page = route("/verwalten/personen");
    expect(hubRowDescription(holder("ADMIN"), page, on)).toBe(page.description);
  });

  it("names exactly the children the Salonleitung sees under Regeln", () => {
    const regeln = route("/verwalten/regeln");
    expect(regeln.requires).toBe("children");
    expect(visibleChildren(salonleitung, regeln.href, on).map((child) => child.label)).toEqual([
      "Abwesenheiten",
    ]);
    expect(hubRowDescription(salonleitung, regeln, on)).toBe("Abwesenheiten");
  });

  it("names every visible child for the administrator, joined German style", () => {
    const regeln = route("/verwalten/regeln");
    const labels = visibleChildren(holder("ADMIN"), regeln.href, on).map((child) => child.label);
    expect(labels.length).toBeGreaterThan(2);
    const text = hubRowDescription(holder("ADMIN"), regeln, on);
    expect(text).toBe(`${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]}`);
    for (const label of labels) expect(text).toContain(label);
  });

  it("is empty for a hub the reader sees no child of (never a promise)", () => {
    expect(hubRowDescription({ permissions: [] }, route("/verwalten/regeln"), on)).toBe("");
  });
});

describe("personListHref (#992 N-14, D-992-05)", () => {
  it("leads the Salonleitung to the read list Team › Personen", () => {
    expect(personListHref(salonleitung, on)).toBe("/team/personen");
    expect(personListHref(holder("SALON_MANAGER"), on)).toBe("/team/personen");
  });

  it("leads whoever creates or edits persons to Verwalten › Personen", () => {
    expect(personListHref(holder("HR"), on)).toBe("/verwalten/personen");
    expect(personListHref(holder("ADMIN"), on)).toBe("/verwalten/personen");
  });

  it("is null for a reader without a person list in her menu", () => {
    expect(personListHref(holder("EMPLOYEE"), on)).toBeNull();
    expect(personListHref({ permissions: [] }, on)).toBeNull();
    expect(personListHref(null, on)).toBeNull();
  });
});
