// Issue #1079 - the „Betriebsurlaub“ tab names the salons of a Betriebsurlaub: the „Gilt für“ column and its
// chips exist only in a Unternehmen with several salons, a row the caller cannot manage has no delete action, and
// the create dialog offers the scope within the reach `GET /company-shutdowns/scope` reports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/svelte";

const get = vi.fn();
const post = vi.fn();
const gotoMock = vi.fn();

vi.mock("$app/navigation", () => ({
  goto: (...a: unknown[]) => gotoMock(...a),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock("$api/client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("$stores/toast", () => ({
  toasts: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// A plain writable stands in for the salon context so a test can switch `isMultiSalon`.
vi.mock("$stores/salon-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$stores/salon-context")>();
  const { writable } = await import("svelte/store");
  return { ...actual, salonContext: writable({ ...actual.salonContext.peek() }) };
});

import { renderWithTheme } from "$tests/test-utils";
import type { Writable } from "svelte/store";
import { salonContext, type SalonContextState } from "$stores/salon-context";
import type { CompanyShutdown, ShutdownScope } from "$lib/settings/betriebsurlaub";
import BetriebsurlaubPanel from "../BetriebsurlaubPanel.svelte";

const NOW = new Date("2026-11-24T12:00:00.000Z");

const row = (over: Partial<CompanyShutdown>): CompanyShutdown => ({
  id: "x",
  name: "X",
  startDate: "2026-12-24T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  deductsFromVacation: true,
  notes: null,
  exceptions: [],
  salons: [],
  canManage: true,
  ...over,
});

const SHUTDOWNS: CompanyShutdown[] = [
  row({ id: "wide", name: "Ganzer Betrieb" }),
  row({
    id: "nord",
    name: "Inventur Nord",
    salons: [
      { id: "a", name: "Salon Nord", isActive: true },
      { id: "c", name: "Salon Alt", isActive: false },
    ],
  }),
  row({
    id: "sued",
    name: "Umbau Süd",
    salons: [{ id: "b", name: "Salon Süd", isActive: true }],
    canManage: false,
  }),
];

function serve(scope: ShutdownScope) {
  get.mockImplementation((path: string) =>
    Promise.resolve(path === "/company-shutdowns/scope" ? scope : SHUTDOWNS),
  );
}

function setMultiSalon(isMultiSalon: boolean) {
  // The mocked store is a plain writable (see the vi.mock above).
  (salonContext as unknown as Writable<SalonContextState>).update((state) => ({
    ...state,
    isMultiSalon,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  post.mockResolvedValue({ id: "new1" });
});

afterEach(() => {
  vi.useRealTimers();
  setMultiSalon(false);
});

describe("the list", () => {
  it("shows „Gilt für“ with chips in a Unternehmen with several salons", async () => {
    setMultiSalon(true);
    serve({ canManageAllSalons: true, salons: [] });
    renderWithTheme(BetriebsurlaubPanel, { active: true });
    const table = await screen.findByRole("table", { name: /Betriebsurlaub \d{4}/ });
    expect(within(table).getByText("Gilt für")).toBeTruthy();
    expect(within(table).getByText("Ganzes Unternehmen")).toBeTruthy();
    expect(within(table).getByText("Salon Nord")).toBeTruthy();
    expect(within(table).getByText("Salon Alt (deaktiviert)")).toBeTruthy();
    expect(within(table).getByText("Salon Süd")).toBeTruthy();
  });

  it("shows no scope column in a single-salon Unternehmen", async () => {
    setMultiSalon(false);
    serve({ canManageAllSalons: true, salons: [] });
    renderWithTheme(BetriebsurlaubPanel, { active: true });
    const table = await screen.findByRole("table", { name: /Betriebsurlaub \d{4}/ });
    expect(within(table).queryByText("Gilt für")).toBeNull();
    expect(within(table).queryByText("Ganzes Unternehmen")).toBeNull();
  });

  it("a row the caller cannot manage has no delete action", async () => {
    setMultiSalon(true);
    serve({ canManageAllSalons: false, salons: [{ id: "a", name: "Salon Nord" }] });
    renderWithTheme(BetriebsurlaubPanel, { active: true });
    const table = await screen.findByRole("table", { name: /Betriebsurlaub \d{4}/ });
    const rows = within(table).getAllByRole("row");
    const rowOf = (name: string) => rows.find((r) => r.textContent?.includes(name)) as HTMLElement;
    expect(
      within(rowOf("Inventur Nord")).queryByRole("button", { name: "Löschen" }),
    ).not.toBeNull();
    expect(within(rowOf("Umbau Süd")).queryByRole("button", { name: "Löschen" })).toBeNull();
  });
});

describe("the create dialog", () => {
  async function openDialog(scope: ShutdownScope) {
    setMultiSalon(true);
    serve(scope);
    renderWithTheme(BetriebsurlaubPanel, { active: true });
    await screen.findByRole("table", { name: /Betriebsurlaub \d{4}/ });
    await fireEvent.click(screen.getByRole("button", { name: "Betriebsurlaub anlegen" }));
    return await screen.findByRole("dialog");
  }

  async function fill(dialog: HTMLElement) {
    await fireEvent.input(within(dialog).getByLabelText(/^Bezeichnung/), {
      target: { value: "Inventur" },
    });
    await fireEvent.input(within(dialog).getByLabelText(/^Startdatum/), {
      target: { value: "2026-08-03" },
    });
    await fireEvent.input(within(dialog).getByLabelText(/^Enddatum/), {
      target: { value: "2026-08-04" },
    });
  }

  it("a whole-tenant caller defaults to the whole Unternehmen and sends no salons", async () => {
    const dialog = await openDialog({
      canManageAllSalons: true,
      salons: [
        { id: "a", name: "Salon Nord" },
        { id: "b", name: "Salon Süd" },
      ],
    });
    expect((within(dialog).getByLabelText("Ganzes Unternehmen") as HTMLInputElement).checked).toBe(
      true,
    );
    await fill(dialog);
    await fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).not.toHaveProperty("salonIds");
  });

  it("choosing salons needs at least one and then sends exactly those", async () => {
    const dialog = await openDialog({
      canManageAllSalons: true,
      salons: [
        { id: "a", name: "Salon Nord" },
        { id: "b", name: "Salon Süd" },
      ],
    });
    await fill(dialog);
    await fireEvent.click(within(dialog).getByLabelText("Ausgewählte Salons"));
    await fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    expect(await within(dialog).findByText("Wähle mindestens einen Salon.")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByLabelText("Salon Süd"));
    await fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toMatchObject({ salonIds: ["b"] });
  });

  it("a scoped caller with one salon sees it fixed, no „Ganzes Unternehmen“, and sends it", async () => {
    const dialog = await openDialog({
      canManageAllSalons: false,
      salons: [{ id: "a", name: "Salon Nord" }],
    });
    expect(within(dialog).queryByLabelText("Ganzes Unternehmen")).toBeNull();
    expect(within(dialog).getByTestId("abwesenheiten-betriebsurlaub-scope-fixed").textContent).toBe(
      "Salon Nord",
    );
    await fill(dialog);
    await fireEvent.click(within(dialog).getByRole("button", { name: "Anlegen" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toMatchObject({ salonIds: ["a"] });
  });

  it("a scoped caller with several salons never gets „Ganzes Unternehmen“", async () => {
    const dialog = await openDialog({
      canManageAllSalons: false,
      salons: [
        { id: "a", name: "Salon Nord" },
        { id: "b", name: "Salon Süd" },
      ],
    });
    expect(within(dialog).queryByLabelText("Ganzes Unternehmen")).toBeNull();
    expect(within(dialog).getByLabelText("Salon Nord")).toBeTruthy();
    expect(within(dialog).getByLabelText("Salon Süd")).toBeTruthy();
  });
});
