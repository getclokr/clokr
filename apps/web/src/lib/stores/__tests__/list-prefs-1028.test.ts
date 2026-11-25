// Issue #1028 - the in-memory store of the stored list preferences. It is filled only from the server's
// answer, saves through PUT /me/preferences (key `lists`) behind the prefsHydrated gate, never touches
// the browser storage and is emptied on logout. A failed PUT keeps the local choice and tells the person.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const { saveSpy, fetchSpy } = vi.hoisted(() => ({
  saveSpy: vi.fn(),
  fetchSpy: vi.fn(),
}));

vi.mock("$api/preferences", () => ({
  savePreferences: saveSpy,
  fetchPreferences: fetchSpy,
}));

// This workspace's jsdom exposes no `localStorage` (see apply-preferences.test.ts); the stores read it
// while their modules evaluate. Every write is recorded so the test can prove none came from the list store.
const storageWrites = vi.hoisted(() => [] as string[]);
vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storageWrites.push(k);
      map.set(k, String(v));
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: (k: string) => void storageWrites.push(`session:${k}`),
    removeItem: () => {},
    clear: () => {},
  });
});

import { prefsHydrated } from "$stores/prefs-state";
import { toasts } from "$stores/toast";
import {
  listPrefs,
  resetListPrefs,
  saveListPreference,
  setListPrefsFromServer,
} from "../list-prefs";
import { applyServerPreferences } from "../apply-preferences";

function answer(lists: Record<string, unknown> | undefined) {
  return {
    theme: "pflaume",
    themeChoice: null,
    tenantDefaultTheme: "pflaume",
    mode: "system",
    language: "de",
    emailOptOut: [],
    ...(lists === undefined ? {} : { lists }),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("list-prefs store (Issue #1028)", () => {
  beforeEach(() => {
    prefsHydrated.set(false);
    resetListPrefs();
    saveSpy.mockReset();
    fetchSpy.mockReset();
    storageWrites.length = 0;
    vi.restoreAllMocks();
  });

  it("with the gate open a choice is PUT exactly once, with only the lists key", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue(
      answer({ "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" } }),
    );
    await saveListPreference("team.heute.aufgaben", { pageSize: 10, filter: "urlaub" });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      lists: { "team.heute.aufgaben": { pageSize: 10, filter: "urlaub" } },
    });
    expect(get(listPrefs)["team.heute.aufgaben"]).toEqual({ pageSize: 10, filter: "urlaub" });
  });

  it("with the gate closed nothing is PUT; the choice stays local", async () => {
    await saveListPreference("team.heute.aufgaben", { pageSize: 20 });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(get(listPrefs)["team.heute.aufgaben"]).toEqual({ pageSize: 20 });
  });

  it("never writes localStorage or sessionStorage", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue(answer({ "ich.tag.verlauf": { pageSize: 10 } }));
    await saveListPreference("ich.tag.verlauf", { pageSize: 10 });
    applyServerPreferences(answer({ "ich.tag.fuer-dich": { pageSize: 20 } }) as never);
    expect(storageWrites.filter((k) => k.toLowerCase().includes("list"))).toEqual([]);
    expect(storageWrites.filter((k) => k.startsWith("session:"))).toEqual([]);
  });

  it("applyServerPreferences fills the store from `lists`; an absent key means empty", () => {
    applyServerPreferences(
      answer({ "team.heute.aufgaben": { pageSize: 10, filter: "nachtrag" } }) as never,
    );
    expect(get(listPrefs)).toEqual({ "team.heute.aufgaben": { pageSize: 10, filter: "nachtrag" } });
    applyServerPreferences(answer(undefined) as never);
    expect(get(listPrefs)).toEqual({});
  });

  it("logout (resetListPrefs) empties the store", () => {
    setListPrefsFromServer({ "ich.tag.verlauf": { pageSize: 5 } });
    expect(Object.keys(get(listPrefs))).toHaveLength(1);
    resetListPrefs();
    expect(get(listPrefs)).toEqual({});
  });

  it("a failed PUT keeps the local choice and shows the error toast", async () => {
    prefsHydrated.set(true);
    const toast = vi.spyOn(toasts, "error").mockReturnValue(crypto.randomUUID());
    saveSpy.mockRejectedValue(new Error("offline"));
    await saveListPreference("ich.tag.letzte-tage", { pageSize: 20 });
    expect(get(listPrefs)["ich.tag.letzte-tage"]).toEqual({ pageSize: 20 });
    expect(toast).toHaveBeenCalledWith(
      "Die Anzeige konnte nicht gespeichert werden. Versuch es später noch einmal.",
    );
  });

  it("a slower, older answer never replaces a newer choice", async () => {
    prefsHydrated.set(true);
    const first = deferred<ReturnType<typeof answer>>();
    const second = deferred<ReturnType<typeof answer>>();
    saveSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = saveListPreference("team.heute.aufgaben", { pageSize: 10 });
    const b = saveListPreference("team.heute.aufgaben", { pageSize: 20 });
    second.resolve(answer({ "team.heute.aufgaben": { pageSize: 20 } }));
    await b;
    first.resolve(answer({ "team.heute.aufgaben": { pageSize: 10 } }));
    await a;
    expect(get(listPrefs)["team.heute.aufgaben"]).toEqual({ pageSize: 20 });
  });

  it("a server answer of another request does not overwrite a choice that is still being saved", async () => {
    prefsHydrated.set(true);
    const pending = deferred<ReturnType<typeof answer>>();
    saveSpy.mockReturnValueOnce(pending.promise);
    const saving = saveListPreference("team.heute.aufgaben", { pageSize: 20 });
    // e.g. the answer of a Farbwelt PUT that was issued earlier and carries the older lists
    setListPrefsFromServer({ "team.heute.aufgaben": { pageSize: 5 } });
    expect(get(listPrefs)["team.heute.aufgaben"]).toEqual({ pageSize: 20 });
    pending.resolve(answer({ "team.heute.aufgaben": { pageSize: 20 } }));
    await saving;
    expect(get(listPrefs)["team.heute.aufgaben"]).toEqual({ pageSize: 20 });
  });

  it("drops entries of an unknown list id from a server answer", () => {
    setListPrefsFromServer({
      "no.such.list": { pageSize: 5 },
      "ich.tag.verlauf": { pageSize: 10 },
    } as never);
    expect(Object.keys(get(listPrefs))).toEqual(["ich.tag.verlauf"]);
  });
});
