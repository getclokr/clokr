// Issue #1079 - the Betriebsurlaub detail page shows and edits the salons: a row the caller cannot manage is
// read-only with a note, a changed scope goes into the PATCH as `salonIds` (and nothing else changes the body),
// and an unchanged scope sends none.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";

const get = vi.fn();
const patch = vi.fn();
const success = vi.fn();

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/verwalten/regeln/betriebsurlaub/s1"),
    params: { id: "s1" },
    state: {},
  },
}));
vi.mock("$api/client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
    post: vi.fn(),
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
  toasts: { success: (m: string, d?: number) => success(m, d), error: vi.fn(), info: vi.fn() },
}));
vi.mock("$stores/salon-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$stores/salon-context")>();
  const { writable } = await import("svelte/store");
  return {
    ...actual,
    salonContext: writable({ ...actual.salonContext.peek(), isMultiSalon: true }),
  };
});

import { renderWithTheme } from "$tests/test-utils";
import Page from "../routes/(app)/admin/shutdowns/[id]/+page.svelte";
import type { CompanyShutdown, ShutdownScope } from "$lib/settings/betriebsurlaub";

const SCOPE: ShutdownScope = {
  canManageAllSalons: true,
  salons: [
    { id: "a", name: "Salon Nord" },
    { id: "b", name: "Salon Süd" },
  ],
};

function shutdown(over: Partial<CompanyShutdown> = {}): CompanyShutdown {
  return {
    id: "s1",
    name: "Inventur",
    startDate: "2026-12-24T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    deductsFromVacation: true,
    notes: null,
    exceptions: [],
    salons: [{ id: "a", name: "Salon Nord", isActive: true }],
    canManage: true,
    ...over,
  };
}

function serve(row: CompanyShutdown) {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith("/employees")
        ? { employees: [] }
        : path === "/company-shutdowns/scope"
          ? SCOPE
          : [row],
    ),
  );
}

async function mount() {
  renderWithTheme(Page, {});
  await screen.findByRole("heading", { level: 1, name: "Inventur" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Betriebsurlaub detail with salons", () => {
  it("shows the scope chips and the scope control with the stored salons ticked", async () => {
    serve(shutdown());
    patch.mockResolvedValue(shutdown());
    await mount();
    expect(screen.getAllByText("Salon Nord").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Ausgewählte Salons") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Salon Nord") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Salon Süd") as HTMLInputElement).checked).toBe(false);
  });

  it("a changed scope is sent as salonIds and the booking toast follows", async () => {
    serve(shutdown());
    patch.mockResolvedValue(
      shutdown({
        salons: [
          { id: "a", name: "Salon Nord", isActive: true },
          { id: "b", name: "Salon Süd", isActive: true },
        ],
        booking: {
          persons: 3,
          absencesWritten: 3,
          vacationApproved: 3,
          vacationPending: 0,
          paidReleaseOnly: 0,
          partlyPaidRelease: 0,
          outsideCreateReach: 0,
          skippedClosedMonths: 0,
          existingLeavePersons: 0,
          refused: {},
          reversedRequests: 0,
          reversedAbsences: 0,
        },
      }),
    );
    await mount();
    await fireEvent.click(screen.getByLabelText("Salon Süd"));
    await fireEvent.click(screen.getByRole("button", { name: "Betriebsurlaub speichern" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(JSON.stringify(patch.mock.calls[0][1]));
    expect(body.salonIds.sort()).toEqual(["a", "b"]);
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success.mock.calls[0][0]).toContain("3 Urlaubsanträge genehmigt");
  });

  it("an unchanged scope sends no salonIds", async () => {
    serve(shutdown());
    patch.mockResolvedValue(shutdown({ name: "Inventur 2" }));
    await mount();
    await fireEvent.input(screen.getByLabelText(/^Bezeichnung/), {
      target: { value: "Inventur 2" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Betriebsurlaub speichern" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(patch.mock.calls[0][1]))).not.toHaveProperty("salonIds");
  });

  it("switching to the whole Unternehmen sends an empty list", async () => {
    serve(shutdown());
    patch.mockResolvedValue(shutdown({ salons: [] }));
    await mount();
    await fireEvent.click(screen.getByLabelText("Ganzes Unternehmen"));
    await fireEvent.click(screen.getByRole("button", { name: "Betriebsurlaub speichern" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(patch.mock.calls[0][1])).salonIds).toEqual([]);
  });

  it("a row the caller cannot manage is read-only with a note and no actions", async () => {
    serve(shutdown({ canManage: false }));
    await mount();
    expect(screen.getByText(/verwaltet, wer für alle seine Salons/)).toBeTruthy();
    expect((screen.getByLabelText(/^Bezeichnung/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Ausgewählte Salons")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ausnahme hinzufügen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Betriebsurlaub löschen" })).toBeNull();
  });
});
