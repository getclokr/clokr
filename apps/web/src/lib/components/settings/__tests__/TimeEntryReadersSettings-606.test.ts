// Issue #606 - the profile section „Wer sieht meine Zeiten?“: rows come only from the server answer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";

const fetchTimeEntryReaders = vi.fn();
vi.mock("$api/time-entry-readers", () => ({
  fetchTimeEntryReaders: () => fetchTimeEntryReaders(),
}));
vi.mock("$stores/salon-context", async () => {
  const { writable } = await import("svelte/store");
  return {
    salonContext: writable({
      loaded: true,
      homeSalonId: "salon-home",
      salons: [{ id: "salon-home", name: "Salon Mitte" }],
    }),
  };
});

const savePreferences = vi.fn();
vi.mock("$api/preferences", () => ({
  savePreferences: (p: unknown) => savePreferences(p),
  fetchPreferences: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  set: (_permissions: string[]) => {},
}));
vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  const store = writable({ user: { permissions: ["time-entry:create:EIGENE"] } });
  authState.set = (permissions) => store.set({ user: { permissions } });
  return { authStore: { subscribe: store.subscribe } };
});

import TimeEntryReadersSettings from "../TimeEntryReadersSettings.svelte";

beforeEach(() => {
  authState.set(["time-entry:create:EIGENE"]);
  fetchTimeEntryReaders.mockResolvedValue({
    groups: [
      { roleName: "Admin", coverage: "wholeTenant", purposes: ["hours", "payroll", "protection"] },
      { roleName: "Salonmanager", coverage: "homeSalon", purposes: ["hours", "protection"] },
      { roleName: "Ausbilder", coverage: "person", purposes: ["protection"] },
    ],
    connectedPrograms: false,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TimeEntryReadersSettings", () => {
  it("shows the Skeleton before the answer arrives", async () => {
    let resolve!: (v: unknown) => void;
    fetchTimeEntryReaders.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolve({ groups: [], connectedPrograms: false });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("renders one row per group with role name, coverage text and the purpose line", async () => {
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(await screen.findByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("im ganzen Unternehmen")).toBeInTheDocument();
    expect(
      screen.getByText("Zweck: Stundenkonto, Lohnabrechnung und Arbeitsschutz"),
    ).toBeInTheDocument();
    expect(screen.getByText("Zweck: Stundenkonto und Arbeitsschutz")).toBeInTheDocument();
    expect(screen.getByText("dir persönlich zugewiesen")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("names the own Stammsalon for a homeSalon row", async () => {
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(
      await screen.findByText("zuständig für deinen Stammsalon (Salon Mitte)"),
    ).toBeInTheDocument();
  });

  it("names connected programs without a key name or count, and always the support note", async () => {
    fetchTimeEntryReaders.mockResolvedValue({
      groups: [{ roleName: "Admin", coverage: "wholeTenant", purposes: ["protection"] }],
      connectedPrograms: true,
    });
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(
      await screen.findByText("Angebundene Programme deines Unternehmens"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Zweck: legt dein Unternehmen fest, zum Beispiel die Lohnabrechnung"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Der Clokr-Support sieht deine Zeiten nur in einem Supportfall/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the support note and no programs row when nothing is connected", async () => {
    renderWithTheme(TimeEntryReadersSettings, {});
    await screen.findByText("Admin");
    expect(screen.queryByText("Angebundene Programme deines Unternehmens")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Der Clokr-Support sieht deine Zeiten nur in einem Supportfall/),
    ).toBeInTheDocument();
  });

  it("shows the legal basis of the processing under the list", async () => {
    renderWithTheme(TimeEntryReadersSettings, {});
    const legal = await screen.findByTestId("time-entry-readers-legal");
    expect(legal).toHaveTextContent("Art. 6 Abs. 1 lit. b und c DSGVO");
    expect(legal).toHaveTextContent(
      "Die vollständigen Datenschutzhinweise bekommst du von deinem Unternehmen.",
    );
  });

  it("„Warum stempeln?“ ansehen opens the intro in a dialog without sending any request, Escape closes it", async () => {
    renderWithTheme(TimeEntryReadersSettings, {});
    await screen.findByText("Admin");
    await fireEvent.click(screen.getByRole("button", { name: "„Warum stempeln?“ ansehen" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Das Gesetz verlangt es");
    expect(dialog).toHaveTextContent("Jede Minute zählt für dein Konto");
    expect(savePreferences).not.toHaveBeenCalled();
    expect(fetchTimeEntryReaders).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers no reopen button to a person who cannot clock for themself", async () => {
    authState.set(["time-entry:read:EIGENE"]);
    renderWithTheme(TimeEntryReadersSettings, {});
    await screen.findByText("Admin");
    expect(
      screen.queryByRole("button", { name: "„Warum stempeln?“ ansehen" }),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when no other role can read the times", async () => {
    fetchTimeEntryReaders.mockResolvedValue({ groups: [], connectedPrograms: false });
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(
      await screen.findByText("Gerade kann keine andere Rolle deine Zeiteinträge lesen."),
    ).toBeInTheDocument();
  });

  it("shows an error with a retry that asks the server again", async () => {
    fetchTimeEntryReaders.mockRejectedValueOnce(new Error("boom"));
    renderWithTheme(TimeEntryReadersSettings, {});
    expect(await screen.findByText(/Die Liste konnte nicht abgerufen werden/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Erneut versuchen/ }));
    await waitFor(() => expect(fetchTimeEntryReaders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });
});
