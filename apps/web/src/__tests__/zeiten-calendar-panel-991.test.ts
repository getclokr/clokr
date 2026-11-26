// Issue #991 N-10, N-11, N-12, N-13 (D-991-08, D-991-09, D-991-10) - Ich > Zeiten, calendar and day panel.
//
//   N-10  a zero day difference ("+0:00") on the chosen day was invisible: balClass(0) is "", the
//         desk override of the selected cell recoloured only `.day-bal.pos` / `.day-bal.neg`, so the
//         shared recipe's `--brand-ink` (meant for a brand-filled cell) stayed on a `--card` surface.
//   N-11  a contract day off (Soll 0, no holiday, no absence) was not tinted, only Sa/So were.
//   N-12  neither the head nor the phone dock may offer "Zeit nachtragen" in a closed month.
//   N-13  one edit path per action: a day with one closed entry has the row menu, not a second
//         "Bearbeiten" in the day panel footer; the Kalender/Liste switch is written into the URL.
//
// The CSS claim is proven on the page's real style block with a control; the rest on the mounted page.
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const replaceStateSpy = vi.fn();

const pageMock = vi.hoisted(() => ({
  url: new URL("http://localhost/time-entries"),
  params: {} as Record<string, string>,
  state: {} as Record<string, unknown>,
}));

vi.mock("$app/state", () => ({ page: pageMock }));

