// Issue #846 — Team › Heute im Salon, mounted (the page file is the dashboard route, rendered at
// /team/heute; harness of dashboard-team-saldo-pending-588, which this file replaces together with
// dashboard-charts-591, dashboard-team-saldo-588 and dashboard-overtime-trend-degrade: the charts
// and the saldo card left the start page by owner decision D-04, they move to Berichte with #895).
//
// Proves: the Kennzahlen-Band counts the server's statuses and every figure links to its filtered
// list (D-01); no chart and no saldo figure is requested or drawn (D-04); the team week pages only
// from 25 persons on and its count text is right (D-02, regression of „1 – 18 von 14“); deciding a
// request links to Aufgaben, where the review dialog opens, and the page itself writes nothing (D-03;
// Issue #992 N-07, owner decision 25.11.2026: one decision path).
//
// Issue #1028: the Aufgaben widget lists the rows the KPI cell counts (P-04), so the old expectation
// „2 weitere Aufgaben warten“ is replaced - the section has no summary row any more; every counted task
// is a row, the chips carry the KPI's own numbers and the widget pages like every other list.
const apiGet = vi.fn();
const apiPatch = vi.fn();
const apiPost = vi.fn();

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock("$stores/auth", async () => {
  const { writable } = await import("svelte/store");
  return { authStore: writable({ user: null }) };
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
      put: vi.fn(),
      patch: (...args: unknown[]) => apiPatch(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock("$lib/utils/logger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { authStore } from "$stores/auth";
import { salonContext } from "$stores/salon-context";
import { resetListPrefs } from "$stores/list-prefs";
import { ApiError } from "$api/client";
import { replaceState } from "$app/navigation";
const pageMock = vi.hoisted(() => ({
  url: new URL("http://localhost/team/heute") as URL,
  params: {},
  state: {},
}));
vi.mock("$app/state", () => ({ page: pageMock }));
import DashboardPage from "../routes/(app)/dashboard/+page.svelte";
import {
  attendanceBand,
  attendanceFilterOf,
  attendanceFilterCounts,
  filterAttendance,
  leaveTypeLabel,
  openTeamLeaveTasks,
  upcomingTypeFilters,
} from "$lib/dashboard/heute-im-salon";

const WEEK_DAYS = [
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
];

function teamOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    name: `Person ${i}`,
    employeeNumber: String(i),
    days: [],
  }));
}

const ATTENDANCE = {
  date: "2026-11-09",
  employees: [
    { id: "e1", name: "Anna", employeeNumber: "1", status: "clocked_in", reason: null },
    { id: "e2", name: "Ben", employeeNumber: "2", status: "clocked_in", reason: null },
    { id: "e3", name: "Cem", employeeNumber: "3", status: "present", reason: null },
    {
      id: "e4",
      name: "Dora",
      employeeNumber: "4",
      status: "missing",
      reason: null,
      expectedStart: "09:00",
      lateMinutes: 42,
    },
    { id: "e5", name: "Emil", employeeNumber: "5", status: "absent", reason: "Urlaub" },
    { id: "e6", name: "Finn", employeeNumber: "6", status: "none", reason: null },
  ],
  summary: { present: 1, absent: 1, clockedIn: 2, missing: 1, holiday: 0 },
};

// A request id is a uuid: the „Prüfen“ link (inboxRequestHref) writes only a real uuid (Issue #992).
const LR1 = "11111111-1111-4111-8111-111111111111";
const LR2 = "22222222-2222-4222-8222-222222222222";

const PENDING = [
  {
    id: LR1,
    employeeId: "e9",
    typeCode: "VACATION",
    employee: { firstName: "Hanna", lastName: "Personal" },
    startDate: "2026-12-14",
    endDate: "2026-12-18",
    days: 5,
    halfDay: false,
    status: "PENDING",
    note: null,
    attestPresent: false,
    attestValidFrom: null,
    attestValidTo: null,
    createdAt: "2026-11-01T08:00:00.000Z",
  },
];

let teamSize = 3;

const RETRO = [
  {
    id: "rr1",
    employeeId: "e8",
    status: "PENDING",
    employee: { firstName: "Ilse", lastName: "Nachtrag" },
    targetDate: "2026-11-05",
    startTime: "09:00",
    endTime: "17:00",
    reason: "vergessen",
    createdAt: "2026-11-06T08:00:00.000Z",
  },
];

