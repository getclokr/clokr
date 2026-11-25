// Issue #991 N-09 / M-44, M-45, N-14 (D-991-06, D-991-07) - the „Zeit nachtragen“ dialog on Ich > Zeiten.
//
//   N-09/M-44  a NEW single entry on an empty day starts from the person's usual day (breaks copied),
//              else from the contract hours of that weekday, else 09:00-17:00; one visible line says
//              which, so a prefilled form is never saved unseen.
//   M-45       the end checkbox sits UNDER the Arbeitsende field with its full label, and only where an
//              open end is possible (today, or an entry that is open already).
//   N-14       both time labels sit on one baseline (plain labels in their group) and the dialog's
//              groups share one vertical gap.
//
// The ArbZG findings come from the server's day preview; the browser computes none. The test checks
// that the preview body carries the complete prefilled day, which is what the server judges.
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost/time-entries"), params: {}, state: {} },
}));

vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return {
    authStore: writable({
      user: { id: "u1", employeeId: "emp-1", permissions: [] },
    }),
  };
});

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
      post: (...args: unknown[]) => apiPost(...args),
      put: (...args: unknown[]) => apiPut(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("$lib/utils/logger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import postcss from "postcss";
import { renderWithTheme } from "$tests/test-utils";
import { ApiError } from "$api/client";
import { styleBlockOf } from "$tests/media-query-probe";
import TimeEntriesPage from "../routes/(app)/time-entries/+page.svelte";
import pageSource from "../routes/(app)/time-entries/+page.svelte?raw";

// Local wall-clock instants, so every expectation holds in any time zone.
const local = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m, 0);
const dateOf = (day: number) => `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const USUAL = {
  id: "5d1c7e2a-3b4f-4c8d-9e0a-1b2c3d4e5f60",
  date: dateOf(10),
  startTime: local(10, 9, 0).toISOString(),
  endTime: local(10, 17, 30).toISOString(),
  breakMinutes: 30,
  breaks: [{ startTime: local(10, 12, 30).toISOString(), endTime: local(10, 13, 0).toISOString() }],
  type: "WORK",
  source: "MANUAL",
  note: null,
  salonId: null,
  salonName: null,
};

const OPEN_YESTERDAY = {
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  date: dateOf(24),
  startTime: local(24, 8, 0).toISOString(),
  endTime: null,
  breakMinutes: 0,
  breaks: [],
  type: "WORK",
  source: "MANUAL",
  note: null,
  salonId: null,
  salonName: null,
};

// Tue-Fri 8 h.
const FIXED_TUE_FRI = {
  type: "FIXED_SCHEDULE",
  mondayHours: 0,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 8,
  fridayHours: 8,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [2, 3, 4, 5],
};

function serve(entries: unknown[]) {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/time-entries")) return Promise.resolve(entries);
    if (path.startsWith("/day-breaks/checks")) return Promise.resolve({ days: [] });
    if (path.startsWith("/settings/work/")) return Promise.resolve(FIXED_TUE_FRI);
    if (path.startsWith("/employees/")) {
      return Promise.resolve({ hireDate: "2026-01-01T00:00:00.000Z", isTimeTrackingExempt: false });
    }
    if (path === "/settings/work") return Promise.resolve({ arbzgEnabled: true });
    if (path.startsWith("/holidays") || path.startsWith("/leave/requests")) {
      return Promise.resolve([]);
    }
    if (path.startsWith("/vocational-school")) return Promise.resolve([]);
    return Promise.reject(new ApiError(404, "not part of this test"));
  });
  apiPost.mockImplementation(() =>
    Promise.resolve({ warnings: [], autoBreakApplied: null, findings: [] }),
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment; the page tolerates it */
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(local(25, 12, 3));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openDay(day: number) {
  const cell = await screen.findByTestId(`calendar-cell-2026-11-${String(day).padStart(2, "0")}`);
  await fireEvent.click(cell);
  await fireEvent.click(await screen.findByTestId("day-sheet-primary"));
  await screen.findByTestId("time-entry-modal");
}

const value = (testId: string) => (screen.getByTestId(testId) as HTMLInputElement).value;

describe("Zeit nachtragen - prefill (N-09, M-44)", () => {
  it("an empty day starts from the usual day: times and break copied, the source named", async () => {
    serve([USUAL]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12); // a Thursday without entries
    expect(value("time-entry-modal-start")).toBe("09:00");
    expect(value("time-entry-modal-end")).toBe("17:30");
    expect(value("break-slot-0-start")).toBe("12:30");
    expect(value("break-slot-0-end")).toBe("13:00");
    expect(screen.queryByTestId("break-slot-1")).toBeNull();
    expect(screen.getByTestId("time-entry-modal-prefill-hint").textContent?.trim()).toBe(
      "Vorbelegt wie dein Tag am Di 10.11. – bitte prüfen.",
    );
  });

  it("the server's day preview judges the complete prefilled day, and no finding shows", async () => {
    serve([USUAL]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12);
    await waitFor(() =>
      expect(apiPost.mock.calls.some(([path]) => path === "/day-breaks/preview")).toBe(true),
    );
    const call = apiPost.mock.calls.find(([path]) => path === "/day-breaks/preview")!;
    const body = call[1] as {
      date: string;
      startTime: string;
      endTime: string;
      breaks: { startTime: string; endTime: string }[];
    };
    expect(body.date).toBe("2026-11-12");
    expect(new Date(body.startTime).getTime()).toBe(local(12, 9, 0).getTime());
    expect(new Date(body.endTime).getTime()).toBe(local(12, 17, 30).getTime());
    expect(body.breaks).toHaveLength(1);
    expect(new Date(body.breaks[0].startTime).getTime()).toBe(local(12, 12, 30).getTime());
    expect(new Date(body.breaks[0].endTime).getTime()).toBe(local(12, 13, 0).getTime());
    expect(screen.queryByTestId("time-entry-modal-warnings")).toBeNull();
  });

  it("without a usual day the contract hours of the weekday plus the required break", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12); // Thursday, 8 h
    expect(value("time-entry-modal-start")).toBe("09:00");
    expect(value("time-entry-modal-end")).toBe("17:30");
    // The tenant has no default break start, so the break row is not invented.
    expect(screen.queryByTestId("break-slot-0")).toBeNull();
    expect(screen.getByTestId("time-entry-modal-prefill-hint").textContent?.trim()).toBe(
      "Vorbelegt mit deiner Vertragszeit (8:00 h) – bitte prüfen.",
    );
  });

  it("editing an entry shows no prefill line", async () => {
    serve([USUAL]);
    renderWithTheme(TimeEntriesPage, {});
    await fireEvent.click(await screen.findByTestId("calendar-cell-2026-11-10"));
    await fireEvent.click(await screen.findByTestId(`day-panel-entry-${USUAL.id}-menu`));
    await fireEvent.click(await screen.findByTestId(`day-panel-entry-${USUAL.id}-edit`));
    await screen.findByTestId("time-entry-modal");
    expect(screen.queryByTestId("time-entry-modal-prefill-hint")).toBeNull();
  });
});

describe("Zeit nachtragen - the end toggle (M-45)", () => {
  it("a past empty day has no toggle and an enabled end field", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12);
    expect(screen.queryByTestId("time-entry-modal-end-toggle")).toBeNull();
    expect((screen.getByTestId("time-entry-modal-end") as HTMLInputElement).disabled).toBe(false);
  });

  it("today has it, under the end input, with the full visible label", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(25);
    const toggle = screen.getByTestId("time-entry-modal-end-toggle");
    const end = screen.getByTestId("time-entry-modal-end");
    expect(end.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.closest("label")?.textContent?.trim()).toBe("Arbeitsende erfasst");
    expect(toggle.getAttribute("aria-label")).toBeNull();
  });

  it("an open entry being edited has it, and unchecking it disables the end", async () => {
    serve([OPEN_YESTERDAY]);
    renderWithTheme(TimeEntriesPage, {});
    await fireEvent.click(await screen.findByTestId("calendar-cell-2026-11-24"));
    await fireEvent.click(await screen.findByTestId("day-sheet-primary"));
    const toggle = (await screen.findByTestId("time-entry-modal-end-toggle")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect((screen.getByTestId("time-entry-modal-end") as HTMLInputElement).disabled).toBe(true);
    await fireEvent.click(toggle);
    expect((screen.getByTestId("time-entry-modal-end") as HTMLInputElement).disabled).toBe(false);
  });

  it("moving the date away from today puts the required end back", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(25);
    await fireEvent.click(screen.getByTestId("time-entry-modal-end-toggle"));
    expect((screen.getByTestId("time-entry-modal-end") as HTMLInputElement).disabled).toBe(true);
    await fireEvent.input(screen.getByTestId("time-entry-modal-date"), {
      target: { value: "2026-11-12" },
    });
    await waitFor(() => expect(screen.queryByTestId("time-entry-modal-end-toggle")).toBeNull());
    expect((screen.getByTestId("time-entry-modal-end") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("Zeit nachtragen - the rhythm (N-14)", () => {
  it("both time labels are plain labels of their group; no label row is left", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12);
    for (const forId of ["f-start", "f-end"]) {
      const label = document.querySelector(`label[for="${forId}"]`) as HTMLElement;
      expect(label.classList.contains("form-label")).toBe(true);
      expect(label.parentElement?.classList.contains("form-group")).toBe(true);
    }
    expect(pageSource).not.toContain("form-label-row");
  });

  it("the dialog wrapper is a column with one gap", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await openDay(12);
    expect(screen.getByTestId("time-entry-modal").classList.contains("te-entry-form")).toBe(true);

    let declared: Record<string, string> | null = null;
    postcss.parse(styleBlockOf(pageSource)).walkRules(".te-entry-form", (rule) => {
      declared = {};
      rule.walkDecls((d) => {
        declared![d.prop] = d.value;
      });
    });
    expect(declared).toEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "var(--s-4)",
    });
  });
});
