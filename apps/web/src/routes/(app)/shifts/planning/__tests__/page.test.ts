// Phase 430 (D-12/D-13/D-14, Issue #430) — mounted test for the new Wochenübersicht
// "Planungsbedarf" page. `lib/components/**` conventions apply (lint:ui-classes does not scan
// `routes/**` either), so this mounted test is the only automated net for this page, per
// CLAUDE.md's UI Consistency Rules note.
//
// `$api/client` is mocked directly (same pattern as
// apps/web/src/lib/components/leave/__tests__/LeaveReviewDialog.test.ts) — this page imports no
// `$app/*` module itself, and mocking `$api/client` means `$stores/auth` (and its own
// `$app/env` dependency) never has to be resolved either.

const apiGet = vi.fn();
vi.mock("$api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

// Issue #558 (Plan 558-05): the page now loads only once the salon context has loaded (it sends the
// header salon on the request), and the layout that normally loads it is not mounted here. A loaded,
// single-salon context stands in for it: no salon options, so the page sends no `salonId` and every
// expectation of this file about the table, the pager and the request count stays as it was.
vi.mock("$stores/salon-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$stores/salon-context")>();
  const { writable } = await import("svelte/store");
  return {
    ...actual,
    salonContext: writable({
      loaded: true,
      tenant: null,
      salons: [],
      isMultiSalon: false,
      homeSalonId: null,
      selection: null,
      packages: null,
      roles: [],
    }),
  };
});

