// Issue #1011 (e) (b) - on Ich > Zeiten a phone showed „Zeit nachtragen“ as a floating button
// (position: fixed, 16 px side margins) that lay over mid-page content: the first calendar row at
// scroll 0, the start of the list. Bottom padding cannot prevent that - it only clears the END of
// the page. The fix docks the button: a full-width, OPAQUE bar directly on the tab bar, and the
// page reserves the bar's height, so the visible page simply ends at the bar's top edge.
//
// Each claim is proven where it is provable:
//   1. MOUNTED (the real page): under a phone matchMedia the one `time-entries-add` button lives
//      inside the dock, outside `.page-head` and any `.card-animate` ancestor (a transformed
//      ancestor would become the containing block of a fixed element, app.css #570); it opens the
//      add dialog. Wide (jsdom default, no matchMedia) it stays in the page head and no dock exists.
//   2. MEASURED with the shared media-query-probe on the page's own style block: at 390 px the dock
//      is fixed, full width, 60 px high, on the card surface with a line border on top, and
//      `.te-page` reserves at least that height; at 1024 px the dock rules do not exist.
//      Controls: a positive one (the dock differs from a class-less element) and a negative one
//      (an invented class computes static).
//   3. NOT provable in jsdom: real layout and geometry (nothing visible under or beside the bar at
//      any scroll position). That is what the owner screenshots of the quick task prove.
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost/time-entries?view=list"), params: {}, state: {} },
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
import { cleanup, fireEvent, screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { ApiError } from "$api/client";
import { INVENTED_CLASS, cssForViewport, probeAt, styleBlockOf } from "$tests/media-query-probe";
import TimeEntriesPage from "../routes/(app)/time-entries/+page.svelte";
import pageSource from "../routes/(app)/time-entries/+page.svelte?raw";

const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1024;

function serve() {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith("/time-entries")) return Promise.resolve([]);
    if (path.startsWith("/day-breaks/checks")) return Promise.resolve({ days: [] });
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

/** Only the phone query matches; every other query (reduced motion, …) reports false. */
function stubPhone() {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query === "(max-width: 760px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  serve();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment; the page tolerates it */
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The shared probe does not clean up after itself.
  document.head.querySelectorAll("style").forEach((s) => s.remove());
  document.body.innerHTML = "";
});

describe("Zeiten - the add action on a phone (mounted page)", () => {
  it("renders one add button, inside the dock, outside the page head and any card-animate", async () => {
    stubPhone();
    renderWithTheme(TimeEntriesPage, {});
    const dock = await screen.findByTestId("time-entries-add-dock");
    const adds = screen.getAllByTestId("time-entries-add");
    expect(adds).toHaveLength(1);
    expect(dock.contains(adds[0])).toBe(true);
    expect(adds[0].closest(".card-animate")).toBeNull();
    expect(adds[0].closest(".page-head")).toBeNull();
    expect(dock.closest(".card-animate")).toBeNull();
    expect(adds[0].textContent?.trim()).toBe("Zeit nachtragen");
  });

  it("the docked button opens the add dialog", async () => {
    stubPhone();
    renderWithTheme(TimeEntriesPage, {});
    await fireEvent.click(await screen.findByTestId("time-entries-add"));
    expect(await screen.findByTestId("time-entry-modal-save")).toBeTruthy();
  });
});

describe("Zeiten - the add action on a wide screen (mounted page)", () => {
  it("keeps the one add button in the page head and renders no dock", async () => {
    renderWithTheme(TimeEntriesPage, {});
    const add = await screen.findByTestId("time-entries-add");
    expect(screen.getAllByTestId("time-entries-add")).toHaveLength(1);
    expect(add.closest(".page-head-actions")).not.toBeNull();
    expect(screen.queryByTestId("time-entries-add-dock")).toBeNull();
  });
});

describe("Zeiten - the dock CSS (measured with the shared probe)", () => {
  const block = () => styleBlockOf(pageSource);
  const px = (value: string) => parseFloat(value);

  it("at 390 px the dock is a fixed, full-width, 60 px bar on the card surface", () => {
    const css = cssForViewport(block(), PHONE_WIDTH);
    const probe = probeAt(PHONE_WIDTH, css);
    const dock = probe.styles("te-add-dock", "div");
    expect(dock.position).toBe("fixed");
    expect(px(dock.left)).toBe(0);
    expect(px(dock.right)).toBe(0);
    expect(dock.height).toBe("60px");
    // Computed value vs. source: jsdom does not resolve var() into a colour, so the surface is
    // asserted on the flattened 390 px CSS text instead of on getComputedStyle.
    expect(css).toMatch(/\.te-add-dock\s*\{[^}]*background:\s*var\(--card\)/);
    expect(css).toMatch(/\.te-add-dock\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
    // Directly below the tab bar's z-index (90), so its top hairline draws over the dock edge.
    expect(css).toMatch(/\.te-add-dock\s*\{[^}]*z-index:\s*85/);
  });

  it("at 390 px the page reserves at least the dock height at its bottom", () => {
    const probe = probeAt(PHONE_WIDTH, cssForViewport(block(), PHONE_WIDTH));
    const dock = probe.styles("te-add-dock", "div");
    const page = probe.styles("te-page", "div");
    expect(px(page.paddingBottom)).toBeGreaterThanOrEqual(px(dock.height));
  });

  it("at 1024 px the dock rules do not exist", () => {
    const css = cssForViewport(block(), DESKTOP_WIDTH);
    const probe = probeAt(DESKTOP_WIDTH, css);
    expect(probe.styles("te-add-dock", "div").position).not.toBe("fixed");
    expect(css).not.toContain(".te-add-dock");
  });

  it("control: the dock differs from a class-less element at 390 px (positive)", () => {
    const probe = probeAt(PHONE_WIDTH, cssForViewport(block(), PHONE_WIDTH));
    expect(probe.styles("te-add-dock", "div").position).not.toBe(
      probe.styles(INVENTED_CLASS, "div").position,
    );
  });

  it("control: an invented class computes static (negative)", () => {
    const probe = probeAt(PHONE_WIDTH, cssForViewport(block(), PHONE_WIDTH));
    expect(probe.styles(INVENTED_CLASS, "div").position).toBe("static");
  });
});
