// Issue #948 - the „Aufgaben“ cell of Heute im Salon and the page Team › Aufgaben count the same
// tasks: the same gates, the same endpoints and the same open-view rule of the task model. Before,
// the cell summed open leave requests and Zeitnachträge only and missed every other kind (in the
// user test a missing clock-out: cell 2, page „Offen (3)“).
import { describe, expect, it, vi } from "vitest";
import inboxSource from "../../../routes/(app)/inbox/+page.svelte?raw";
import dashboardSource from "../../../routes/(app)/dashboard/+page.svelte?raw";
import {
  loadOpenTaskSources,
  openTaskBreakdown,
  openTaskSummary,
  taskGates,
  TASK_SOURCE_PATHS,
  type TaskGates,
} from "../task-sources";
import {
  rowsForView,
  taskCounts,
  taskRowsFrom,
  TASK_KIND_VALUES,
  type TaskSources,
} from "../task-model";

const ALL: TaskGates = {
  page: true,
  leave: true,
  retro: true,
  section9: true,
  openTasks: true,
  appointmentHints: true, // Issue #604
};

/** One open row of every kind, plus decided rows that must never count. */
const SOURCES: TaskSources = {
  leave: [
    {
      id: "l1",
      typeCode: "VACATION",
      status: "PENDING",
      employee: { firstName: "A", lastName: "A" },
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      days: 2,
      halfDay: false,
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "l2",
      typeCode: "VACATION",
      status: "CANCELLATION_REQUESTED",
      employee: { firstName: "B", lastName: "B" },
      startDate: "2026-12-03",
      endDate: "2026-12-03",
      days: 1,
      halfDay: false,
      createdAt: "2026-11-02T00:00:00Z",
    },
    {
      id: "l3",
      typeCode: "VACATION",
      status: "APPROVED",
      employee: { firstName: "C", lastName: "C" },
      startDate: "2026-12-04",
      endDate: "2026-12-04",
      days: 1,
      halfDay: false,
      createdAt: "2026-11-03T00:00:00Z",
    },
  ],
  retro: [
    {
      id: "r1",
      status: "PENDING",
      employee: { firstName: "D", lastName: "D" },
      targetDate: "2026-11-05",
      startTime: null,
      endTime: null,
      createdAt: "2026-11-05T00:00:00Z",
    },
    {
      id: "r2",
      status: "REJECTED",
      employee: { firstName: "E", lastName: "E" },
      targetDate: "2026-11-05",
      startTime: null,
      endTime: null,
      createdAt: "2026-11-05T00:00:00Z",
    },
  ],
  section9: [
    {
      id: "s1",
      employeeName: "F F",
      status: "AU_PENDING",
      overlapStart: "2026-11-10",
      overlapEnd: "2026-11-11",
      sickRequest: { startDate: "2026-11-10", endDate: "2026-11-11" },
      vacationRequest: { startDate: "2026-11-09", endDate: "2026-11-13" },
    },
  ],
  notices: [
    {
      id: "n1",
      type: "BREAK_PLACEMENT_VIOLATION",
      title: "Pausenbefund",
      message: "x",
      link: "/team/time-entries",
      createdAt: "2026-11-07T00:00:00Z",
    },
    {
      id: "n2",
      type: "LEAVE_REQUEST_NEW",
      title: "kein Befund",
      message: "x",
      createdAt: "2026-11-07T00:00:00Z",
    },
  ],
  // Issue #604: one hint of a person in reach (the kind „Zeit prüfen“).
  appointmentHints: {
    enabled: true,
    hints: [
      {
        employeeId: "p1",
        personName: "I I",
        date: "2026-11-08",
        kind: "AFTER_CLOCK_OUT",
        appointmentsUntil: "19:30",
        clockedOutAt: "18:00",
      },
    ],
  },
  openTasks: {
    types: ["ausstempeln", "zeitkorrektur"],
    tasks: [
      {
        type: "ausstempeln",
        id: "t1",
        personName: "G G",
        day: "2026-11-08",
        startTime: "09:00",
        label: "Ausstempeln fehlt",
        link: "/team/time-entries",
      },
      {
        type: "zeitkorrektur",
        id: "t2",
        personName: "H H",
        day: "2026-11-08",
        label: "Zeitkorrektur",
        link: "/team/time-entries",
      },
    ],
  },
};

