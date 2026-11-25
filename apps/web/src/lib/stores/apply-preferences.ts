import { get } from "svelte/store";
import { prefsHydrated } from "$stores/prefs-state";
import { mode, normalizeModeChoice, type ModeChoice } from "$stores/mode";
import { theme, themeChoice, tenantDefaultTheme, normalizeTheme, type Theme } from "$stores/theme";
import { fetchPreferences, savePreferences, type UiPreferences } from "$api/preferences";
import { setListPrefsFromServer } from "$stores/list-prefs";
import { setWhyClockIntroFromServer } from "$stores/why-clock-intro";

/**
 * How the web applies the personal appearance (mode + Farbwelt) and the server's answer about it.
 *
 * Applying the server's answer (Issue #976): the Farbwelt that is shown is decided only on the
 * server (`resolveUiTheme()`: own choice, then the tenant default, then Pflaume). The web applies the
 * `theme` of GET/PUT /me/preferences as it is and never derives it from `themeChoice` or
 * `tenantDefaultTheme`, which are kept only to label the controls. `applyServerPreferences()` is the one
 * place that does it; sign-in hydration (auth.ts), `refreshPreferences()` and the answer of every PUT
 * go through it.
 *
 * Saving a choice (Issue #392): each of mode.ts / theme.ts used to fire its own partial `savePreferences`
 * whenever `prefsHydrated` was open, so a selection that touches several stores fired concurrent PUTs
 * (the lost-update race fixed server-side in me.ts by an atomic jsonb merge). Now only the mode store
 * persists on its own (a Topbar toggle, one key); the theme store never persists, because the applied
 * theme can be the tenant default. `applyPreferences()` sends a multi-key selection as ONE PUT.
 *
 * Gate contract: reuses the `prefsHydrated` gate exactly as `hydratePreferencesFromServer()` in auth.ts
 * does - no new flag. While it is closed (before sign-in hydration, after logout) nothing is PUT and a
 * selection is applied locally only. The subscribers still write localStorage and the DOM attributes.
 */

/** Newest request wins: a slower, older answer must never replace a newer one. */
let requestSeq = 0;

function closedGate<T>(run: () => T): T {
  const was = get(prefsHydrated);
  prefsHydrated.set(false);
  try {
    return run();
  } finally {
    prefsHydrated.set(was);
  }
}

/**
 * Apply an answer of GET/PUT /me/preferences to the stores. The gate is closed meanwhile, so no
 * subscriber echoes a server value back, and restored to what it was.
 *
 * `skipMode` leaves the mode store alone: the mode is the person's own input and is set at once when
 * they click, so the answer to a Farbwelt PUT must not overwrite a mode toggled in the meantime.
 */
export function applyServerPreferences(
  prefs: UiPreferences,
  options: { skipMode?: boolean } = {},
): void {
  closedGate(() => {
    if (!options.skipMode) mode.set(normalizeModeChoice(prefs.mode));
    // #842 D-842-17: a retired theme id of an older server or a cached answer is mapped before data-theme.
    theme.set(normalizeTheme(prefs.theme));
    themeChoice.set(
      prefs.themeChoice === undefined
        ? undefined
        : prefs.themeChoice === null
          ? null
          : normalizeTheme(prefs.themeChoice),
    );
    tenantDefaultTheme.set(
      prefs.tenantDefaultTheme === undefined ? undefined : normalizeTheme(prefs.tenantDefaultTheme),
    );
    // Issue #1028: the stored page size and filter per list; an answer without `lists` stores none.
    setListPrefsFromServer(prefs.lists ?? {});
    // Issue #606: has the person closed the „Warum stempeln?“ intro (unknown stays unknown).
    setWhyClockIntroFromServer(prefs.whyClockIntroSeen);
  });
}

/**
 * Apply a personal selection. `theme: null` goes back to the tenant default.
 *
 * Gate open: the mode is applied at once, the update is PUT exactly once, and the Farbwelt that is
 * shown comes from the server's answer (never set before it arrives). Rejects when the PUT fails, so
 * the caller can tell the person. Gate closed: applied locally, nothing is PUT.
 */
export function applyPreferences(update: {
  mode?: ModeChoice;
  theme?: Theme | null;
}): Promise<void> {
  if (!get(prefsHydrated)) {
    closedGate(() => {
      if (update.mode !== undefined) mode.set(update.mode);
      if (update.theme === null) {
        themeChoice.set(null);
      } else if (update.theme !== undefined) {
        theme.set(update.theme);
        themeChoice.set(update.theme);
      }
    });
    return Promise.resolve();
  }

  const seq = ++requestSeq;
  closedGate(() => {
    if (update.mode !== undefined) mode.set(update.mode);
  });
  return savePreferences(update).then((answer) => {
    if (seq === requestSeq) applyServerPreferences(answer, { skipMode: true });
  });
}

/** Fetch the account's preferences again and apply them (e.g. after the tenant default changed). */
export async function refreshPreferences(): Promise<void> {
  const seq = ++requestSeq;
  const answer = await fetchPreferences();
  if (seq === requestSeq) applyServerPreferences(answer);
}
