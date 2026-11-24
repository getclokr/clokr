// Issue #1011 (finding U-01) - Verwalten › Monatsabschluss, mounted: the running month („Läuft noch“) opens
// read-only for a reader and for a closer, shows the missing days through yesterday (counts, never dates, for
// a reader without time-entry reach) and offers neither „Abschließen“ nor „Entsperren“; a later month
// („Zukunft“) stays closed. Only `Date` is frozen (16.11.2026), so no hard-coded date can expire.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/svelte";

const get = vi.fn();
const post = vi.fn();
const goto = vi.fn();
const urlHolder = vi.hoisted(() => ({ search: "" }));

vi.mock("$api/client", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("$stores/toast", () => ({
  toasts: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return { authStore: writable({ user: null }) };
});
vi.mock("$app/state", () => ({
  page: {
    get url() {
      return new URL(`http://localhost/admin/month-close${urlHolder.search}`);
    },
  },
}));
vi.mock("$app/navigation", () => ({
  goto: (...a: unknown[]) => goto(...a),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}));

import { renderWithTheme } from "$tests/test-utils";
import { authStore } from "$stores/auth";
import Page from "../routes/(app)/admin/month-close/+page.svelte";

const YEAR = 2026;

const months = [
  ...Array.from({ length: 10 }, (_, i) => ({
    month: i + 1,
    name: `Monat ${i + 1}`,
    status: "closed",
    closedCount: 2,
    totalCount: 2,
  })),
  { month: 11, name: "November", status: "future", closedCount: 0, totalCount: 2 },
  { month: 12, name: "Dezember", status: "future", closedCount: 0, totalCount: 2 },
];

const anna = {
  employeeId: "e-anna",
  employeeName: "Anna Probe",
  employeeNumber: "1",
  status: "missing",
  missingDates: [],
  missingDateCount: 1,
  dayDetailsWithheld: true,
};
const ben = {
  employeeId: "e-ben",
  employeeName: "Ben Solide",
  employeeNumber: "2",
  status: "ready",
  missingDates: [],
  missingDateCount: 0,
};
const cleo = {
  employeeId: "e-cleo",
  employeeName: "Cleo Zu",
  employeeNumber: "3",
  status: "closed",
  missingDates: [],
  missingDateCount: 0,
};

let detail: unknown[] = [];

function route(url: string): unknown {
  if (url.startsWith("/overtime/close-month/year-status")) {
    return { year: YEAR, months, autoCloseDeadline: 10, earliestYear: 2025 };
  }
  if (url.startsWith("/overtime/close-month/status"))
    return { year: YEAR, month: 11, employees: detail };
  if (url.startsWith("/overtime/close-month/deferred")) {
    return { employeeCount: 0, employees: [], severity: "NONE" };
  }
  throw new Error(`unexpected GET ${url}`);
}

const READER = ["month-close:read:ZUGEWIESEN"];
const CLOSER = [
  "month-close:read:ZUGEWIESEN",
  "month-close:close:ZUGEWIESEN",
  "month-close:unlock:ZUGEWIESEN",
];

function asUser(permissions: string[]) {
  (authStore as unknown as { set: (v: unknown) => void }).set({ user: { permissions } });
}

async function openRow(month: number, name: RegExp) {
  const row = await screen.findByTestId(`month-close-row-${month}`);
  const button = within(row).getByRole("button", { name });
  await fireEvent.click(button);
  return row;
}

describe("Monatsabschluss: the running month (#1011)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    goto.mockReset();
    urlHolder.search = "";
    detail = [anna, ben, cleo];
    get.mockImplementation(async (url: string) => route(url));
    post.mockResolvedValue({});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 10, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the running month a chevron and a reason, and opens it with the note for a reader", async () => {
    asUser(READER);
    renderWithTheme(Page, {});
    const row = await screen.findByTestId("month-close-row-11");
    expect(within(row).getByRole("button", { name: /November/ }).textContent).toContain("▸");
    expect(row.textContent).toContain("Läuft noch");
    expect(row.textContent).toContain("Abschluss nach Monatsende");

    await fireEvent.click(within(row).getByRole("button", { name: /November/ }));
    const detailEl = await screen.findByTestId("month-close-detail");
    expect(get).toHaveBeenCalledWith("/overtime/close-month/status?year=2026&month=11");
    expect(within(detailEl).getByTestId("month-close-running-note").textContent).toContain(
      "bis gestern",
    );
  });

  it("shows counts and no dates to a reader without day details, and „Bisher vollständig“ instead of „Bereit“", async () => {
    asUser(READER);
    renderWithTheme(Page, {});
    await openRow(11, /November/);
    const detailEl = await screen.findByTestId("month-close-detail");
    await within(detailEl).findByText("Anna Probe");
    expect(detailEl.textContent).toContain("1 Tag ohne Eintrag");
    expect(within(detailEl).getByTestId("month-close-person-withheld")).toBeTruthy();
    expect(detailEl.textContent).not.toMatch(/\d{2}\.\d{2}\./);
    expect(detailEl.textContent).toContain("Bisher vollständig");
    expect(detailEl.textContent).not.toContain("Bereit");
  });

  it("offers a closer no close and no unlock inside the running month", async () => {
    asUser(CLOSER);
    renderWithTheme(Page, {});
    await openRow(11, /November/);
    const detailEl = await screen.findByTestId("month-close-detail");
    await within(detailEl).findByText("Anna Probe");
    expect(within(detailEl).queryByRole("button", { name: /abschließen/i })).toBeNull();
    expect(within(detailEl).queryByRole("button", { name: "Entsperren" })).toBeNull();
    expect(screen.queryByTestId("month-close-row-11-trigger")).toBeNull();
  });

  it("opens the running month by deep link without offering a close or unlock", async () => {
    asUser(CLOSER);
    urlHolder.search = "?year=2026&month=11";
    renderWithTheme(Page, {});
    const detailEl = await screen.findByTestId("month-close-detail");
    await within(detailEl).findByText("Anna Probe");
    expect(within(detailEl).queryByRole("button", { name: /abschließen/i })).toBeNull();
    expect(within(detailEl).queryByRole("button", { name: "Entsperren" })).toBeNull();
  });

  it("keeps a later month closed: no chevron, reason „–“, no request, no detail", async () => {
    asUser(READER);
    renderWithTheme(Page, {});
    const row = await screen.findByTestId("month-close-row-12");
    const button = within(row).getByRole("button", { name: /Dezember/ });
    expect(button.textContent).not.toContain("▸");
    expect(row.textContent).toContain("Zukunft");
    expect(row.textContent).not.toContain("Abschluss nach Monatsende");
    await fireEvent.click(button);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.some(([url]) => String(url).includes("month=12"))).toBe(false);
    expect(screen.queryByTestId("month-close-detail")).toBeNull();
  });
});