// Issue #948: the open-tasks read of Team › Aufgaben (missing clock-outs). Empty unless a test sets it.
let openTasksAnswer: { types: string[]; tasks: unknown[] } = { types: ["ausstempeln"], tasks: [] };
// Issue #1028: the other sources of the task model; empty unless a test sets them.
let leaveAnswer: unknown[] = PENDING;
let section9Answer: unknown[] = [];
let notificationsAnswer: unknown[] = [];
let upcomingAnswer: unknown[] = [];

function answer(path: string): Promise<unknown> {
  if (path === "/me/context") {
    return Promise.resolve({
      tenant: { id: "t1", name: "Mandant" },
      isMultiSalon: false,
      homeSalonId: null,
      salons: [],
    });
  }
  if (path.startsWith("/dashboard/team-week")) {
    return Promise.resolve({
      weekStart: WEEK_DAYS[0],
      weekEnd: WEEK_DAYS[6],
      weekDays: WEEK_DAYS,
      team: teamOf(teamSize),
    });
  }
  if (path.startsWith("/dashboard/today-attendance")) return Promise.resolve(ATTENDANCE);
  if (path.startsWith("/dashboard/team-trend")) {
    return Promise.resolve({
      salonId: null,
      asOf: "2026-11-14",
      workedBasis: "ACCOUNT",
      // Issue #986: the recorded time and the account's to-date figures of the KPI.
      recordedBasis: "ALL_ENTRIES",
      sollUnavailableReason: null,
      months: [
        {
          month: "2026-11",
          workedMinutes: 296 * 60,
          shouldMinutes: 312 * 60,
          recordedMinutes: 296 * 60,
          toDateWorkedMinutes: 296 * 60,
          toDateShouldMinutes: 312 * 60,
          sickDays: 0,
        },
      ],
    });
  }
  if (path.startsWith("/dashboard/team-upcoming-leave"))
    return Promise.resolve({ salonId: null, items: upcomingAnswer });
  if (path.startsWith("/leave/requests")) return Promise.resolve(leaveAnswer);
  if (path === "/leave/section9") return Promise.resolve(section9Answer);
  if (path === "/notifications") return Promise.resolve({ notifications: notificationsAnswer });
  if (path === "/retro-entry-requests") return Promise.resolve(RETRO);
  if (path === "/tasks/open") return Promise.resolve(openTasksAnswer);
  if (path === "/dashboard/open-items") return Promise.resolve({});
  if (path.startsWith("/time-entries")) return Promise.resolve([]);
  if (path === "/dashboard") return Promise.reject(new ApiError(500, "ignored in this test"));
  return Promise.reject(new ApiError(404, "not part of this test"));
}

function asManager() {
  (authStore as unknown as { set: (v: unknown) => void }).set({
    user: {
      id: "u1",
      email: "u1@example.invalid",
      employeeId: "e1",
      firstName: "Sabine",
      permissions: [
        "team-overview:read:ZUGEWIESEN",
        "leave-request:approve:ZUGEWIESEN",
        "leave-request:read:ZUGEWIESEN",
        "retro-request:approve:ZUGEWIESEN",
        "time-entry:read:ZUGEWIESEN",
      ],
    },
  });
}

