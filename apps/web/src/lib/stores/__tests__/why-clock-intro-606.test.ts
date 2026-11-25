// Issue #606 - the seen state of „Warum stempeln?“ is fed only from server answers and never stored on the device.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const savePreferences = vi.fn();
const fetchPreferences = vi.fn();
vi.mock("$api/preferences", () => ({
  savePreferences: (p: unknown) => savePreferences(p),
  fetchPreferences: () => fetchPreferences(),
}));

import { prefsHydrated } from "$stores/prefs-state";
import {
  dismissWhyClockIntro,
  resetWhyClockIntro,
  setWhyClockIntroFromServer,
  whyClockIntroSeen,
} from "../why-clock-intro";
import { applyServerPreferences } from "../apply-preferences";

beforeEach(() => {
  resetWhyClockIntro();
  prefsHydrated.set(false);
  savePreferences.mockResolvedValue({ whyClockIntroSeen: true });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("why-clock-intro store", () => {
  it("is unknown until a server answer says otherwise", () => {
    expect(get(whyClockIntroSeen)).toBeUndefined();
    setWhyClockIntroFromServer(false);
    expect(get(whyClockIntroSeen)).toBe(false);
    setWhyClockIntroFromServer(true);
    expect(get(whyClockIntroSeen)).toBe(true);
  });

  it("an answer without a boolean (an older server) leaves it unknown", () => {
    setWhyClockIntroFromServer(undefined);
    expect(get(whyClockIntroSeen)).toBeUndefined();
    setWhyClockIntroFromServer("yes");
    expect(get(whyClockIntroSeen)).toBeUndefined();
  });

  it("applyServerPreferences feeds it from the answer of GET/PUT /me/preferences", () => {
    applyServerPreferences({
      theme: "pflaume",
      themeChoice: null,
      tenantDefaultTheme: "pflaume",
      mode: "system",
      language: "de",
      emailOptOut: [],
      whyClockIntroSeen: false,
    });
    expect(get(whyClockIntroSeen)).toBe(false);
  });

  it("is forgotten on logout (reset)", () => {
    setWhyClockIntroFromServer(true);
    resetWhyClockIntro();
    expect(get(whyClockIntroSeen)).toBeUndefined();
  });

  it("dismiss with the gate open shows it seen at once and PUTs { whyClockIntroSeen: true } exactly once", async () => {
    prefsHydrated.set(true);
    setWhyClockIntroFromServer(false);
    await dismissWhyClockIntro();
    expect(get(whyClockIntroSeen)).toBe(true);
    expect(savePreferences).toHaveBeenCalledTimes(1);
    expect(savePreferences).toHaveBeenCalledWith({ whyClockIntroSeen: true });
  });

  it("dismiss with the gate closed writes nothing", async () => {
    setWhyClockIntroFromServer(false);
    await dismissWhyClockIntro();
    expect(get(whyClockIntroSeen)).toBe(true);
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it("a failed PUT rejects, and a later answer of another PUT does not bring the card back this visit", async () => {
    prefsHydrated.set(true);
    setWhyClockIntroFromServer(false);
    savePreferences.mockRejectedValueOnce(new Error("offline"));
    await expect(dismissWhyClockIntro()).rejects.toThrow("offline");
    expect(get(whyClockIntroSeen)).toBe(true);
    setWhyClockIntroFromServer(false);
    expect(get(whyClockIntroSeen)).toBe(true);
  });

  it("never touches browser storage (source scan, comments stripped)", () => {
    const source = readFileSync(join(__dirname, "..", "why-clock-intro.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source.length).toBeGreaterThan(100);
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });
});
