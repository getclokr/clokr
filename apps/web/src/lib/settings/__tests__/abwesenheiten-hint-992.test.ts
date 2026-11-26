// Issue #992 (N-20, D-992-09) - the hint of Regeln › Abwesenheiten names only the tabs the reader sees.
import { describe, expect, it } from "vitest";
import {
  ABWESENHEITEN_TABS,
  abwesenheitenRulesHint,
  visibleAbwesenheitenTabs,
} from "../abwesenheiten";
import personas from "$lib/nav/__tests__/fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const byValue = (...values: string[]) => ABWESENHEITEN_TABS.filter((t) => values.includes(t.value));

describe("abwesenheitenRulesHint", () => {
  it("joins the labels of the given tabs in German style", () => {
    expect(abwesenheitenRulesHint(byValue("urlaub", "sonderurlaub"))).toBe(
      "Einstellungen zu Urlaub und Sonderurlaub.",
    );
    expect(abwesenheitenRulesHint(byValue("urlaub", "sonderurlaub", "uebertrag"))).toBe(
      "Einstellungen zu Urlaub, Sonderurlaub und Übertrag.",
    );
  });

  it("a single tab reads without „und“", () => {
    expect(abwesenheitenRulesHint(byValue("urlaubsgrenzen"))).toBe(
      "Einstellungen zu Urlaubsgrenzen & Sperren.",
    );
  });

  it("is empty without a tab", () => {
    expect(abwesenheitenRulesHint([])).toBe("");
  });

  it("names for the Salonleitung only what she sees (no Urlaub, Sonderurlaub, Übertrag)", () => {
    const user = { permissions: [...P.SALON_MANAGER, ...P.EMPLOYEE] };
    const tabs = visibleAbwesenheitenTabs(user);
    expect(tabs.map((tab) => tab.value)).toEqual(["betriebsurlaub", "urlaubsgrenzen"]);
    expect(abwesenheitenRulesHint(tabs)).toBe(
      "Einstellungen zu Betriebsurlaub und Urlaubsgrenzen & Sperren.",
    );
  });

  it("names all five tabs for the administrator", () => {
    const hint = abwesenheitenRulesHint(visibleAbwesenheitenTabs({ permissions: P.ADMIN }));
    for (const tab of ABWESENHEITEN_TABS) expect(hint).toContain(tab.label);
  });
});
