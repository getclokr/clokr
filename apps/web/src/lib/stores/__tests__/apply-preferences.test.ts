// Issue #392 (quick task 260928-uli), Task 2 - unit tests for applyPreferences().
// Issue #976: rewritten to the new contract. The theme store no longer persists on its own (the applied
// theme can be the tenant default), so the old control "setting the theme store PUTs" is gone; the shown
// Farbwelt is the server's answer, applied through applyServerPreferences(), and the newest request wins.
//
// The stores are imported for real (the `$app/env` alias resolves `browser` to true, as in
// theme-842.test.ts); only the preference client is mocked, so no request leaves the test.
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

// This workspace's jsdom exposes no `localStorage` (see auth-boot-hydration.test.ts). The stores read it
// while their modules evaluate, so it is stubbed before the static imports below run.
vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
});

import { prefsHydrated } from "$stores/prefs-state";
import { mode } from "$stores/mode";
import { theme, themeChoice, tenantDefaultTheme } from "$stores/theme";
import { applyPreferences, applyServerPreferences, refreshPreferences } from "../apply-preferences";

function answer(over: Record<string, unknown> = {}) {
  return {
    theme: "salz",
    themeChoice: null,
    tenantDefaultTheme: "salz",
    mode: "system",
    language: "de",
    emailOptOut: [],
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("apply-preferences", () => {
  beforeEach(() => {
    // Reset with the gate closed so these resets themselves never call savePreferences.
    prefsHydrated.set(false);
    mode.set("light");
    theme.set("pflaume");
    themeChoice.set(undefined);
    tenantDefaultTheme.set(undefined);
    saveSpy.mockReset();
    fetchSpy.mockReset();
  });

  it("control (anti-vacuity): the mode store alone still persists with the gate open, one key", () => {
    saveSpy.mockResolvedValue(answer());
    prefsHydrated.set(true);

    mode.set("dark");

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ mode: "dark" });
  });

  it("control: setting the real theme store directly with the gate open calls savePreferences zero times", () => {
    prefsHydrated.set(true);

    theme.set("petrol");

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("applyServerPreferences applies theme, choice, tenant default and mode without a PUT and leaves the gate", () => {
    applyServerPreferences(answer() as never);

    expect(get(theme)).toBe("salz");
    expect(get(themeChoice)).toBeNull();
    expect(get(tenantDefaultTheme)).toBe("salz");
    expect(get(mode)).toBe("system");
    expect(saveSpy).not.toHaveBeenCalled();
    expect(get(prefsHydrated)).toBe(false);

    prefsHydrated.set(true);
    applyServerPreferences(answer({ theme: "petrol", themeChoice: "petrol" }) as never);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(get(prefsHydrated)).toBe(true);
    expect(get(themeChoice)).toBe("petrol");
  });

  it("applyPreferences({ theme: null }) with the gate open PUTs exactly { theme: null } once, then applies the answer", async () => {
    prefsHydrated.set(true);
    theme.set("salz");
    themeChoice.set("salz");
    const pending = deferred<ReturnType<typeof answer>>();
    saveSpy.mockReturnValue(pending.promise);

    const done = applyPreferences({ theme: null });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ theme: null });
    // The theme store is not changed before the response arrives.
    expect(get(theme)).toBe("salz");
    expect(get(themeChoice)).toBe("salz");

    pending.resolve(answer({ theme: "petrol", themeChoice: null, tenantDefaultTheme: "petrol" }));
    await done;

    expect(get(theme)).toBe("petrol");
    expect(get(themeChoice)).toBeNull();
    expect(get(tenantDefaultTheme)).toBe("petrol");
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(get(prefsHydrated)).toBe(true);
  });

  it("applyPreferences({ theme: 'salz' }) PUTs once and applies the answer", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue(answer({ theme: "salz", themeChoice: "salz" }));

    await applyPreferences({ theme: "salz" });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ theme: "salz" });
    expect(get(theme)).toBe("salz");
    expect(get(themeChoice)).toBe("salz");
  });

  it("applyPreferences({ mode, theme }) sends both keys in ONE PUT (Issue #392) and sets the mode at once", async () => {
    prefsHydrated.set(true);
    const pending = deferred<ReturnType<typeof answer>>();
    saveSpy.mockReturnValue(pending.promise);

    const done = applyPreferences({ mode: "dark", theme: "petrol" });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ mode: "dark", theme: "petrol" });
    expect(get(mode)).toBe("dark");
    expect(get(prefsHydrated)).toBe(true);

    // The answer carries a stale mode; the person's click is not overwritten by it.
    pending.resolve(answer({ theme: "petrol", themeChoice: "petrol", mode: "light" }));
    await done;
    expect(get(mode)).toBe("dark");
    expect(get(theme)).toBe("petrol");
  });

  it("two overlapping calls whose answers arrive in reverse order end with the LATER call's answer", async () => {
    prefsHydrated.set(true);
    const first = deferred<ReturnType<typeof answer>>();
    const second = deferred<ReturnType<typeof answer>>();
    saveSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const p1 = applyPreferences({ theme: "salz" });
    const p2 = applyPreferences({ theme: "petrol" });

    second.resolve(answer({ theme: "petrol", themeChoice: "petrol" }));
    await p2;
    first.resolve(answer({ theme: "salz", themeChoice: "salz" }));
    await p1;

    expect(get(theme)).toBe("petrol");
    expect(get(themeChoice)).toBe("petrol");
  });

  it("a rejected PUT rejects the call and leaves the stores alone", async () => {
    prefsHydrated.set(true);
    theme.set("salz");
    themeChoice.set("salz");
    saveSpy.mockRejectedValue(new Error("offline"));

    await expect(applyPreferences({ theme: null })).rejects.toThrow("offline");
    expect(get(theme)).toBe("salz");
    expect(get(themeChoice)).toBe("salz");
  });

  it("with the gate closed an explicit theme is applied locally (theme + choice), nothing is PUT, the gate stays closed", async () => {
    await applyPreferences({ mode: "dark", theme: "petrol" });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(get(mode)).toBe("dark");
    expect(get(theme)).toBe("petrol");
    expect(get(themeChoice)).toBe("petrol");
    expect(get(prefsHydrated)).toBe(false);
  });

  it("with the gate closed null only sets the choice to null", async () => {
    theme.set("petrol");
    themeChoice.set("petrol");

    await applyPreferences({ theme: null });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(get(theme)).toBe("petrol");
    expect(get(themeChoice)).toBeNull();
  });

  it("refreshPreferences fetches and applies the account's preferences", async () => {
    fetchSpy.mockResolvedValue(answer({ theme: "petrol", tenantDefaultTheme: "petrol" }));

    await refreshPreferences();

    expect(get(theme)).toBe("petrol");
    expect(get(tenantDefaultTheme)).toBe("petrol");
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
