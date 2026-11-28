/**
 * Issue #1095 - the Betriebsurlaub days the absence calendar draws that no leave request already shows.
 *
 * A Betriebsurlaub books ONE imposed `Absence` (code COMPANY_SHUTDOWN) per person and month over the
 * person's shutdown days, whatever `deductsFromVacation` says; with a deduction it books Urlaub
 * requests on top (`LeaveRequest.companyShutdownId`). The calendar already draws every request, so
 * drawing the absence as well would show a vacation day twice. This module returns only the day runs
 * of those absences that NO leave row of the same person covers: the paid release days (no deduction,
 * or the days beyond the remaining entitlement).
 *
 * Display only - nothing here feeds a saldo, a close or a booking. The kernel is pure and works on
 * `YYYY-MM-DD` strings; the one read is tenant-scoped through the employee.
 */
import type { Prisma } from "@clokr/db";

/** The code of an imposed Betriebsurlaub absence; the display name is `DISPLAY_NAME` of `leave-type.ts`. */
export const COMPANY_SHUTDOWN_ABSENCE_CODE = "COMPANY_SHUTDOWN";

export interface ShutdownAbsenceRow {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  companyShutdown: { id: string; name: string } | null;
  employee: { id: string; firstName: string; lastName: string; userId: string | null };
}

/** The part of a leave row the dedupe needs: whose days, which days. */
export interface CoveringLeaveRow {
  employeeId: string;
  startDate: Date;
  endDate: Date;
}

/** A release-day run shaped like a leave row so the calendar's narrowing and masking apply unchanged. */
export interface ReleaseDayRow {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  companyShutdownId: string | null;
  companyShutdown: { id: string; name: string } | null;
  employee: ShutdownAbsenceRow["employee"];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function* eachDay(from: string, to: string): Generator<string> {
  for (let t = parseDay(from).getTime(); t <= parseDay(to).getTime(); t += DAY_MS) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * The release-day runs of `absences`, clipped to `window` (inclusive calendar days) and minus every
 * day a row of `covering` of the same person already draws. A run is a maximal sequence of
 * consecutive uncovered days of one absence; its id names the absence and the first day, so it is
 * stable between two reads of the same data.
 */
export function releaseDayRuns(
  absences: readonly ShutdownAbsenceRow[],
  covering: readonly CoveringLeaveRow[],
  window: { from: string; to: string },
): ReleaseDayRow[] {
  const coveredByPerson = new Map<string, Set<string>>();
  for (const row of covering) {
    let days = coveredByPerson.get(row.employeeId);
    if (days === undefined) {
      days = new Set<string>();
      coveredByPerson.set(row.employeeId, days);
    }
    // Only days inside the window can matter; clipping keeps a year-long request cheap.
    const from = dayString(row.startDate) > window.from ? dayString(row.startDate) : window.from;
    const to = dayString(row.endDate) < window.to ? dayString(row.endDate) : window.to;
    for (const day of eachDay(from, to)) days.add(day);
  }

  const out: ReleaseDayRow[] = [];
  for (const absence of absences) {
    const from =
      dayString(absence.startDate) > window.from ? dayString(absence.startDate) : window.from;
    const to = dayString(absence.endDate) < window.to ? dayString(absence.endDate) : window.to;
    const covered = coveredByPerson.get(absence.employeeId);
    let runStart: string | null = null;
    let runEnd: string | null = null;
    const flush = () => {
      if (runStart === null || runEnd === null) return;
      out.push({
        id: `shutdown-release-${absence.id}-${runStart}`,
        employeeId: absence.employeeId,
        startDate: parseDay(runStart),
        endDate: parseDay(runEnd),
        companyShutdownId: absence.companyShutdown?.id ?? null,
        companyShutdown: absence.companyShutdown,
        employee: absence.employee,
      });
      runStart = null;
      runEnd = null;
    };
    for (const day of eachDay(from, to)) {
      if (covered?.has(day)) {
        flush();
        continue;
      }
      if (runStart === null) runStart = day;
      runEnd = day;
    }
    flush();
  }
  return out;
}

/**
 * Every active COMPANY_SHUTDOWN absence of the tenant overlapping `[firstDay, lastDay]`, with the
 * name of the shutdown it came from. Soft-deleted rows are left out; tenant isolation is the
 * employee's.
 */
export async function findShutdownAbsences(
  db: Prisma.TransactionClient,
  tenantId: string,
  firstDay: Date,
  lastDay: Date,
): Promise<ShutdownAbsenceRow[]> {
  return db.absence.findMany({
    where: {
      employee: { tenantId },
      deletedAt: null,
      type: COMPANY_SHUTDOWN_ABSENCE_CODE,
      startDate: { lte: lastDay },
      endDate: { gte: firstDay },
    },
    select: {
      id: true,
      employeeId: true,
      startDate: true,
      endDate: true,
      companyShutdown: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true, userId: true } },
    },
    orderBy: { startDate: "asc" },
  });
}
