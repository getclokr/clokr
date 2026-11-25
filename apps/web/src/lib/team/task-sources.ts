// Issue #948 - the ONE place that decides which sources make up the open tasks of Team › Aufgaben and
// how many of them wait. Before, the „Aufgaben“ cell of Heute im Salon summed its own two reads (open
// leave requests + Zeitnachträge) while the page counted every kind of its task model (also § 9 cases,
// Pausenbefunde, missing clock-outs, Zeitkorrekturen), so the cell said 2 where the page listed 3.
//
// Both now read the same gates (`taskGates`, the hints of the page's loaders; the API decides), the
// same endpoints (`TASK_SOURCE_PATHS`) and count through the same pure model
// (`taskRowsFrom` -> `rowsForView(..., "offen")` -> `taskCounts`, `$lib/team/task-model`). The page is a
// work queue and not narrowed by the header salon selection (#558), so neither is the count.
import { hasAnyPermission, hasPermission, type PermissionHolder } from "$lib/permissions";
import { APPOINTMENT_HINT_PATHS } from "$lib/time-entries/appointment-hints";
import {
  availableTaskKinds,
  rowsForView,
  taskCounts,
  taskKindLabel,
  taskRowsFrom,
  type LeaveTaskSource,
  type NoticeTaskSource,
  type OpenTasksAnswer,
  type RetroTaskSource,
  type Section9TaskSource,
  type TaskKind,
  type TaskSources,
} from "$lib/team/task-model";
import type { TeamAppointmentHintsAnswer } from "$lib/time-entries/appointment-hints";

/** Which sources the caller is offered (UX hints; every read is scoped by the API). */
export interface TaskGates {
  /** Any decide key: the page is reachable at all. */
  page: boolean;
  /** `GET /leave/requests` is read only by an approver (an EIGENE reader would see own rows). */
  leave: boolean;
  /** `GET /retro-entry-requests` likewise only by an approver. */
  retro: boolean;
  /** The § 9 cases for holders of either § 9 key. */
  section9: boolean;
  /** The missing clock-outs for holders of the time-entry reach the read needs. */
  openTasks: boolean;
  /** Issue #604: the hints on probably unrecorded time, for holders of the same time-entry reach. */
  appointmentHints: boolean;
}

export function taskGates(user: PermissionHolder | null | undefined): TaskGates {
  return {
    page: hasAnyPermission(user, [
      "leave-request:approve:ZUGEWIESEN",
      "retro-request:approve:ZUGEWIESEN",
      "section9:decide:ZUGEWIESEN",
    ]),
    leave: hasPermission(user, "leave-request:approve:ZUGEWIESEN"),
    retro: hasPermission(user, "retro-request:approve:ZUGEWIESEN"),
    section9: hasAnyPermission(user, ["section9:read:ZUGEWIESEN", "section9:decide:ZUGEWIESEN"]),
    openTasks: hasPermission(user, "time-entry:read:ZUGEWIESEN"),
    appointmentHints: hasPermission(user, "time-entry:read:ZUGEWIESEN"),
  };
}

/**
 * The endpoints of the open tasks. The open leave list is read without `year` on purpose: for an
 * approver `status=PENDING` also covers CANCELLATION_REQUESTED, in every year (#840 E-02).
 */
export const TASK_SOURCE_PATHS = {
  leaveOpen: "/leave/requests?status=PENDING",
  retro: "/retro-entry-requests",
  section9: "/leave/section9",
  notices: "/notifications",
  openTasks: "/tasks/open",
  appointmentHints: APPOINTMENT_HINT_PATHS.team,
} as const;

export type TaskGet = <T>(path: string) => Promise<T>;

/** A refusal or a failure of one source is a calm empty source, never an error. */
async function calm<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch {
    return empty;
  }
}

/** Reads every source of the open tasks the caller is offered, in parallel. */
export async function loadOpenTaskSources(get: TaskGet, gates: TaskGates): Promise<TaskSources> {
  const [leave, retro, section9, notices, openTasks, appointmentHints] = await Promise.all([
    gates.leave
      ? calm(() => get<LeaveTaskSource[]>(TASK_SOURCE_PATHS.leaveOpen), [] as LeaveTaskSource[])
      : Promise.resolve([] as LeaveTaskSource[]),
    gates.retro
      ? calm(() => get<RetroTaskSource[]>(TASK_SOURCE_PATHS.retro), [] as RetroTaskSource[])
      : Promise.resolve([] as RetroTaskSource[]),
    gates.section9
      ? calm(
          () => get<Section9TaskSource[]>(TASK_SOURCE_PATHS.section9),
          [] as Section9TaskSource[],
        )
      : Promise.resolve([] as Section9TaskSource[]),
    calm(
      () =>
        get<{ notifications?: NoticeTaskSource[] }>(TASK_SOURCE_PATHS.notices).then(
          (a) => a.notifications ?? [],
        ),
      [] as NoticeTaskSource[],
    ),
    gates.openTasks
      ? calm(() => get<OpenTasksAnswer>(TASK_SOURCE_PATHS.openTasks), null)
      : Promise.resolve(null),
    // Issue #604: the reach-filtered team hints; a refusal or a failure is an absent source.
    gates.appointmentHints
      ? calm(
          () => get<TeamAppointmentHintsAnswer>(TASK_SOURCE_PATHS.appointmentHints),
          null as TeamAppointmentHintsAnswer | null,
        )
      : Promise.resolve(null as TeamAppointmentHintsAnswer | null),
  ]);
  return { leave, retro, section9, notices, openTasks, appointmentHints };
}

export interface OpenTaskSummary {
  /** The page's „Offen (N)“. */
  total: number;
  /** Open rows per kind (every kind present). */
  counts: Record<TaskKind, number>;
  /** The kinds the caller is offered, in display order (the page's segment and KPI band). */
  kinds: TaskKind[];
}

/** How many tasks wait, by exactly the rule of the page's open view. */
export function openTaskSummary(sources: TaskSources, gates: TaskGates): OpenTaskSummary {
  // The day figure of a leave row is display only; counting never reads it.
  const open = rowsForView(taskRowsFrom(sources, { leaveDays: () => "" }), "offen");
  const counts = taskCounts(open);
  const kinds = availableTaskKinds({
    leave: gates.leave,
    retro: gates.retro,
    section9: gates.section9,
    breakNoticeCount: counts.pausenbefund,
    openTaskTypes: sources.openTasks?.types ?? [],
    appointmentHintsEnabled: sources.appointmentHints?.enabled === true,
  });
  return { total: open.length, counts, kinds };
}

/** „Urlaub 1 · Ausstempeln fehlt 1“ - the kinds that have open rows; empty when nothing waits. */
export function openTaskBreakdown(summary: OpenTaskSummary): string {
  return summary.kinds
    .filter((kind) => summary.counts[kind] > 0)
    .map((kind) => `${taskKindLabel(kind)} ${summary.counts[kind]}`)
    .join(" · ");
}
