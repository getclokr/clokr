/**
 * roster-leave-soll.ts
 *
 * Issue #1142 - the leave side of the roster Planungs-Soll (`GET /shifts/week`) for SHIFT_BASED
 * persons. This module is glue only: the rule (what a sick day, a child-sick day or a day of
 * Sonderurlaub relieves, the contract-week count, the cap at the week's contract Soll, the first
 * claim of a day) lives in the Arbeitszeitkonto (`shiftBasedLeaveRelief()` and
 * `rosterPlannedNettoByDate()`, reached through its index) and is the very code the Monatsabschluss
 * runs. Display only: nothing here is stored.
 */

import type { Prisma } from "@clokr/db";
import type { EmployeeScope } from "../platform";
import {
  bsDayPriority,
  rosterPlannedNettoByDate,
  shiftBasedLeaveRelief,
  toCloseMonthApprovedLeave,
} from "../working-time-account";
import { getShiftsInRange } from "./facade/shifts";

/**
 * Sort full-day rows before half-day rows, then by startDate - mirrors the `sortForDedup` order of
 * `close-employee-month.ts` (no `id` tiebreak: the roster's leave/absence rows select no id for
 * the Planungs-Soll, matching the other callers that omit it).
 */
export function sortForSollDedup<
  T extends { startDate: Date; endDate: Date; halfDay?: boolean | null },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.halfDay ? 1 : 0) - (b.halfDay ? 1 : 0) || a.startDate.getTime() - b.startDate.getTime(),
  );
}

type DaySchedule = (Record<string, unknown> & { type: string }) | undefined;

/** Midnight UTC of a tenant-local calendar day string (the `@db.Date` convention). */
function dayStart(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

/**
 * Per person, the minutes the approved leave of the displayed week relieves on its SHIFT_BASED days,
 * priced by the saldo core's own rule. Every effective leave row of such a day goes through it
 * (contract-basis types such as vacation as well as the roster-basis sick / child sick / Sonderurlaub
 * rows), because the weekly cap and the first claim of a day are computed over all of them together.
 *
 * The days it prices are claimed into `claimSetFor(person)`, so the roster's Ø-day loops find them
 * already claimed and price them at 0; days of a non-SHIFT_BASED contract in a mixed week stay with
 * those loops. The week is priced per calendar-month piece and per contract, like the saldo closes
 * months and `computeWeekProgress` splits the week.
 *
 * "Planned" means the person's non-deleted shifts in ANY salon, independent of the caller's reach
 * and salon filter: the relief is a person figure like the contract Soll. Those shifts are only read
 * here and never returned. Only totals above 0 are returned.
 */
export async function shiftBasedLeaveMinutesByEmp(
  db: Prisma.TransactionClient,
  input: {
    scope: EmployeeScope;
    employees: ReadonlyArray<{
      id: string;
      breakOver6hOverride: number | null;
      breakOver9hOverride: number | null;
      birthDate: Date | null;
    }>;
    weekDays: readonly string[];
    schedulesByDay: ReadonlyMap<string, ReadonlyArray<DaySchedule>>;
    leave: ReadonlyArray<{
      employeeId: string;
      startDate: Date;
      endDate: Date;
      halfDay: boolean;
      leaveType: { code: string | null } | null;
    }>;
    bsDaysByEmp: ReadonlyMap<string, ReadonlySet<string>>;
    tz: string;
    tenantConfig: {
      defaultBreakOver6h: number;
      defaultBreakOver9h: number;
      defaultWorkDays: number[];
    } | null;
    claimSetFor: (employeeId: string) => Set<string>;
  },
): Promise<Map<string, number>> {
  const { employees, weekDays, schedulesByDay, leave, bsDaysByEmp, tz, tenantConfig } = input;
  const result = new Map<string, number>();

  const leaveByEmp = new Map<string, typeof leave>();
  for (const lr of leave) {
    leaveByEmp.set(lr.employeeId, [...(leaveByEmp.get(lr.employeeId) ?? []), lr]);
  }
  const persons = employees.filter(
    (emp) =>
      leaveByEmp.has(emp.id) &&
      (schedulesByDay.get(emp.id) ?? []).some((ws) => ws?.type === "SHIFT_BASED"),
  );
  if (persons.length === 0 || weekDays.length === 0) return result;

  const weekShifts = await getShiftsInRange(
    db,
    input.scope,
    dayStart(weekDays[0]!),
    dayStart(weekDays[weekDays.length - 1]!),
  );
  const shiftsByEmp = new Map<string, typeof weekShifts>();
  for (const sh of weekShifts) {
    shiftsByEmp.set(sh.employeeId, [...(shiftsByEmp.get(sh.employeeId) ?? []), sh]);
  }

  const breakTenant = {
    defaultBreakOver6h: tenantConfig?.defaultBreakOver6h ?? 30,
    defaultBreakOver9h: tenantConfig?.defaultBreakOver9h ?? 45,
  };

  for (const emp of persons) {
    const perDay = schedulesByDay.get(emp.id) ?? [];
    const approvedLeave = toCloseMonthApprovedLeave(leaveByEmp.get(emp.id) ?? []);
    const employeeBreak = {
      breakOver6hOverride: emp.breakOver6hOverride,
      breakOver9hOverride: emp.breakOver9hOverride,
      birthDate: emp.birthDate,
    };

    // A run is a stretch of days of one calendar month under one contract.
    let runStart = 0;
    for (let i = 1; i <= weekDays.length; i++) {
      const sameRun =
        i < weekDays.length &&
        weekDays[i]!.slice(0, 7) === weekDays[runStart]!.slice(0, 7) &&
        perDay[i] === perDay[runStart];
      if (sameRun) continue;
      const runSchedule = perDay[runStart];
      const runFrom = weekDays[runStart]!;
      const runTo = weekDays[i - 1]!;
      runStart = i;
      if (runSchedule?.type !== "SHIFT_BASED") continue;

      const plannedNettoByDate = rosterPlannedNettoByDate(
        shiftsByEmp.get(emp.id) ?? [],
        employeeBreak,
        breakTenant,
        runFrom,
        runTo,
        tz,
      );
      // Mirrors the saldo core's `bsDatesInMonth`: only the Berufsschultage inside the range.
      const bsInRun = new Set(
        [...(bsDaysByEmp.get(emp.id) ?? [])].filter((d) => d >= runFrom && d <= runTo),
      );
      const relief = shiftBasedLeaveRelief({
        approvedLeave,
        schedule: runSchedule,
        defaultWorkDays: tenantConfig?.defaultWorkDays,
        rangeStart: dayStart(runFrom),
        rangeEnd: dayStart(runTo),
        tz,
        plannedNettoByDate,
        bsPriority: bsDayPriority(bsInRun, tz),
        claimed: input.claimSetFor(emp.id),
      });
      if (relief.creditMinutes > 0) {
        result.set(emp.id, (result.get(emp.id) ?? 0) + relief.creditMinutes);
      }
    }
  }
  return result;
}
