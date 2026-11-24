/**
 * Issue #976 — DB-free unit test of the resolution order and of the web-id <-> enum mapping.
 */
import { describe, it, expect } from "vitest";
import { UiTheme } from "@clokr/db";
import {
  UI_THEME_IDS,
  ownUiThemeChoice,
  resolveUiTheme,
  uiThemeFromDb,
  uiThemeToDb,
  type UiThemeId,
} from "../ui-theme";

const CHOICES: (UiThemeId | null)[] = [null, "pflaume", "salz", "petrol"];
const DEFAULTS: (UiThemeId | null | undefined)[] = [undefined, null, "pflaume", "salz", "petrol"];

describe("resolveUiTheme (#976)", () => {
  for (const choice of CHOICES) {
    for (const tenantDefault of DEFAULTS) {
      it(`own ${String(choice)} + tenant default ${String(tenantDefault)}`, () => {
        const expected = choice !== null ? choice : (tenantDefault ?? "pflaume");
        expect(resolveUiTheme(choice, tenantDefault)).toBe(expected);
      });
    }
  }
});

describe("ownUiThemeChoice (#976)", () => {
  it("nothing stored is no choice", () => {
    expect(ownUiThemeChoice(null)).toBeNull();
    expect(ownUiThemeChoice(undefined)).toBeNull();
  });

  it("maps a stored value like normalizeUiTheme", () => {
    expect(ownUiThemeChoice("wald")).toBe("petrol");
    expect(ownUiThemeChoice("salz")).toBe("salz");
    expect(ownUiThemeChoice("garbage")).toBe("pflaume");
  });
});

describe("UiTheme enum mapping (#976)", () => {
  it("the Prisma enum has exactly one value per web theme id, in the same order", () => {
    expect(Object.values(UiTheme)).toEqual(UI_THEME_IDS.map((id) => id.toUpperCase()));
  });

  it.each(UI_THEME_IDS)("round-trips %s through the enum", (id) => {
    expect(uiThemeToDb(id)).toBe(id.toUpperCase());
    expect(uiThemeFromDb(uiThemeToDb(id))).toBe(id);
  });

  it("an absent stored value reads Pflaume", () => {
    expect(uiThemeFromDb(undefined)).toBe("pflaume");
    expect(uiThemeFromDb(null)).toBe("pflaume");
  });
});
