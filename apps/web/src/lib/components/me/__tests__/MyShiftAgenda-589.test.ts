// Issue #589 (D-589-09, D-589-10, D-589-11; AC-589-5, AC-589-6) — Ich › Dienstplan.
//
// Before the salon context has loaded, `homeSalonId` is null and the names map is empty, so every shift
// was named „anderer Salon“ and no holiday was requested (the root cause the owner saw on 15.11.2026).
// The component therefore waits for `$salonContext.loaded`, names a shift's salon from the context
// salons, fetches the own contract and full ISO weeks of shifts, and tells „Frei“ from „Noch nicht
// geplant“.
const apiGet = vi.fn();

vi.mock("$api/client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public data?: unknown,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      get: (...args: unknown[]) => apiGet(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return { authStore: writable({ user: { employeeId: "e1" } }) };
});

vi.mock("$lib/utils/logger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { salonContext } from "$stores/salon-context";
import MyShiftAgenda from "../MyShiftAgenda.svelte";

const FIXED_MO_FR = {
  type: "FIXED_SCHEDULE",
  validFrom: "2024-01-01T00:00:00.000Z",
  mondayHours: 8,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 8,
  fridayHours: 8,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
};

function answer(path: string): Promise<unknown> {
  if (path === "/me/context") {
    return Promise.resolve({
      tenant: { id: "t1", name: "Clokr Demo" },
      isMultiSalon: true,
      homeSalonId: "nord",
      salons: [
        { id: "nord", name: "Clokr Demo Nord" },
        { id: "haupt", name: "Clokr Demo Haupt" },
      ],
    });
  }
  if (path.startsWith("/shifts/range")) {
    return Promise.resolve([
      {
        date: "2026-11-12",
        startTime: "10:00",
        endTime: "18:30",
        durationMinNetto: 480,
        salonId: "haupt",
      },
    ]);
  }
  if (path.startsWith("/leave/requests")) return Promise.resolve([]);
  if (path.startsWith("/holidays")) return Promise.resolve([]);
  if (path === "/employees/e1") return Promise.resolve({ workSchedule: FIXED_MO_FR });
  return Promise.reject(new Error(`unexpected request ${path}`));
}

beforeEach(() => {
  // Wed 11.11.2026: the 14 days end Tue 24.11.; its ISO week ends Sun 29.11.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
  apiGet.mockReset();
  apiGet.mockImplementation((path: string) => answer(path));
  salonContext.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const calls = (prefix: string) =>
  apiGet.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith(prefix));

describe("Ich › Dienstplan (Issue #589)", () => {
  it("requests nothing before the salon context has loaded, then once, over full ISO weeks", async () => {
    renderWithTheme(MyShiftAgenda, {});
    // The store is not loaded: no request of the component yet (it is still skeleton).
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("/shifts/range")).toEqual([]);
    expect(calls("/employees/")).toEqual([]);

    await salonContext.load("u1", { force: true });
    await screen.findByTestId("agenda-2026-11-12");

    expect(calls("/shifts/range")).toEqual(["/shifts/range?from=2026-11-09&to=2026-11-29"]);
    expect(calls("/employees/")).toEqual(["/employees/e1"]);
  });

  it("names a readable salon by its name and never as „anderer Salon“", async () => {
    await salonContext.load("u1", { force: true });
    renderWithTheme(MyShiftAgenda, {});
    const row = await screen.findByTestId("agenda-2026-11-12");
    expect(row.textContent).toContain("Clokr Demo Haupt");
    expect(row.textContent).not.toContain("anderer Salon");
  });

  it("reads a contract workday without a shift as „Noch nicht geplant“ and a weekend day as „Frei“", async () => {
    await salonContext.load("u1", { force: true });
    renderWithTheme(MyShiftAgenda, {});
    await screen.findByTestId("agenda-2026-11-12");
    await waitFor(() => {
      expect(screen.getByTestId("agenda-2026-11-13").textContent).toContain("Noch nicht geplant");
    });
    expect(screen.getByTestId("agenda-2026-11-14").textContent).toContain("Frei");
    expect(screen.getByTestId("agenda-2026-11-14").textContent).not.toContain("Noch nicht geplant");
  });
});
