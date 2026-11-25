// Issue #976 - the Standard-Farbwelt section of System › Allgemein, mounted: it saves instantly, sends only its
// own key, refreshes the own preferences after a save, puts the previous value back when the server refuses
// and is disabled without the permission.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";

const put = vi.fn();
const success = vi.fn();
const refresh = vi.fn();

vi.mock("$api/client", () => ({ api: { put: (...a: unknown[]) => put(...a) } }));
vi.mock("$stores/toast", () => ({
  toasts: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() },
}));
vi.mock("$stores/apply-preferences", () => ({
  refreshPreferences: () => refresh(),
}));
vi.mock("$stores/theme", () => ({
  themes: [
    { id: "pflaume", label: "Pflaume" },
    { id: "salz", label: "Salz" },
    { id: "petrol", label: "Petrol" },
  ],
  normalizeTheme: (raw: unknown) =>
    raw === "salz" || raw === "petrol" || raw === "pflaume" ? raw : "pflaume",
}));

import { renderWithTheme } from "$tests/test-utils";
import { settingsSection } from "$lib/settings/settings-pages";
import ThemeDefaultSection from "../ThemeDefaultSection.svelte";

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({});
  refresh.mockResolvedValue(undefined);
});

describe("ThemeDefaultSection", () => {
  it("has the heading Standard-Farbwelt, three radios and the stored value checked", () => {
    renderWithTheme(ThemeDefaultSection, { config: { defaultUiTheme: "salz" } });
    expect(screen.getByRole("heading", { name: "Standard-Farbwelt" })).toBeTruthy();
    for (const label of ["Pflaume", "Salz", "Petrol"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Salz" })).toBeChecked();
    expect(screen.getByTestId("admin-system-standard-farbwelt")).toBeTruthy();
  });

  it("a change sends exactly the own key once, shows the toast and refreshes the preferences", async () => {
    renderWithTheme(ThemeDefaultSection, { config: { defaultUiTheme: "pflaume" } });
    await fireEvent.click(screen.getByRole("radio", { name: "Petrol" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("/settings/work", { defaultUiTheme: "petrol" });
    expect(Object.keys(put.mock.calls[0][1]).sort()).toEqual(
      [...settingsSection("allgemein-farbwelt").keys].sort(),
    );
    await waitFor(() => expect(success).toHaveBeenCalledWith("Einstellung gespeichert."));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: "Petrol" })).toBeChecked();
  });

  it("a rejected put puts the previous value back and shows the error in the section", async () => {
    put.mockRejectedValue(new Error("Keine Berechtigung"));
    renderWithTheme(ThemeDefaultSection, { config: { defaultUiTheme: "salz" } });
    await fireEvent.click(screen.getByRole("radio", { name: "Petrol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keine Berechtigung");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Salz" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Petrol" })).not.toBeChecked();
    expect(success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("canEdit=false disables the control", async () => {
    renderWithTheme(ThemeDefaultSection, { config: { defaultUiTheme: "salz" }, canEdit: false });
    const petrol = screen.getByRole("radio", { name: "Petrol" });
    expect(petrol).toBeDisabled();
    await fireEvent.click(petrol);
    expect(put).not.toHaveBeenCalled();
  });
});
