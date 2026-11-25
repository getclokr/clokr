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

import TimeEntryReadersSettings from "../TimeEntryReadersSettings.svelte";

beforeEach(() => {
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
    expect(await screen.findByText(/Die Liste ließ sich nicht laden/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Erneut versuchen/ }));
    await waitFor(() => expect(fetchTimeEntryReaders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });
});
