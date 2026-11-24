// Issue #975 - the mode store holds the person's CHOICE (light | dark | system) and follows the
// device's prefers-color-scheme live while the choice is "system".
//
// `$stores/mode` is imported for real (the `$app/env` alias resolves `browser` to true); the
// preference client is mocked so no request leaves the test, and `matchMedia` is a stub whose
// change listeners the test fires. Modules are reset between cases so the initial read runs again.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { saveSpy } = vi.hoisted(() => ({
  saveSpy: vi.fn(() => Promise.resolve({})),
}));

vi.mock("$api/preferences", () => ({
  savePreferences: saveSpy,
}));

// This workspace's jsdom exposes no `localStorage` (see auth-boot-hydration.test.ts).
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

/** A matchMedia stub for the dark-scheme query; `flip` changes the device and fires the listeners. */
function stubDevice(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    flip(nextDark: boolean) {
      query.matches = nextDark;
      for (const fn of [...listeners]) fn();
    },
  };
}

async function bootWith(seed: Record<string, string>) {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  document.documentElement.removeAttribute("data-mode");
  vi.resetModules();
  const mod = await import("$stores/mode");
  const prefs = await import("$stores/prefs-state");
  return { ...mod, prefsHydrated: prefs.prefsHydrated, storage };
}

const attr = () => document.documentElement.getAttribute("data-mode");

beforeEach(() => {
  vi.unstubAllGlobals();
  saveSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("#975 - no stored choice follows the device", () => {
  it("a dark device gives system, data-mode dark and localStorage.mode system", async () => {
    stubDevice(true);
    const { mode, resolvedMode, storage } = await bootWith({});
    expect(get(mode)).toBe("system");
    expect(get(resolvedMode)).toBe("dark");
    expect(attr()).toBe("dark");
    expect(storage.getItem("mode")).toBe("system");
  });

  it("a light device gives light", async () => {
    stubDevice(false);
    const { mode } = await bootWith({});
    expect(get(mode)).toBe("system");
    expect(attr()).toBe("light");
  });

  it("a device change dark to light updates data-mode and resolvedMode live", async () => {
    const device = stubDevice(true);
    const { resolvedMode } = await bootWith({});
    expect(attr()).toBe("dark");
    device.flip(false);
    expect(attr()).toBe("light");
    expect(get(resolvedMode)).toBe("light");
    device.flip(true);
    expect(attr()).toBe("dark");
  });

  it("an unknown stored value counts as no choice", async () => {
    stubDevice(true);
    const { mode } = await bootWith({ mode: "auto" });
    expect(get(mode)).toBe("system");
    expect(attr()).toBe("dark");
  });
});

describe("#975 - an own choice wins over the device", () => {
  it("stored light on a dark device stays light, also after a device change", async () => {
    const device = stubDevice(true);
    const { mode } = await bootWith({ mode: "light" });
    expect(get(mode)).toBe("light");
    expect(attr()).toBe("light");
    device.flip(false);
    device.flip(true);
    expect(attr()).toBe("light");
  });

  it("set(system) after dark follows the device again", async () => {
    const device = stubDevice(false);
    const { mode } = await bootWith({ mode: "dark" });
    expect(attr()).toBe("dark");
    mode.set("system");
    expect(attr()).toBe("light");
    device.flip(true);
    expect(attr()).toBe("dark");
  });
});

describe("#975 - without matchMedia", () => {
  it("nothing throws and data-mode is light", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { mode } = await bootWith({});
    expect(get(mode)).toBe("system");
    expect(attr()).toBe("light");
  });
});

describe("#975 - only the person's own choice is persisted", () => {
  it("with the gate open, set(system) saves {mode:system} once and a device change saves nothing", async () => {
    const device = stubDevice(false);
    const { mode, prefsHydrated } = await bootWith({ mode: "dark" });
    prefsHydrated.set(true);
    saveSpy.mockClear();

    mode.set("system");
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({ mode: "system" });

    saveSpy.mockClear();
    device.flip(true);
    device.flip(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