describe("Issue #948 - one count for the Aufgaben cell and the page", () => {
  it("the summary is the page's open view: same rows, same counts per kind, decided rows excluded", () => {
    const pageOpen = rowsForView(taskRowsFrom(SOURCES, { leaveDays: () => "x" }), "offen");
    const summary = openTaskSummary(SOURCES, ALL);
    expect(summary.total).toBe(pageOpen.length);
    expect(summary.counts).toEqual(taskCounts(pageOpen));
    // Every kind of the model is counted (the old cell only knew leave and Zeitnachtrag).
    for (const kind of TASK_KIND_VALUES) expect(summary.counts[kind], kind).toBeGreaterThan(0);
    expect(summary.total).toBe(8);
    expect(summary.counts.urlaub).toBe(2);
  });

  it("the breakdown names each waiting kind with its count, in display order", () => {
    expect(openTaskBreakdown(openTaskSummary(SOURCES, ALL))).toBe(
      "Urlaub 2 · Nachtrag 1 · Krank im Urlaub 1 · Pausenbefund 1 · Ausstempeln fehlt 1 · Zeit prüfen 1 · Zeitkorrektur 1",
    );
    expect(openTaskBreakdown(openTaskSummary({}, ALL))).toBe("");
  });

  it("the loader reads exactly the gated sources from the shared paths, calm on a refusal", async () => {
    const get = vi.fn((path: string) => {
      if (path === TASK_SOURCE_PATHS.retro) return Promise.reject(new Error("403"));
      if (path === TASK_SOURCE_PATHS.notices)
        return Promise.resolve({ notifications: SOURCES.notices });
      if (path === TASK_SOURCE_PATHS.leaveOpen) return Promise.resolve(SOURCES.leave);
      return Promise.resolve([]);
    });
    const gates = taskGates({
      permissions: ["leave-request:approve:ZUGEWIESEN", "retro-request:approve:ZUGEWIESEN"],
    });
    const sources = await loadOpenTaskSources(get as never, gates);
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(
      [TASK_SOURCE_PATHS.leaveOpen, TASK_SOURCE_PATHS.notices, TASK_SOURCE_PATHS.retro].sort(),
    );
    expect(sources.retro).toEqual([]);
    expect(sources.section9).toEqual([]);
    expect(sources.openTasks).toBeNull();
    expect(openTaskSummary(sources, gates).total).toBe(3); // 2 open leave + 1 Pausenbefund
  });

  it("[source] the page loads from the shared paths and gates, the dashboard counts through the summary", () => {
    expect(inboxSource.length).toBeGreaterThan(30_000);
    expect(dashboardSource.length).toBeGreaterThan(50_000);
    expect(inboxSource).toContain('from "$lib/team/task-sources"');
    expect(inboxSource).toContain("const gates = $derived(taskGates($authStore.user));");
    for (const key of [
      "leaveOpen",
      "retro",
      "section9",
      "notices",
      "openTasks",
      "appointmentHints", // Issue #604
    ]) {
      expect(inboxSource, key).toContain(`TASK_SOURCE_PATHS.${key}`);
    }
    expect(inboxSource).toContain('rowsForView(allTaskRows, "offen")');
    expect(dashboardSource).toContain('from "$lib/team/task-sources"');
    expect(dashboardSource).toContain("loadOpenTaskSources(");
    // Issue #1028 (P-04) moved the wiring, not the rule: the sources of ONE load now sit in state and the
    // cell (`openTaskSummary`) and the Aufgaben widget (`rowsForView(..., "offen")`) both derive from
    // them, so the count and the listed rows are one set.
    expect(dashboardSource).toContain("openTaskSummary(taskSources, taskSourceGates)");
    expect(dashboardSource).toContain('"offen",');
    expect(dashboardSource).toContain("value: openTasks?.total ?? 0,");
    // No count of its own: the old sum of two reads is gone.
    expect(dashboardSource).not.toMatch(/pendingLeave\.length \+/);
    expect(dashboardSource).not.toContain("pendingRetroCount");
  });
});