// Issue #853 (D-853-05): the page now reads the roster tabs from the signed-in user and the tenant feature
// flag. The auth store imports `$app/env`, which vitest does not resolve, so a salon manager who
// may plan shifts stands in for it (same style as the salon-context mock above); the tenant-features store
// needs no mock (its only request goes through the mocked `$api/client` and is never started here).
vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return {
    authStore: writable({
      accessToken: "t",
      user: {
        id: "u1",
        email: "x@example.test",
        employeeId: "e1",
        firstName: "Test",
        permissions: ["shift:plan:ZUGEWIESEN"],
      },
    }),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import PlanningOverviewPage from "../+page.svelte";

interface PlanningRow {
  employeeId: string;
  name: string;
  contractDays: number;
  leaveDays: number;
  leaveWeekdays: string[];
  otherAbsenceDays: number;
  stillToPlan: number;
  plannedDays?: number;
  difference?: number;
}

function response(weekStart: string, weekEnd: string, employees: PlanningRow[]) {
  return { weekStart, weekEnd, employees };
}

// Issue #1072: the page waits for the tenant zone, so the tenant-features store also reads
// `/settings/work` (once per file: the store is a singleton). The planning answers are therefore
// queued and served by URL, and the request count is the count of planning requests.
let queue: unknown[] = [];
let tenantZone = "Europe/Berlin";
function planning(answer: unknown) {
  queue.push(answer);
}
function planningCalls() {
  return apiGet.mock.calls.filter((c) => String(c[0]).startsWith("/shifts/planning-overview"));
}

beforeEach(() => {
  apiGet.mockReset();
  queue = [];
  apiGet.mockImplementation(async (url: string) =>
    url === "/settings/work" ? { timezone: tenantZone } : queue.shift(),
  );
});
afterEach(() => {
  vi.useRealTimers();
  tenantZone = "Europe/Berlin";
});

describe("Wochenübersicht Planungsbedarf (Phase 430, Issue #430)", () => {
  it("renders the owner's table shape — Person/Vertrag/Urlaub/noch einzuplanen, no geplant/Differenz when absent", async () => {
    planning(
      response("2031-02-03", "2031-02-09", [
        {
          employeeId: "emp-1",
          name: "Lena Beispiel",
          contractDays: 5,
          leaveDays: 2,
          leaveWeekdays: ["Do", "Fr"],
          otherAbsenceDays: 0,
          stillToPlan: 3,
        },
      ]),
    );

    renderWithTheme(PlanningOverviewPage, {});

    await waitFor(() => expect(screen.getByText("Lena Beispiel")).toBeTruthy());
    expect(screen.getByText("5 Tage")).toBeTruthy();
    // Issue #992 (D-992-20): every day figure carries its unit.
    expect(screen.getByText("2 Tage (Do, Fr)")).toBeTruthy();
    expect(screen.getByText("3 Tage")).toBeTruthy();
    // geplant/Differenz columns are absent entirely when no row carries them.
    expect(screen.queryByText("Geplant")).toBeNull();
    expect(screen.queryByText("Differenz")).toBeNull();
  });

  it("shows geplant/Differenz columns once at least one row carries them", async () => {
    planning(
      response("2031-02-03", "2031-02-09", [
        {
          employeeId: "emp-1",
          name: "Lena Beispiel",
          contractDays: 5,
          leaveDays: 2,
          leaveWeekdays: ["Do", "Fr"],
          otherAbsenceDays: 0,
          stillToPlan: 3,
          plannedDays: 3,
          difference: 0,
        },
      ]),
    );

    renderWithTheme(PlanningOverviewPage, {});

    await waitFor(() => expect(screen.getByText("Geplant")).toBeTruthy());
    expect(screen.getByText("Differenz")).toBeTruthy();
    // The difference is signed and carries its unit (Issue #992, D-992-20).
    expect(screen.getByText("0 Tage")).toBeTruthy();
  });

  it("no leave this week -> renders 0, not '0 ()'", async () => {
    planning(
      response("2031-02-03", "2031-02-09", [
        {
          employeeId: "emp-2",
          name: "Sam Null",
          contractDays: 5,
          leaveDays: 0,
          leaveWeekdays: [],
          otherAbsenceDays: 0,
          stillToPlan: 5,
        },
      ]),
    );

    renderWithTheme(PlanningOverviewPage, {});

    await waitFor(() => expect(screen.getByText("Sam Null")).toBeTruthy());
    expect(screen.getByText("0 Tage")).toBeTruthy();
    expect(screen.queryByText(/0 \(/)).toBeNull();
  });

  it("the week picker's next-week arrow re-fetches with a weekStart 7 days later", async () => {
    planning(response("2031-02-03", "2031-02-09", []));
    renderWithTheme(PlanningOverviewPage, {});
    await waitFor(() => expect(planningCalls()).toHaveLength(1));
    // The arrow pages from the week the server answered (it normalises the requested day), so wait
    // until the page shows that answer before paging.
    await waitFor(() => expect(screen.getByText("KW 6 · 3.–9. Feb.")).toBeTruthy());
    const firstWeekStart = "2031-02-03";

    planning(response("x", "y", []));
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));

    await waitFor(() => expect(planningCalls()).toHaveLength(2));
    const secondUrl = planningCalls()[1][0] as string;
    const secondWeekStart = new URL(secondUrl, "http://localhost").searchParams.get("weekStart")!;

    const diffDays =
      (new Date(`${secondWeekStart}T00:00:00Z`).getTime() -
        new Date(`${firstWeekStart}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });

  it("labels the server's Monday–Sunday week as „KW 45 · 2.–8. Nov.“, never start = end (Issues #849, #850)", async () => {
    // The client asked for a Sunday (the old UTC slip); the server normalises to the Monday.
    planning(response("2026-11-02", "2026-11-08", []));
    renderWithTheme(PlanningOverviewPage, {});
    await waitFor(() => expect(screen.getByText("KW 45 · 2.–8. Nov.")).toBeTruthy());
    expect(screen.queryByText(/2026-11-08/)).toBeNull();
  });

  it("a single-salon context sends no salonId with the request (Issue #558)", async () => {
    planning(response("2031-02-03", "2031-02-09", []));
    renderWithTheme(PlanningOverviewPage, {});
    await waitFor(() => expect(planningCalls()).toHaveLength(1));
    const url = new URL(planningCalls()[0][0] as string, "http://localhost");
    expect(url.pathname).toBe("/shifts/planning-overview");
    expect(url.searchParams.has("salonId")).toBe(false);
  });

  it("empty scope renders the empty-state row", async () => {
    planning(response("2031-02-03", "2031-02-09", []));
    renderWithTheme(PlanningOverviewPage, {});
    await waitFor(() =>
      expect(
        screen.getByText("In deiner Reichweite arbeitet niemand nach Schichtplan."),
      ).toBeTruthy(),
    );
  });

  it("sits under the roster tabs with its own tab current, as a block table with a caption (Issue #853)", async () => {
    planning(
      response("2031-02-03", "2031-02-09", [
        {
          employeeId: "emp-1",
          name: "Lena Beispiel",
          contractDays: 5,
          leaveDays: 0,
          leaveWeekdays: [],
          otherAbsenceDays: 0,
          stillToPlan: 5,
        },
      ]),
    );
    renderWithTheme(PlanningOverviewPage, {});
    await waitFor(() => expect(screen.getByText("Lena Beispiel")).toBeTruthy());

    const nav = screen.getByRole("navigation", { name: "Dienstplan" });
    const current = nav.querySelector("[aria-current='page']");
    expect(current?.textContent).toContain("Bedarf");
    expect(current?.getAttribute("href")).toBe("/team/dienstplan/planung");
    expect(nav.querySelectorAll("a").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("table", { name: "Planungsbedarf der Woche" })).toBeTruthy();
    // The text-link pager is gone: the week is moved by the picker's arrows only.
    expect(screen.queryByText("Nächste Woche →")).toBeNull();
  });

  it("a cold store: the first request names the TENANT's week, and it is still one request (Issue #1072)", async () => {
    // Monday 30.11. 04:00 in Berlin (the start-up zone), but still Sunday 29.11. 22:00 in New York.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T03:00:00Z"));
    tenantZone = "America/New_York";
    planning(response("2026-11-23", "2026-11-29", []));
    // A fresh module graph: the singleton store has never read /settings/work.
    vi.resetModules();
    const fresh = await import("@testing-library/svelte");
    const { renderWithTheme: freshRender } = await import("$tests/test-utils");
    const Page = (await import("../+page.svelte")).default;
    freshRender(Page, {});
    await waitFor(() => expect(planningCalls()).toHaveLength(1));
    const url = new URL(planningCalls()[0][0] as string, "http://localhost");
    expect(url.searchParams.get("weekStart")).toBe("2026-11-23");
    // The re-anchored week must not start a second request.
    await new Promise((r) => setTimeout(r, 60));
    expect(planningCalls()).toHaveLength(1);
    fresh.cleanup();
  });
});
