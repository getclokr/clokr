import { get, writable } from "svelte/store";
import { prefsHydrated } from "$stores/prefs-state";
import { savePreferences } from "$api/preferences";

/**
 * Issue #606 - has the person closed the „Warum stempeln?“ intro, held in memory only.
 *
 * Source of truth is the server (`User.uiPreferences.whyClockIntroSeen`, `GET/PUT /me/preferences`). The
 * store is filled only from a server answer (`applyServerPreferences()`), emptied on logout and NEVER
 * written to localStorage or sessionStorage - a second device reads the same value from the server.
 * `undefined` means "not known yet" (before sign-in hydration, or an older server's answer without the
 * key): the card never shows then, so an unknown state can never turn into an unasked intro.
 *
 * `dismissWhyClockIntro()` shows the choice at once and, with the `prefsHydrated` gate open, PUTs exactly
 * `{ whyClockIntroSeen: true }` once - the only value the server accepts, there is no way back. It
 * rejects when the PUT fails (the caller tells the person); the seen state then stays true for this visit
 * only, because nothing was stored.
 */

export const whyClockIntroSeen = writable<boolean | undefined>(undefined);

/**
 * The person closed the intro during this visit. A later server answer of an unrelated PUT (a theme
 * change, a list size) must not bring the card back - not while the save is in flight, and not after a
 * failed one (the card then comes back at the next sign-in, which the error toast says).
 */
let closedThisVisit = false;

/** Apply the value of a server answer; anything but a boolean (an older server) leaves it unknown. */
export function setWhyClockIntroFromServer(value: unknown): void {
  if (closedThisVisit && value !== true) return;
  whyClockIntroSeen.set(typeof value === "boolean" ? value : undefined);
}

/** Forget the state (logout): the next person on this device starts unknown. */
export function resetWhyClockIntro(): void {
  closedThisVisit = false;
  whyClockIntroSeen.set(undefined);
}

/** Close the intro: shown as seen at once, stored on the server when the gate is open. */
export async function dismissWhyClockIntro(): Promise<void> {
  closedThisVisit = true;
  whyClockIntroSeen.set(true);
  if (!get(prefsHydrated)) return;
  await savePreferences({ whyClockIntroSeen: true });
}