vi.mock("$app/navigation", () => ({
  goto: () => Promise.resolve(),
  afterNavigate: () => {},
  replaceState: (...args: unknown[]) => replaceStateSpy(...args),
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

const ENTRY_ID = "5d1c7e2a-3b4f-4c8d-9e0a-1b2c3d4e5f60";

// Local wall-clock instants, so every expectation holds in any time zone.
const local = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m, 0);

const closedEntry = (day: number, extra: Record<string, unknown> = {}) => ({
  id: ENTRY_ID,
  date: `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  startTime: local(day, 8, 0).toISOString(),
  endTime: local(day, 16, 0).toISOString(),
  breakMinutes: 30,
  breaks: [],
  type: "WORK",
  source: "MANUAL",
  note: null,
  salonId: null,
  salonName: null,
  ...extra,
});

// Tue-Fri 8 h: Monday is a contract day off, Sa/So are weekend.
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

const SHIFT_BASED = { ...FIXED_TUE_FRI, type: "SHIFT_BASED" };

function serve(
  entries: unknown[],
  opts: { schedule?: Record<string, unknown>; monthSaldo?: Record<string, unknown> } = {},
) {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/time-entries")) return Promise.resolve(entries);
    if (path.startsWith("/day-breaks/checks")) return Promise.resolve({ days: [] });
    if (path.startsWith("/settings/work/")) return Promise.resolve(opts.schedule ?? FIXED_TUE_FRI);
    if (path.startsWith("/overtime/month-saldo/")) {
      return Promise.resolve(
        opts.monthSaldo ?? {
          closed: false,
          expectedMinutes: 0,
          workedMinutes: 0,
          balanceMinutes: 0,
          days: [],
        },
      );
    }
    if (path.startsWith("/shifts/range")) return Promise.resolve([]);
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
    Promise.resolve({ findings: [], warnings: [], autoBreak: null }),
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  replaceStateSpy.mockReset();
  pageMock.url = new URL("http://localhost/time-entries");
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment; the page tolerates it */
  }
  // A `date` parameter scrolls its row into view; jsdom has no layout and no such method.
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(local(25, 12, 3));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── N-10: the zero difference of the chosen day ─────────────────────────────

interface ZeroRule {
  zeroIndex: number;
  posIndex: number;
  color: string | null;
}

/** Finds the desk rule for a selected cell's balance WITHOUT a `.pos`/`.neg` class, and where it
 *  sits relative to the `.pos` rule (source order decides at equal specificity). */
function zeroBalanceRule(css: string): ZeroRule {
  const root = postcss.parse(css);
  const SEL = ".te-split--desk .cal-grid--compact .cal-cell.cal-selected:not(.cal-other) .day-bal";
  let index = 0;
  let zeroIndex = -1;
  let posIndex = -1;
  let color: string | null = null;
  root.walkRules((rule) => {
    index += 1;
    const selectors = rule.selectors.map((s) => s.replace(/\s+/g, " ").trim());
    if (selectors.includes(SEL)) {
      zeroIndex = index;
      rule.walkDecls("color", (d) => {
        color = d.value;
      });
    }
    if (selectors.includes(`${SEL}.pos`)) posIndex = index;
  });
  return { zeroIndex, posIndex, color };
}

describe("Zeiten, N-10: a zero day difference stays readable on the chosen day", () => {
  const css = styleBlockOf(pageSource);

  it("a rule for the chosen cell's balance without pos/neg sets the neutral text colour, before the pos rule", () => {
    const rule = zeroBalanceRule(css);
    expect(rule.zeroIndex).toBeGreaterThan(0);
    expect(rule.posIndex).toBeGreaterThan(0);
    expect(rule.zeroIndex).toBeLessThan(rule.posIndex);
    expect(String(rule.color).replace(/\s*!important/, "")).toBe("var(--text-2)");
  });

  it("control: a copy of the style block without that rule is reported as missing", () => {
    const stripped = css.replace(
      /\.te-split--desk \.cal-grid--compact \.cal-cell\.cal-selected:not\(\.cal-other\) \.day-bal \{[^}]*\}/,
      "",
    );
    expect(stripped).not.toBe(css);
    expect(zeroBalanceRule(stripped).zeroIndex).toBe(-1);
  });
});

// ── N-11: a contract day off is tinted ──────────────────────────────────────

describe("Zeiten, N-11: a contract day off is tinted like the weekend", () => {
  it("Mondays carry te-nosoll, Saturdays/Sundays and working days do not", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    const monday = await screen.findByTestId("calendar-cell-2026-11-02");
    expect(monday.classList.contains("te-nosoll")).toBe(true);
    expect(screen.getByTestId("calendar-cell-2026-11-16").classList.contains("te-nosoll")).toBe(
      true,
    );
    const saturday = screen.getByTestId("calendar-cell-2026-11-07");
    expect(saturday.classList.contains("cal-weekend")).toBe(true);
    expect(saturday.classList.contains("te-nosoll")).toBe(false);
    expect(screen.getByTestId("calendar-cell-2026-11-03").classList.contains("te-nosoll")).toBe(
      false,
    );
  });

  it("the style block tints it (desk and phone), and the legend knows it", () => {
    const css = styleBlockOf(pageSource);
    expect(css).toMatch(
      /\.te-split--desk \.cal-cell\.te-nosoll:not\(\.cal-other\):not\(\.cal-selected\)/,
    );
    expect(css).toMatch(/\.cal-cell\.te-nosoll:not\(\.cal-other\):not\(\.cal-selected\)\s*\{/);
    expect(pageSource).toMatch(/d\.expectedMin === 0/);
  });
});

// ── N-12: no add in a closed month ──────────────────────────────────────────

describe("Zeiten, N-12: no „Zeit nachtragen“ in a closed month", () => {
  it("an open month offers exactly one add button", async () => {
    serve([]);
    renderWithTheme(TimeEntriesPage, {});
    await screen.findByTestId("calendar-grid");
    expect(await screen.findAllByTestId("time-entries-add")).toHaveLength(1);
  });

  it("monthSaldo.closed hides it, the PDF button stays", async () => {
    serve([], {
      schedule: SHIFT_BASED,
      monthSaldo: {
        closed: true,
        expectedMinutes: 0,
        workedMinutes: 0,
        balanceMinutes: 0,
        days: [],
      },
    });
    renderWithTheme(TimeEntriesPage, {});
    await screen.findByTestId("time-entries-pdf");
    await waitFor(() =>
      expect(apiGet.mock.calls.some(([p]) => String(p).startsWith("/overtime/month-saldo/"))).toBe(
        true,
      ),
    );
    await screen.findByTestId("calendar-grid");
    expect(screen.queryByTestId("time-entries-add")).toBeNull();
  });

  it("a locked entry of the month hides it as well (schedules without a month saldo)", async () => {
    serve([closedEntry(10, { isLocked: true })]);
    renderWithTheme(TimeEntriesPage, {});
    await screen.findByTestId("time-entries-pdf");
    await screen.findByTestId("calendar-cell-2026-11-10");
    await waitFor(() => expect(screen.queryByTestId("time-entries-add")).toBeNull());
  });
});

// ── N-13: one edit path, the view survives a reload ─────────────────────────

describe("Zeiten, N-13: one way per action, the view in the URL", () => {
  it("a day with one closed entry has no footer „Bearbeiten“; the row menu is the edit path", async () => {
    serve([closedEntry(10)]);
    renderWithTheme(TimeEntriesPage, {});
    await fireEvent.click(await screen.findByTestId("calendar-cell-2026-11-10"));
    await screen.findByTestId(`day-panel-entry-${ENTRY_ID}-menu`);
    expect(screen.queryByTestId("day-sheet-primary")).toBeNull();
  });

  it("an empty past day still offers „Zeit nachtragen“ in the panel", async () => {
    serve([closedEntry(10)]);
    renderWithTheme(TimeEntriesPage, {});
    await fireEvent.click(await screen.findByTestId("calendar-cell-2026-11-12"));
    const primary = await screen.findByTestId("day-sheet-primary");
    expect(primary.textContent).toContain("Zeit nachtragen");
  });

  it("switching to Liste writes view=list, back to Kalender removes it; other params stay", async () => {
    pageMock.url = new URL("http://localhost/time-entries?date=2026-11-10&highlightX=1");
    serve([closedEntry(10)]);
    renderWithTheme(TimeEntriesPage, {});
    await screen.findByTestId("calendar-grid");
    replaceStateSpy.mockClear();

    await fireEvent.click(screen.getByLabelText("Liste"));
    await waitFor(() => expect(replaceStateSpy).toHaveBeenCalled());
    const listUrl = new URL(String(replaceStateSpy.mock.calls.at(-1)![0]), "http://localhost");
    expect(listUrl.searchParams.get("view")).toBe("list");
    expect(listUrl.searchParams.get("date")).toBe("2026-11-10");
    expect(listUrl.searchParams.get("highlightX")).toBe("1");

    // The page's own state is what the next read sees.
    pageMock.url = listUrl;
    await fireEvent.click(screen.getByLabelText("Kalender"));
    await waitFor(() => {
      const last = new URL(String(replaceStateSpy.mock.calls.at(-1)![0]), "http://localhost");
      expect(last.searchParams.has("view")).toBe(false);
      expect(last.searchParams.get("date")).toBe("2026-11-10");
    });
  });

  it("the first render does not write the URL back", async () => {
    pageMock.url = new URL("http://localhost/time-entries?view=list");
    serve([closedEntry(10)]);
    renderWithTheme(TimeEntriesPage, {});
    await screen.findByTestId("time-entries-view-tabs");
    await new Promise((r) => setTimeout(r, 20));
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
