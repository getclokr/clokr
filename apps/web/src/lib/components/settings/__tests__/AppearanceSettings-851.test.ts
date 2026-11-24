// Issue #851 (D-851-02) - the appearance section of the profile: Farbwelt and Modus through the same
// single-PUT path as the Branding page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";

const applyPreferences = vi.fn();
vi.mock("$stores/apply-preferences", () => ({
  applyPreferences: (...args: unknown[]) => applyPreferences(...args),
}));

vi.mock("$stores/theme", async () => {
  const { writable } = await import("svelte/store");
  return {
    theme: writable("pflaume"),
    themes: [
      { id: "pflaume", label: "Pflaume" },
      { id: "salz", label: "Salz" },
      { id: "petrol", label: "Petrol" },
    ],
  };
});
vi.mock("$stores/mode", async () => {
  const { writable } = await import("svelte/store");
  const mode = writable("light");
  return { mode, resolvedMode: writable("light") };
});

import AppearanceSettings from "../AppearanceSettings.svelte";

beforeEach(() => applyPreferences.mockClear());
afterEach(() => cleanup());

describe("AppearanceSettings", () => {
  it("offers the three themes and the modes Hell, Dunkel and Wie Gerät", () => {
    renderWithTheme(AppearanceSettings, {});
    for (const label of ["Pflaume", "Salz", "Petrol", "Hell", "Dunkel", "Wie Gerät"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("a theme click saves the theme once", async () => {
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Petrol" }));
    expect(applyPreferences).toHaveBeenCalledTimes(1);
    expect(applyPreferences).toHaveBeenCalledWith({ theme: "petrol" });
  });

  it("a mode click saves the mode once", async () => {
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(applyPreferences).toHaveBeenCalledWith({ mode: "dark" });
  });
});

// Issue #975: "Wie Gerät" is checked when the mode store holds "system", and a click saves it once.
describe("AppearanceSettings - Wie Gerät (#975)", () => {
  it("checks Wie Gerät while the mode store holds system", async () => {
    const { mode } = await import("$stores/mode");
    (mode as unknown as { set: (v: string) => void }).set("system");
    renderWithTheme(AppearanceSettings, {});
    expect(screen.getByRole("radio", { name: "Wie Gerät" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hell" })).not.toBeChecked();
    (mode as unknown as { set: (v: string) => void }).set("light");
  });

  it("a click on Wie Gerät saves { mode: system } once", async () => {
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Wie Gerät" }));
    expect(applyPreferences).toHaveBeenCalledTimes(1);
    expect(applyPreferences).toHaveBeenCalledWith({ mode: "system" });
  });
});
