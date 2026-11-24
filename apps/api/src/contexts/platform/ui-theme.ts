// Issue #842 (D-842-17, D-842-18): the one place that decides which theme ids exist and how a
// retired id maps onto the current set. The web offers three themes (Pflaume, Salz, Petrol);
// the earlier set (pflaume, nacht, wald, schiefer) is still found in stored preferences and in
// requests of stale browser tabs, so both the PUT transform and the GET merge of
// `api/me.ts` go through `normalizeUiTheme()`. No other file may spell the mapping.
//
// Issue #976: this file is also the ONE place of the resolution order of the shown Farbwelt:
// own choice, then the tenant default (`TenantConfig.defaultUiTheme`), then Pflaume
// (`resolveUiTheme()`). No other file may spell that order; the web applies the resolved `theme`
// of GET/PUT /me/preferences and derives nothing itself. It is likewise the ONE place that maps
// the web theme ids (lowercase, `data-theme`) to the UPPER_SNAKE Prisma enum `UiTheme` and back
// (`uiThemeToDb()` / `uiThemeFromDb()`); `ui-theme-976.test.ts` pins the mapping.

import { UiTheme } from "@clokr/db";

export const UI_THEME_IDS = ["pflaume", "salz", "petrol"] as const;
export type UiThemeId = (typeof UI_THEME_IDS)[number];

// Stored values of the retired theme set (neutral / dark-blue and forest variants).
export const LEGACY_UI_THEME_IDS = ["nacht", "schiefer", "wald"] as const;

const LEGACY_THEME_TARGET: Record<(typeof LEGACY_UI_THEME_IDS)[number], UiThemeId> = {
  nacht: "salz",
  schiefer: "salz",
  wald: "petrol",
};

/** Map any stored or submitted value to one of the three themes; unknown values become pflaume. */
export function normalizeUiTheme(value: unknown): UiThemeId {
  if (typeof value !== "string") return "pflaume";
  if ((UI_THEME_IDS as readonly string[]).includes(value)) return value as UiThemeId;
  if (Object.prototype.hasOwnProperty.call(LEGACY_THEME_TARGET, value)) {
    return LEGACY_THEME_TARGET[value as keyof typeof LEGACY_THEME_TARGET];
  }
  return "pflaume";
}

/** Issue #976: the own choice, else the tenant default, else Pflaume. The only place of this order. */
export function resolveUiTheme(
  ownChoice: UiThemeId | null,
  tenantDefault: UiThemeId | null | undefined,
): UiThemeId {
  return ownChoice ?? tenantDefault ?? "pflaume";
}

/**
 * Issue #976: a stored own choice. Nothing stored (null/undefined) is "no choice" and follows the
 * tenant default; any stored string is mapped like before (an unknown legacy value stays pflaume).
 */
export function ownUiThemeChoice(stored: unknown): UiThemeId | null {
  if (stored === null || stored === undefined) return null;
  return normalizeUiTheme(stored);
}

const THEME_TO_DB: Record<UiThemeId, UiTheme> = {
  pflaume: UiTheme.PFLAUME,
  salz: UiTheme.SALZ,
  petrol: UiTheme.PETROL,
};

const THEME_FROM_DB: Record<UiTheme, UiThemeId> = {
  [UiTheme.PFLAUME]: "pflaume",
  [UiTheme.SALZ]: "salz",
  [UiTheme.PETROL]: "petrol",
};

/** Issue #976: web theme id to the stored `TenantConfig.defaultUiTheme` enum value. */
export function uiThemeToDb(id: UiThemeId): UiTheme {
  return THEME_TO_DB[id];
}

/** Issue #976: stored enum value (or no row) to the web theme id; absent means Pflaume. */
export function uiThemeFromDb(value: UiTheme | null | undefined): UiThemeId {
  return value ? THEME_FROM_DB[value] : "pflaume";
}
