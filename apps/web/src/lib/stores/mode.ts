import { writable, derived, get, readable } from "svelte/store";
import { browser } from "$app/env";
import { prefsHydrated } from "$stores/prefs-state";
import { savePreferences } from "$api/preferences";

/**
 * Light/dark mode - applied via the `data-mode` attribute on <html>. Independent of the theme
 * (any theme x any mode is valid). Dark uses warm ivory, not pure white - see tokens.css.
 *
 * Issue #975: the store holds the person's CHOICE, "light" | "dark" | "system". "system" (also the
 * state of a person who never chose) follows the device's `prefers-color-scheme` live: the
 * `resolvedMode` store is what the app draws (`data-mode`), and a device switch updates it without
 * a reload. A choice of light or dark wins over the device, locally and (after sign-in) from the
 * account. A device change never writes to the server - only the person's own choice does.
 *
 * Pre-paint hand-over: app.html runs a small inline script before the first paint that sets
 * `data-mode` (and `data-theme`) from localStorage.mode light|dark, else from the device; this
 * module takes over on hydration. Existing devices may hold a `mode` the app wrote automatically
 * before #975; the server's answer ("system" for a person who never chose) replaces it on the next
 * start with a session.
 *
 * Legacy migration coordination: theme.ts seeds localStorage.mode for legacy 'hell' (light) and
 * 'dunkel' (dark) users on first load, but ONLY if no mode key exists; this module reads the key.
 */
export type ModeChoice = "light" | "dark" | "system";
export type Mode = "light" | "dark";

const VALID: readonly ModeChoice[] = ["light", "dark", "system"] as const;

/** The one allow-list in front of the stored/served mode choice; anything else is "system". */
export function normalizeModeChoice(raw: unknown): ModeChoice {
  return typeof raw === "string" && (VALID as readonly string[]).includes(raw)
    ? (raw as ModeChoice)
    : "system";
}

function readInitial(): ModeChoice {
  if (!browser) return "system";
  return normalizeModeChoice(localStorage.getItem("mode"));
}

/**
 * The device's light/dark setting. jsdom and very old browsers have no `matchMedia` (or no
 * `addEventListener` on its result): then the device counts as light and nothing is listened to.
 */
const deviceMode = readable<Mode>("light", (set) => {
  if (!browser || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const read = () => set(query.matches ? "dark" : "light");
  read();
  if (typeof query.addEventListener !== "function") return undefined;
  query.addEventListener("change", read);
  return () => query.removeEventListener("change", read);
});

/** The person's choice (light | dark | system). */
export const mode = writable<ModeChoice>(readInitial());

/** What is drawn: the choice, or the device while the choice is "system". */
export const resolvedMode = derived([mode, deviceMode], ([$mode, $device]): Mode =>
  $mode === "system" ? $device : $mode,
);

mode.subscribe((value) => {
  if (!browser) return;
  localStorage.setItem("mode", value);
  // After hydration from the server, persist the person's own toggles back to /me/preferences.
  if (get(prefsHydrated)) {
    savePreferences({ mode: value }).catch(() => {});
  }
});

resolvedMode.subscribe((value) => {
  if (!browser) return;
  document.documentElement.setAttribute("data-mode", value);
});
