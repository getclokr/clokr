// Issue #604 - the appointment hints of persons in the caller's time-entry reach as the task kind
// „Zeit prüfen“ of Team › Aufgaben and the Aufgaben widget of Heute im Salon. The server decides every
// hint (`GET /appointment-hints/team`, already narrowed to the reach); the model only maps it to a row.
import { describe, expect, it, vi } from "vitest";
import {
  availableTaskKinds,
  taskCounts,
  taskKindLabel,
  taskRowsFrom,
  TASK_KIND_VALUES,
  type TaskSources,
} from "../task-model";
import {
  loadOpenTaskSources,
  openTaskBreakdown,
  openTaskSummary,
  taskGates,
  TASK_SOURCE_PATHS,
} from "../task-sources";
import type { TeamAppointmentHint } from "$lib/time-entries/appointment-hints";

const OPTIONS = { leaveDays: () => "" };

const AFTER: TeamAppointmentHint = {
  employeeId: "P",
  personName: "Pat Muster",
  date: "2026-11-24",
  kind: "AFTER_CLOCK_OUT",
  appointmentsUntil: "19:30",
  clockedOutAt: "18:00",
};
const NONE: TeamAppointmentHint = {
  employeeId: "Q",
  personName: "Quinn Muster",
  date: "2026-11-23",
  kind: "NO_ENTRY",
  appointmentsUntil: "16:00",
  clockedOutAt: null,
};

const sources = (hints: TeamAppointmentHint[], enabled = true): TaskSources => ({
  appointmentHints: { enabled, hints },
});

describe("task kind „Zeit prüfen“ (Issue #604)", () => {
  it("is a kind with its label, after „Ausstempeln fehlt“", () => {
    expect(TASK_KIND_VALUES).toContain("zeitpruefen");
    expect(taskKindLabel("zeitpruefen")).toBe("Zeit prüfen");
    const order = TASK_KIND_VALUES.filter((k) => k === "ausstempeln" || k === "zeitpruefen");
    expect(order).toEqual(["ausstempeln", "zeitpruefen"]);
  });

  it("maps an AFTER_CLOCK_OUT hint to one row with the team link", () => {
    const rows = taskRowsFrom(sources([AFTER]), OPTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "zeitpruefen:P:2026-11-24:AFTER_CLOCK_OUT",
      kind: "zeitpruefen",
      title: "Pat Muster",
      personName: "Pat Muster",
      subtitle: "24.11.2026 · Termine bis 19:30, ausgestempelt um 18:00",
      label: "Zeit prüfen",
      decided: false,
      status: "OPEN",
      href: "/team/zeiten?employeeId=P&date=2026-11-24",
    });
  });

  it("words a NO_ENTRY hint without a clock-out", () => {
    const [row] = taskRowsFrom(sources([NONE]), OPTIONS);
    expect(row.subtitle).toBe("23.11.2026 · Termine bis 16:00, keine Zeit erfasst");
  });

  it("links the caller's own person to Ich › Zeiten", () => {
    const [row] = taskRowsFrom(sources([AFTER]), { ...OPTIONS, ownEmployeeId: "P" });
    expect(row.href).toBe("/ich/zeiten?view=list&date=2026-11-24");
  });

  it("encodes the person id in the team link", () => {
    const [row] = taskRowsFrom(sources([{ ...AFTER, employeeId: "a b&c" }]), OPTIONS);
    expect(row.href).toBe("/team/zeiten?employeeId=a%20b%26c&date=2026-11-24");
  });

  it("a malformed day yields no row", () => {
    expect(taskRowsFrom(sources([{ ...AFTER, date: "24.11.2026" }]), OPTIONS)).toEqual([]);
  });

  it("a disabled or absent answer yields no row", () => {
    expect(taskRowsFrom(sources([AFTER], false), OPTIONS)).toEqual([]);
    expect(taskRowsFrom({}, OPTIONS)).toEqual([]);
    expect(taskRowsFrom({ appointmentHints: null }, OPTIONS)).toEqual([]);
  });

  it("sorts oldest first with the other kinds", () => {
    const rows = taskRowsFrom(sources([AFTER, NONE]), OPTIONS);
    expect(rows.map((r) => r.sourceId)).toEqual([
      "Q:2026-11-23:NO_ENTRY",
      "P:2026-11-24:AFTER_CLOCK_OUT",
    ]);
  });
});

describe("availableTaskKinds with the hint switch (Issue #604)", () => {
  const base = {
    leave: false,
    retro: false,
    section9: false,
    breakNoticeCount: 0,
    openTaskTypes: [] as string[],
  };

  it("offers zeitpruefen only when the answer says enabled", () => {
    expect(availableTaskKinds({ ...base, appointmentHintsEnabled: true })).toEqual(["zeitpruefen"]);
    expect(availableTaskKinds({ ...base, appointmentHintsEnabled: false })).toEqual([]);
    expect(availableTaskKinds(base)).toEqual([]);
  });

  it("puts it after ausstempeln", () => {
    expect(
      availableTaskKinds({
        ...base,
        openTaskTypes: ["ausstempeln", "zeitkorrektur"],
        appointmentHintsEnabled: true,
      }),
    ).toEqual(["ausstempeln", "zeitpruefen", "zeitkorrektur"]);
  });
});

describe("task sources (Issue #604)", () => {
  it("the gate is exactly time-entry:read:ZUGEWIESEN", () => {
    expect(taskGates({ permissions: ["time-entry:read:ZUGEWIESEN"] }).appointmentHints).toBe(true);
    expect(taskGates({ permissions: ["time-entry:read:EIGENE"] }).appointmentHints).toBe(false);
    expect(taskGates({ permissions: [] }).appointmentHints).toBe(false);
    expect(taskGates(null).appointmentHints).toBe(false);
  });

  it("reads the team answer only through the gate and turns a refusal into an absent source", async () => {
    const get = vi.fn((path: string) => {
      if (path === TASK_SOURCE_PATHS.appointmentHints) return Promise.reject(new Error("403"));
      return Promise.resolve([]);
    });
    const open = taskGates({ permissions: ["time-entry:read:ZUGEWIESEN"] });
    const sources = await loadOpenTaskSources(get as never, open);
    expect(TASK_SOURCE_PATHS.appointmentHints).toBe("/appointment-hints/team");
    expect(get.mock.calls.map((c) => c[0])).toContain("/appointment-hints/team");
    expect(sources.appointmentHints).toBeNull();

    get.mockClear();
    const closed = taskGates({ permissions: ["leave-request:approve:ZUGEWIESEN"] });
    await loadOpenTaskSources(get as never, closed);
    expect(get.mock.calls.map((c) => c[0])).not.toContain("/appointment-hints/team");
  });

  it("counts the hint rows in the summary and offers the kind only while enabled", () => {
    const gates = taskGates({ permissions: ["time-entry:read:ZUGEWIESEN"] });
    const on = openTaskSummary(sources([AFTER, NONE]), gates);
    expect(on.total).toBe(2);
    expect(on.counts.zeitpruefen).toBe(2);
    expect(on.kinds).toContain("zeitpruefen");
    expect(openTaskBreakdown(on)).toBe("Zeit prüfen 2");

    const off = openTaskSummary(sources([AFTER, NONE], false), gates);
    expect(off.total).toBe(0);
    expect(off.kinds).not.toContain("zeitpruefen");
    expect(taskCounts([]).zeitpruefen).toBe(0);
  });
});