beforeEach(async () => {
  teamSize = 3;
  openTasksAnswer = { types: ["ausstempeln"], tasks: [] };
  leaveAnswer = PENDING;
  section9Answer = [];
  notificationsAnswer = [];
  upcomingAnswer = [];
  pageMock.url = new URL("http://localhost/team/heute");
  // A chip choice of an earlier test is a stored list choice of this session; start every test clean.
  resetListPrefs();
  apiGet.mockReset();
  apiGet.mockImplementation((path: string) => answer(path));
  apiPatch.mockReset();
  apiPost.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await salonContext.load("u1", { force: true }).catch(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Heute im Salon — the Kennzahlen-Band (D-01)", () => {
  it("counts the server's statuses and links every figure to its filtered list", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    const present = await screen.findByTestId("kpi-present");
    expect(present.textContent).toMatch(/Anwesend\s*2\s*von 4/);
    expect(screen.getByTestId("kpi-expected").textContent).toMatch(/Erwartet\s*1/);
    expect(screen.getByTestId("kpi-absent").textContent).toMatch(/Abwesend\s*1/);
    await waitFor(() =>
      expect(screen.getByTestId("kpi-tasks").textContent).toMatch(/Aufgaben\s*2/),
    );
    expect(screen.getByTestId("kpi-month").textContent).toMatch(/296:00h\s*\/ 312:00h/);
    const link = (id: string) =>
      screen.getByTestId(id).querySelector("a")?.getAttribute("href") ?? "";
    expect(link("kpi-present")).toBe("/team/heute?status=anwesend#jetzt");
    expect(link("kpi-expected")).toBe("/team/heute?status=erwartet#jetzt");
    expect(link("kpi-absent")).toBe("/team/heute?status=abwesend#jetzt");
    expect(link("kpi-tasks")).toBe("/team/aufgaben");
  });

  it("Issue #948: the Aufgaben cell counts every kind Team › Aufgaben lists (a missing clock-out too)", async () => {
    openTasksAnswer = {
      types: ["ausstempeln"],
      tasks: [
        {
          type: "ausstempeln",
          id: "te1",
          employeeId: "e4",
          personName: "Dora",
          day: "2026-11-08",
          startTime: "09:00",
          label: "Ausstempeln fehlt",
          link: "/team/time-entries?employeeId=e4&date=2026-11-08",
        },
      ],
    };
    asManager();
    renderWithTheme(DashboardPage, {});
    await waitFor(() =>
      expect(screen.getByTestId("kpi-tasks").textContent).toMatch(/Aufgaben\s*3/),
    );
    expect(screen.getByTestId("kpi-tasks").textContent).toContain(
      "Urlaub 1 · Nachtrag 1 · Ausstempeln fehlt 1",
    );
    // #1028: no summary row any more - the three counted tasks are three rows of the widget.
    await waitFor(() => expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(3));
    expect(screen.queryByText(/weitere Aufgabe/)).toBeNull();
  });

  it("lists the missing person with the shift start under „Erwartet“, never the person without a day", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    const filter = await screen.findByTestId("attendance-filter");
    // Issue #1028 (P-05): the default is „Da“ (clocked in now), so the missing person is not listed yet.
    expect(screen.queryByText("Schicht seit 09:00 · nicht eingestempelt")).toBeNull();
    await fireEvent.click(within(filter).getByRole("radio", { name: /^Erwartet/ }));
    expect(await screen.findByText("Schicht seit 09:00 · nicht eingestempelt")).toBeTruthy();
    await fireEvent.click(within(filter).getByRole("radio", { name: /^Alle/ }));
    await screen.findByText("Dora");
    expect(screen.queryByText("Finn")).toBeNull();
  });
});

describe("Heute im Salon — no charts, no saldo (D-04)", () => {
  it("requests neither a trend nor a saldo overview and draws no canvas", async () => {
    asManager();
    const { container } = renderWithTheme(DashboardPage, {});
    await screen.findByTestId("kpi-present");
    const paths = apiGet.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.startsWith("/dashboard/overtime-trend"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/dashboard/overtime-overview"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/dashboard/team-trend?months=1"))).toBe(true);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("the page source imports no chart library and no saldo card", () => {
    const src = readFileSync(resolve(__dirname, "../routes/(app)/dashboard/+page.svelte"), "utf8");
    expect(src.length).toBeGreaterThan(50_000);
    expect(src).not.toMatch(/from "chart\.js"/);
    expect(src).not.toContain("TeamSaldoCard");
    expect(src).not.toContain("<canvas");
  });
});

describe("Heute im Salon — the team week (D-02)", () => {
  it("shows no pagination up to 25 persons", async () => {
    asManager();
    teamSize = 25;
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("team-week");
    expect(screen.queryByTestId("team-week-widget-pager")).toBeNull();
  });

  it("pages from 26 persons on and counts „1–25 von 30“ (regression „1 – 18 von 14“)", async () => {
    asManager();
    teamSize = 30;
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("team-week");
    const pager = await screen.findByTestId("team-week-widget-pager");
    // #1028: the same Pager as every list; the team week is a table-kind list (25 · 50 · 100).
    expect(within(pager).getByTestId("pager-range").textContent?.trim()).toBe("1–25 von 30");
    expect(screen.getByTestId("team-week").querySelectorAll("tbody tr")).toHaveLength(25);
  });
});

