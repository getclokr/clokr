// Issue #851 (D-851-02) - the appearance section of the profile: Farbwelt and Modus through the same
// single-PUT path as the Branding page.
// Issue #975: the Modus control also offers Wie Gerät. Issue #976: the Farbwelt control also offers
// Standard des Unternehmens (the own choice null), with the hint naming the Standard-Farbwelt.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { renderWithTheme } from "$tests/test-utils";

const applyPreferences = vi.fn();
vi.mock("$stores/apply-preferences", () => ({
  applyPreferences: (...args: unknown[]) => applyPreferences(...args),
}));

const toastError = vi.fn();
vi.mock("$stores/toast", () => ({
  toasts: { error: (m: string) => toastError(m), success: vi.fn(), info: vi.fn() },
}));

vi.mock("$stores/theme", async () => {
  const { writable } = await import("svelte/store");
  return {
    theme: writable("pflaume"),
    themeChoice: writable(undefined),
    tenantDefaultTheme: writable(undefined),
    themes: [
      { id: "pflaume", label: "Pflaume" },
      { id: "salz", label: "Salz" },
      { id: "petrol", label: "Petrol" },
    ],
  };
});
vi.mock("$stores/mode", async () => {
  const { writable } = await import("svelte/store");
  return { mode: writable("light"), resolvedMode: writable("light") };
});

import { mode } from "$stores/mode";
import { themeChoice, tenantDefaultTheme } from "$stores/theme";
import AppearanceSettings from "../AppearanceSettings.svelte";

type Settable = { set: (v: unknown) => void };

beforeEach(() => {
  applyPreferences.mockReset();
  applyPreferences.mockResolvedValue(undefined);
  toastError.mockClear();
  (themeChoice as unknown as Settable).set(undefined);
  (tenantDefaultTheme as unknown as Settable).set(undefined);
  (mode as unknown as Settable).set("light");
});
afterEach(() => cleanup());

describe("AppearanceSettings", () => {
  it("offers the three themes, Standard des Unternehmens, and the modes Hell, Dunkel and Wie Gerät", () => {
    renderWithTheme(AppearanceSettings, {});
    for (const label of [
      "Pflaume",
      "Salz",
      "Petrol",
      "Standard des Unternehmens",
      "Hell",
      "Dunkel",
      "Wie Gerät",
    ]) {
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

describe("AppearanceSettings - Wie Gerät (#975)", () => {
  it("checks Wie Gerät while the mode store holds system", () => {
    (mode as unknown as Settable).set("system");
    renderWithTheme(AppearanceSettings, {});
    expect(screen.getByRole("radio", { name: "Wie Gerät" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hell" })).not.toBeChecked();
    expect(get(mode)).toBe("system");
  });

  it("a click on Wie Gerät saves { mode: system } once", async () => {
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Wie Gerät" }));
    expect(applyPreferences).toHaveBeenCalledTimes(1);
    expect(applyPreferences).toHaveBeenCalledWith({ mode: "system" });
  });
});

describe("AppearanceSettings - Standard des Unternehmens (#976)", () => {
  it("checks Standard des Unternehmens when the own choice is none", () => {
    (themeChoice as unknown as Settable).set(null);
    renderWithTheme(AppearanceSettings, {});
    expect(screen.getByRole("radio", { name: "Standard des Unternehmens" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Pflaume" })).not.toBeChecked();
  });

  it("checks the own choice when there is one", () => {
    (themeChoice as unknown as Settable).set("salz");
    renderWithTheme(AppearanceSettings, {});
    expect(screen.getByRole("radio", { name: "Salz" })).toBeChecked();
  });

  it("a click on Standard des Unternehmens saves { theme: null } once", async () => {
    (themeChoice as unknown as Settable).set("salz");
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Standard des Unternehmens" }));
    expect(applyPreferences).toHaveBeenCalledTimes(1);
    expect(applyPreferences).toHaveBeenCalledWith({ theme: null });
  });

  it("names the Standard-Farbwelt of the Unternehmen once it is known, and nothing before", () => {
    const first = renderWithTheme(AppearanceSettings, {});
    expect(screen.queryByTestId("appearance-default-hint")).toBeNull();
    first.unmount();

    (tenantDefaultTheme as unknown as Settable).set("salz");
    renderWithTheme(AppearanceSettings, {});
    expect(screen.getByTestId("appearance-default-hint").textContent).toBe(
      "Der Standard deines Unternehmens ist Salz.",
    );
  });

  it("a rejected save shows a toast error", async () => {
    applyPreferences.mockRejectedValue(new Error("offline"));
    renderWithTheme(AppearanceSettings, {});
    await fireEvent.click(screen.getByRole("radio", { name: "Petrol" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "Die Darstellung konnte nicht gespeichert werden. Bitte versuch es noch einmal.",
    );
  });
});
