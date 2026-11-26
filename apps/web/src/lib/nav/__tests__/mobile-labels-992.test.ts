// Issue #992 (S-02, N-21; D-992-23, owner decision 25.11.2026: differences are labelled, not hidden) —
// a Team page whose name the person also sees under Ich reads "Team-<Name>" in the phone tab bar and
// in the phone crumb. The desktop rail keeps the plain name under its area heading. Personas
// are the shared fixture; the Salonleitung also holds the Mitarbeiter role.
import { describe, expect, it } from "vitest";
import { mobileTabs, phoneCrumbLabel, qualifiedNavLabel, routeByKey } from "../routes";
import personas from "./fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const on = { availabilityEnabled: true };
const salonleitung = { permissions: [...P.SALON_MANAGER, ...P.EMPLOYEE] };
const ausbilder = { permissions: [...P.TRAINER, ...P.EMPLOYEE] };

const route = (href: string) => {
  const found = routeByKey(href);
  if (found === null) throw new Error(`${href} is not in the route table`);
  return found;
};

describe("qualifiedNavLabel (D-992-23)", () => {
  it("qualifies a Team page whose name the person also sees under Ich", () => {
    expect(qualifiedNavLabel(salonleitung, route("/team/zeiten"), on)).toBe("Team-Zeiten");
    expect(qualifiedNavLabel(salonleitung, route("/team/abwesenheiten"), on)).toBe(
      "Team-Abwesen­heiten",
    );
    expect(qualifiedNavLabel(salonleitung, route("/team/dienstplan"), on)).toBe("Team-Dienstplan");
  });

  it("leaves a Team page without an Ich twin alone", () => {
    expect(qualifiedNavLabel(salonleitung, route("/team/heute"), on)).toBeNull();
    expect(qualifiedNavLabel(salonleitung, route("/team/aufgaben"), on)).toBeNull();
  });

  it("never qualifies an Ich page", () => {
    expect(qualifiedNavLabel(salonleitung, route("/ich/zeiten"), on)).toBeNull();
    expect(qualifiedNavLabel(salonleitung, route("/ich/abwesenheiten"), on)).toBeNull();
  });

  it("qualifies only while the Ich twin is visible to the person (negative control)", () => {
    // Nobody holds a Team permission without the Ich pages in this fixture world, so the control
    // removes the twin through the tenant feature of the Ich availability tab instead: the twin of the
    // roster is the plain Ich plan, which stays visible, so the answer must not change.
    expect(
      qualifiedNavLabel(salonleitung, route("/team/dienstplan"), { availabilityEnabled: false }),
    ).toBe("Team-Dienstplan");
    // A person who cannot open the Team page gets no label for it at all, qualified or not.
    expect(qualifiedNavLabel({ permissions: P.EMPLOYEE }, route("/team/zeiten"), on)).toBeNull();
  });

  it("follows the same rule for the Ausbilder", () => {
    for (const href of ["/team/zeiten", "/team/abwesenheiten", "/team/dienstplan"]) {
      const label = qualifiedNavLabel(ausbilder, route(href), on);
      const visible = mobileTabs(ausbilder, on).some((tab) => tab.href === href);
      if (visible) expect(label, href).toMatch(/^Team-/);
    }
  });
});

describe("the phone tab bar (D-992-23)", () => {
  it("shows „Team-Zeiten“ for the Salonleitung and keeps the page name as label", () => {
    const tab = mobileTabs(salonleitung, on).find((entry) => entry.href === "/team/zeiten");
    expect(tab?.displayLabel).toBe("Team-Zeiten");
    expect(tab?.label).toBe("Zeiten");
  });

  it("keeps the soft hyphen of the qualified label", () => {
    const labelled = qualifiedNavLabel(salonleitung, route("/team/abwesenheiten"), on);
    expect(labelled).toBe(`Team-${route("/team/abwesenheiten").labelBreaks}`);
  });

  it("leaves a tab without an Ich twin with its own display label", () => {
    const tab = mobileTabs(salonleitung, on).find((entry) => entry.href === "/team/heute");
    expect(tab?.displayLabel).toBe("Heute im Salon");
  });

  it("does not change the plain label of the first slot", () => {
    const first = mobileTabs(salonleitung, on)[0];
    expect(first.href).toBe("/ich/tag");
    expect(first.displayLabel).toBe(first.label);
  });
});

describe("the phone crumb (D-992-23)", () => {
  it("names the current page qualified when its Ich twin is visible", () => {
    expect(phoneCrumbLabel("/team/zeiten", salonleitung, on)).toBe("Team-Zeiten");
    expect(phoneCrumbLabel("/team/dienstplan/planung", salonleitung, on)).toBe("Team-Dienstplan");
    expect(phoneCrumbLabel("/team/verfuegbarkeit", salonleitung, on)).toBe("Team-Dienstplan");
  });

  it("is null for an Ich page, a page without a twin and an unknown path", () => {
    expect(phoneCrumbLabel("/ich/zeiten", salonleitung, on)).toBeNull();
    expect(phoneCrumbLabel("/team/heute", salonleitung, on)).toBeNull();
    expect(phoneCrumbLabel("/nirgends", salonleitung, on)).toBeNull();
  });
});