describe("Heute im Salon — tasks are decided in Aufgaben only (D-03, Issue #992 N-07, owner decision 25.11.2026)", () => {
  it("an open request has one link „Prüfen“ to Aufgaben; the page itself writes nothing", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    const link = await screen.findByRole("link", { name: "Prüfen" });
    expect(link.getAttribute("href")).toBe(`/team/aufgaben?request=${LR1}&year=2026`);
    expect(screen.queryByRole("button", { name: "Genehmigen" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("parity: only Aufgaben mounts LeaveReviewDialog, and only the dialog patches /review", () => {
    const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
    const page = read("../routes/(app)/dashboard/+page.svelte");
    const inbox = read("../routes/(app)/inbox/+page.svelte");
    const dialog = read("../lib/components/leave/LeaveReviewDialog.svelte");
    expect(inbox).toContain("<LeaveReviewDialog");
    expect(page).not.toContain("LeaveReviewDialog");
    expect(page).toContain("inboxRequestHref(");
    for (const src of [page, inbox]) {
      expect(src).not.toMatch(/\/leave\/requests\/\$\{[^}]+\}\/review/);
    }
    expect(dialog).toMatch(/\/leave\/requests\/\$\{ctx\.id\}\/review/);
  });
});

// Issue #1028 - the Aufgaben widget on the shared list block.
const ALL_KINDS_LEAVE = [
  ...PENDING,
  {
    ...PENDING[0],
    id: LR2,
    employeeId: "e10",
    employee: { firstName: "Jonas", lastName: "Storno" },
    status: "CANCELLATION_REQUESTED",
    createdAt: "2026-11-02T08:00:00.000Z",
  },
];

function everyKindPresent() {
  leaveAnswer = ALL_KINDS_LEAVE;
  section9Answer = [
    {
      id: "s9",
      employeeName: "Kira Paragraf",
      status: "AU_PENDING",
      overlapStart: "2026-11-03",
      overlapEnd: "2026-11-04",
      sickRequest: { startDate: "2026-11-03", endDate: "2026-11-04" },
      vacationRequest: { startDate: "2026-11-01", endDate: "2026-11-06" },
    },
  ];
  notificationsAnswer = [
    {
      id: "n1",
      type: "BREAK_PLACEMENT_VIOLATION",
      title: "Pause prüfen",
      message: "Die Pause lag am Rand der Arbeitszeit.",
      link: null,
      createdAt: "2026-11-07T08:00:00.000Z",
      dismissedAt: null,
    },
  ];
  openTasksAnswer = {
    types: ["ausstempeln", "zeitkorrektur"],
    tasks: [
      {
        type: "ausstempeln",
        id: "te1",
        employeeId: "e4",
        personName: "Dora",
        day: "2026-11-08",
        startTime: "09:00",
        label: "Ausstempeln fehlt",
        link: "/team/time-entries?employeeId=e4&date=2026-11-08",
      },
      {
        type: "zeitkorrektur",
        id: "zk1",
        employeeId: "e5",
        personName: "Emil",
        day: "2026-11-08",
        label: "Zeitkorrektur",
        link: "/team/time-entries?employeeId=e5&date=2026-11-08",
      },
    ],
  };
}

function asManagerWithSection9() {
  asManager();
  const store = authStore as unknown as {
    update: (f: (v: { user: { permissions: string[] } }) => unknown) => void;
  };
  store.update((v) => ({
    ...v,
    user: { ...v.user, permissions: [...v.user.permissions, "section9:decide:ZUGEWIESEN"] },
  }));
}

/** „Urlaub 2 · Nachtrag 1“ of the KPI cell as [label, count] pairs. */
function kpiBreakdown(): Array<[string, number]> {
  const text = screen.getByTestId("kpi-tasks").querySelector(".kpi-explanation")?.textContent ?? "";
  return text.split(" · ").map((part) => {
    const m = /^(.*\S)\s(\d+)$/.exec(part.trim());
    return [m?.[1] ?? part, Number(m?.[2] ?? Number.NaN)] as [string, number];
  });
}

describe("Heute im Salon — Aufgaben on the shared list block (Issue #1028)", () => {
  it("chips are „Alle“ plus the offered kinds; every count equals the KPI cell's breakdown", async () => {
    everyKindPresent();
    asManagerWithSection9();
    renderWithTheme(DashboardPage, {});
    await waitFor(() =>
      expect(screen.getByTestId("kpi-tasks").textContent).toMatch(/Aufgaben\s*7/),
    );
    const chips = within(await screen.findByTestId("team-tasks-filter")).getAllByRole("radio");
    const shown = chips.map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(shown[0]).toBe("Alle 7");
    const kpi = kpiBreakdown().map(([label, n]) => `${label} ${n}`);
    expect(kpi).toEqual([
      "Urlaub 2",
      "Nachtrag 1",
      "Krank im Urlaub 1",
      "Pausenbefund 1",
      "Ausstempeln fehlt 1",
      "Zeitkorrektur 1",
    ]);
    expect(shown.slice(1)).toEqual(kpi);
  });

  it("pages like every list: five rows, then the rest, and a chip filters by kind", async () => {
    everyKindPresent();
    asManagerWithSection9();
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("team-tasks-filter");
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(5);
    const range = () =>
      (
        screen.getByTestId("team-tasks-pager").querySelector("[data-testid='pager-range']")
          ?.textContent ?? ""
      ).trim();
    expect(range()).toBe("1–5 von 7");
    await fireEvent.click(
      within(screen.getByTestId("team-tasks-pager")).getByRole("button", { name: "Nächste Seite" }),
    );
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(2);
    expect(range()).toBe("6–7 von 7");

    await fireEvent.click(
      within(screen.getByTestId("team-tasks-filter")).getByRole("radio", { name: /^Urlaub/ }),
    );
    await waitFor(() => expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(2));
    for (const row of screen.getAllByTestId(/^task-row-/)) {
      expect(row.getAttribute("data-kind")).toBe("urlaub");
    }
    expect(screen.queryByTestId("team-tasks-pager")).toBeNull();
  });

  it("a PENDING request of another person has one link „Prüfen“ at the row end, no decision button", async () => {
    everyKindPresent();
    asManagerWithSection9();
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("team-tasks-filter");
    await fireEvent.click(
      within(screen.getByTestId("team-tasks-filter")).getByRole("radio", { name: /^Urlaub/ }),
    );
    const row = await screen.findByTestId(`task-row-urlaub-${LR1}`);
    expect(row.classList.contains("list-row--actions-end")).toBe(true);
    const actions = row.querySelector(".list-actions") as HTMLElement;
    const link = within(actions).getByRole("link", { name: "Prüfen" });
    expect(link.getAttribute("href")).toBe(`/team/aufgaben?request=${LR1}&year=2026`);
    expect(within(actions).queryByRole("button", { name: "Ablehnen" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "Genehmigen" })).toBeNull();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("a cancellation request and every other kind has one link „Öffnen“ to its kind on Team › Aufgaben", async () => {
    everyKindPresent();
    asManagerWithSection9();
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("team-tasks-filter");
    await fireEvent.click(
      within(screen.getByTestId("team-tasks-filter")).getByRole("radio", { name: /^Urlaub/ }),
    );
    const cancel = await screen.findByTestId(`task-row-urlaub-${LR2}`);
    const link = within(cancel).getByRole("link", { name: "Öffnen" });
    expect(link.getAttribute("href")).toBe("/team/aufgaben?typ=urlaub");
    expect(within(cancel).queryByRole("button", { name: "Genehmigen" })).toBeNull();

    await fireEvent.click(
      within(screen.getByTestId("team-tasks-filter")).getByRole("radio", { name: /^Nachtrag/ }),
    );
    const retro = await screen.findByTestId("task-row-nachtrag-rr1");
    expect(within(retro).getByRole("link", { name: "Öffnen" }).getAttribute("href")).toBe(
      "/team/aufgaben?typ=nachtrag",
    );
  });

  it("the caller's own request is never offered for a decision", async () => {
    leaveAnswer = [{ ...PENDING[0], id: "own", employeeId: "e1" }];
    asManager();
    renderWithTheme(DashboardPage, {});
    const row = await screen.findByTestId("task-row-urlaub-own");
    expect(within(row).queryByRole("button", { name: "Genehmigen" })).toBeNull();
    expect(within(row).getByRole("link", { name: "Öffnen" })).toBeTruthy();
  });

  it("without any task the section says so calmly and shows no chips or pager", async () => {
    leaveAnswer = [];
    asManager();
    // The default fixtures still carry a Zeitnachtrag; the retro source is empty here.
    apiGet.mockImplementation((path: string) =>
      path === "/retro-entry-requests" ? Promise.resolve([]) : answer(path),
    );
    renderWithTheme(DashboardPage, {});
    expect(await screen.findByText("Nichts zu entscheiden.")).toBeTruthy();
    expect(screen.queryByTestId("team-tasks-filter")).toBeNull();
    expect(screen.queryByTestId("team-tasks-pager")).toBeNull();
  });
});

describe("Heute im Salon — Jetzt im Salon on the shared list block (Issue #1028, P-05)", () => {
  const chips = async () =>
    within(await screen.findByTestId("attendance-filter")).getAllByRole("radio");
  const names = () =>
    within(screen.getByTestId("team-now"))
      .queryAllByRole("listitem")
      .map((li) => li.querySelector(".list-title")?.textContent);

  it("offers Da · Erwartet · Abwesend · Alle; the counts are the Kennzahlen-Band's own numbers", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    const shown = (await chips()).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(shown).toEqual(["Da 2", "Erwartet 1", "Abwesend 1", "Alle 5"]);
    // Da / Erwartet / Abwesend equal the cells Anwesend / Erwartet / Abwesend.
    const cell = (id: string) =>
      (screen.getByTestId(id).querySelector(".kpi-value")?.textContent ?? "").trim();
    expect(cell("kpi-present")).toMatch(/^2(\D|$)/);
    expect(cell("kpi-expected")).toMatch(/^1(\D|$)/);
    expect(cell("kpi-absent")).toMatch(/^1(\D|$)/);
  });

  it("the default is „Da“: only the persons clocked in now", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    await chips();
    expect(
      within(screen.getByTestId("attendance-filter"))
        .getByRole("radio", { name: /^Da/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() => expect(names()).toEqual(["Anna", "Ben"]));
  });

  it("?status=erwartet in the URL shows „Erwartet“ for that visit without storing it", async () => {
    pageMock.url = new URL("http://localhost/team/heute?status=erwartet#jetzt");
    asManager();
    renderWithTheme(DashboardPage, {});
    await chips();
    await waitFor(() => expect(names()).toEqual(["Dora"]));
    expect(
      within(screen.getByTestId("attendance-filter"))
        .getByRole("radio", { name: /^Erwartet/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a chip click removes ?status= from the URL, so URL and chip never disagree", async () => {
    pageMock.url = new URL("http://localhost/team/heute?status=erwartet#jetzt");
    asManager();
    renderWithTheme(DashboardPage, {});
    await chips();
    await fireEvent.click(
      within(screen.getByTestId("attendance-filter")).getByRole("radio", { name: /^Abwesend/ }),
    );
    await waitFor(() => expect(names()).toEqual(["Emil"]));
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(replaceState).mock.calls[0][0]).toBe("/team/heute#jetzt");
  });

  it("the Kennzahl links keep their URL values (#846 D-01)", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    await screen.findByTestId("kpi-present");
    expect(screen.getByTestId("kpi-present").querySelector("a")?.getAttribute("href")).toBe(
      "/team/heute?status=anwesend#jetzt",
    );
  });
});

describe("Heute im Salon — Demnächst abwesend on the shared list block (Issue #1028, P-06)", () => {
  const item = (id: string, name: string, code: string, label: string, start: string) => ({
    id,
    employeeId: `p-${id}`,
    employeeName: name,
    startDate: start,
    endDate: start,
    days: 1,
    leaveTypeName: label,
    leaveTypeCode: code,
  });

  it("chips by leave type code with the counts of the rows loaded; a chip filters the rows", async () => {
    upcomingAnswer = [
      item("u1", "Person Eins", "VACATION", "Urlaub", "2026-11-20"),
      item("u2", "Person Zwei", "SICK", "Krank", "2026-11-21"),
      item("u3", "Person Drei", "VACATION", "Urlaub", "2026-11-22"),
    ];
    asManager();
    renderWithTheme(DashboardPage, {});
    const group = await screen.findByTestId("team-upcoming-filter");
    const shown = within(group)
      .getAllByRole("radio")
      .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(shown).toEqual([
      "Alle 3",
      `${leaveTypeLabel("VACATION")} 2`,
      `${leaveTypeLabel("SICK")} 1`,
    ]);
    await fireEvent.click(
      within(group).getByRole("radio", { name: new RegExp(`^${leaveTypeLabel("SICK")}`) }),
    );
    await waitFor(() =>
      expect(within(screen.getByTestId("team-upcoming")).getAllByRole("listitem")).toHaveLength(1),
    );
    expect(screen.getByText(/Person Zwei/)).toBeTruthy();
    expect(screen.queryByText(/Person Eins/)).toBeNull();
  });

  it("the head link „Kalender“ is a link to the full page", async () => {
    asManager();
    renderWithTheme(DashboardPage, {});
    const link = await screen.findByRole("link", { name: "Kalender" });
    expect(link.getAttribute("href")).toBe("/team/abwesenheiten");
  });

  it("every item of the answer is listed through the pager (no cut at eight)", async () => {
    upcomingAnswer = Array.from({ length: 13 }, (_, i) =>
      item(
        `u${i}`,
        `Person ${i}`,
        "VACATION",
        "Urlaub",
        `2026-12-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    asManager();
    renderWithTheme(DashboardPage, {});
    const pager = await screen.findByTestId("team-upcoming-pager");
    expect(within(pager).getByTestId("pager-range").textContent?.trim()).toBe("1–5 von 13");
  });
});

describe("heute-im-salon helpers", () => {
  it("attendanceBand counts each status once", () => {
    const band = attendanceBand(ATTENDANCE as never);
    expect(band).toEqual({ present: 2, expected: 4, missing: 1, scheduled: 0, absent: 1, done: 1 });
    expect(attendanceBand(null).expected).toBe(0);
  });

  it("the filter is an allow-list read from the URL", () => {
    expect(attendanceFilterOf("erwartet")).toBe("erwartet");
    expect(attendanceFilterOf("<script>")).toBe("alle");
    expect(attendanceFilterOf(null)).toBe("alle");
    const rows = ATTENDANCE.employees as never[];
    expect(filterAttendance(rows, "alle").map((r: { id: string }) => r.id)).not.toContain("e6");
    expect(filterAttendance(rows, "abwesend").map((r: { id: string }) => r.id)).toEqual(["e5"]);
  });

  it("„Da“ is exactly the clocked-in persons (Issue #1028, P-05); the counts are the band's own", () => {
    const rows = ATTENDANCE.employees as never[];
    expect(filterAttendance(rows, "anwesend").map((r: { id: string }) => r.id)).toEqual([
      "e1",
      "e2",
    ]);
    const band = attendanceBand(ATTENDANCE as never);
    expect(attendanceFilterCounts(band, rows)).toEqual({
      anwesend: band.present,
      erwartet: band.missing + band.scheduled,
      abwesend: band.absent,
      alle: 5,
    });
  });

  it("upcomingTypeFilters counts by type code in the order of the requestable list", () => {
    expect(upcomingTypeFilters([])).toEqual([{ value: "alle", label: "Alle", count: 0 }]);
    const chips = upcomingTypeFilters([
      { typeCode: "SICK" },
      { typeCode: "VACATION" },
      { typeCode: "ZZ_UNKNOWN" },
      { typeCode: "VACATION" },
    ]);
    expect(chips.map((c) => [c.value, c.count])).toEqual([
      ["alle", 4],
      ["VACATION", 2],
      ["SICK", 1],
      ["ZZ_UNKNOWN", 1],
    ]);
    expect(chips[1].label).toBe(leaveTypeLabel("VACATION"));
  });

  it("never offers the caller's own request for a decision", () => {
    const own = { ...PENDING[0], id: "own", employeeId: "e1" };
    const tasks = openTeamLeaveTasks([own, PENDING[0]] as never, "e1");
    expect(tasks.map((t) => t.id)).toEqual([LR1]);
  });
});
