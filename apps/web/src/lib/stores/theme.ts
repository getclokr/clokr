import { writable } from "svelte/store";
import { browser } from "$app/env";

/**
 * Themes (Issue #842) - applied via the `data-theme` attribute on <html>. Every theme exists in a
 * light and a dark mode (`data-mode`, see mode.ts); the token blocks live in tokens.css.
 * Pflaume is the default. The list carries no colour: a preview draws from the real tokens.
 *
 * Issue #976: the `theme` store is the APPLIED Farbwelt, never a choice. Which one is shown is
 * decided only on the server (`resolveUiTheme()`, apps/api/src/contexts/platform/ui-theme.ts: own
 * choice, then the tenant default, then Pflaume); the web applies the `theme` that GET/PUT
 * /me/preferences answers and no screen derives it. `themeChoice` (the own choice, null = none,
 * undefined = not loaded yet) and `tenantDefaultTheme` are display state, set only from server
 * answers and never persisted. localStorage.theme is the device's last shown Farbwelt: the sign-in
 * page knows no tenant, so it (and the pre-paint script of app.html) shows exactly that, else
 * Pflaume. The operator console pins salz in lib/operator/theme-pin.ts.
 */
export type Theme = "pflaume" | "salz" | "petrol";

export const themes: { id: Theme; label: string }[] = [
  { id: "pflaume", label: "Pflaume" },
  { id: "salz", label: "Salz" },
  { id: "petrol", label: "Petrol" },
];

// Legacy mapping (#842 D-842-17), the web twin of the API's `normalizeUiTheme`. Silent; a stored
// or served value of a retired theme id becomes one of the three current ids:
//   lila, hell -> pflaume | nacht, schiefer, dunkel -> salz | wald -> petrol | unknown -> pflaume
// Mode coordination (one-time, only if no `mode` key exists):
//   hell   -> also seed localStorage.mode = 'light'
//   dunkel -> also seed localStorage.mode = 'dark'
const LEGACY_THEME_MAP: Record<string, Theme> = {
  lila: "pflaume",
  hell: "pflaume",
  nacht: "salz",
  schiefer: "salz",
  dunkel: "salz",
  wald: "petrol",
};
const LEGACY_MODE_SEED: Record<string, "light" | "dark"> = {
  hell: "light",
  dunkel: "dark",
};

/** The one allow-list in front of `data-theme` and localStorage (T-842-06). */
export function normalizeTheme(raw: unknown): Theme {
  if (typeof raw !== "string") return "pflaume";
  const known = themes.find((t) => t.id === raw);
  if (known) return known.id;
  if (Object.hasOwn(LEGACY_THEME_MAP, raw)) return LEGACY_THEME_MAP[raw];
  return "pflaume";
}

function readInitial(): Theme {
  if (!browser) return "pflaume";
  // #842 D-842-16: skin and density are gone - drop the keys they left on the device.
  localStorage.removeItem("skin");
  localStorage.removeItem("density");
  const raw = localStorage.getItem("theme");
  if (!raw) return "pflaume";
  const normalized = normalizeTheme(raw);
  if (normalized !== raw) {
    localStorage.setItem("theme", normalized); // overwrite the legacy value immediately
    // One-time mode seed for hell/dunkel legacy users - only if no mode key set yet.
    // This is the ONLY case where theme.ts touches another store's localStorage key.
    // Own keys only: "constructor" or "__proto__" must not read from the object prototype.
    const seed = Object.hasOwn(LEGACY_MODE_SEED, raw) ? LEGACY_MODE_SEED[raw] : undefined;
    if (seed && localStorage.getItem("mode") === null) {
      localStorage.setItem("mode", seed);
    }
  }
  return normalized;
}

/** The Farbwelt that is applied right now (what `data-theme` shows). */
export const theme = writable<Theme>(readInitial());

/** The person's own choice: null = none (the tenant default applies), undefined = not loaded yet. */
export const themeChoice = writable<Theme | null | undefined>(undefined);

/** The tenant's Standard-Farbwelt as the server answered it; undefined = not loaded yet. */
export const tenantDefaultTheme = writable<Theme | undefined>(undefined);

theme.subscribe((value) => {
  if (!browser) return;
  const safe = normalizeTheme(value);
  localStorage.setItem("theme", safe);
  document.documentElement.setAttribute("data-theme", safe);
  // Deliberately NO PUT /me/preferences here (Issue #976): the applied theme can be the tenant
  // default, and writing it back would turn that default into an own choice. An own choice is
  // saved only through applyPreferences() (apply-preferences.ts).
});
