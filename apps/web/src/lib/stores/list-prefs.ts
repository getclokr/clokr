import { get, writable } from "svelte/store";
import { prefsHydrated } from "$stores/prefs-state";
import { toasts } from "$stores/toast";
import { savePreferences } from "$api/preferences";
import { isListId, type ListId, type ListPreference } from "$lib/lists/list-registry";

/**
 * Issue #1028 - the page size and filter a person chose per list, held in memory only.
 *
 * Source of truth is the server (`User.uiPreferences.lists`, `GET/PUT /me/preferences`). This store is
 * filled only from a server answer (`applyServerPreferences()`), emptied on logout and NEVER written to
 * localStorage or sessionStorage - a second device reads the same choice from the server. A list reads
 * its choice through `resolveListPreference(id, $listPrefs[id])`, which falls back to the list's default
 * for anything missing or invalid.
 *
 * Saving: `saveListPreference()` shows the choice at once (a click must not wait for the network) and,
 * with the `prefsHydrated` gate open, PUTs exactly `{ lists: { [id]: entry } }` once; the server merges
 * it into the other lists one level deep. The gate is the same one as in apply-preferences.ts: closed
 * before sign-in hydration and after logout, so nothing is PUT then. A failed PUT keeps the local choice
 * for this visit and says so (P-11); a successful one is silent, like the topbar mode toggle.
 */

export type StoredLists = Partial<Record<ListId, ListPreference>>;

export const listPrefs = writable<StoredLists>({});

/** Newest save wins: a slower, older answer must never replace a newer choice. */
let saveSeq = 0;
/** Saves still waiting for their answer; while any is, a foreign server answer leaves the lists alone. */
let pending = 0;

const SAVE_FAILED = "Die Anzeige konnte nicht gespeichert werden. Versuch es später noch einmal.";

function onlyRegistered(lists: unknown): StoredLists {
  const out: StoredLists = {};
  if (typeof lists !== "object" || lists === null || Array.isArray(lists)) return out;
  for (const [id, entry] of Object.entries(lists)) {
    if (isListId(id) && typeof entry === "object" && entry !== null) out[id] = entry;
  }
  return out;
}

/**
 * Apply the `lists` of a server answer (absent = none stored). Skipped while a save of this store is
 * still in flight, so the answer of an earlier, unrelated PUT cannot revert a choice just made.
 */
export function setListPrefsFromServer(lists: unknown): void {
  if (pending > 0) return;
  listPrefs.set(onlyRegistered(lists));
}

/** Forget every stored choice (logout). Also drops the bookkeeping of saves still in flight. */
export function resetListPrefs(): void {
  saveSeq++;
  pending = 0;
  listPrefs.set({});
}

/**
 * Store a choice of one list. `entry` is the complete entry (size and filter); the server replaces the
 * list's entry as a whole.
 */
export async function saveListPreference(id: ListId, entry: ListPreference): Promise<void> {
  listPrefs.update((current) => ({ ...current, [id]: entry }));
  if (!get(prefsHydrated)) return;

  const seq = ++saveSeq;
  pending++;
  try {
    const answer = await savePreferences({ lists: { [id]: entry } });
    pending = Math.max(0, pending - 1);
    if (seq === saveSeq && pending === 0) listPrefs.set(onlyRegistered(answer.lists));
  } catch {
    pending = Math.max(0, pending - 1);
    toasts.error(SAVE_FAILED);
  }
}
