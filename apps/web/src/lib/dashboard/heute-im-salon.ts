/**
 * Issue #846 — the pure derivations of the start page „Heute im Salon“ (Team › Heute im Salon).
 *
 * Every status is the server's decision (`resolveDayStatus`, #587) as `GET /dashboard/today-attendance`
 * and `GET /dashboard/team-week` answer it, inside the caller's reach and salon filter (#82/#84/#85).
 * This module only COUNTS those statuses and words them; it never derives a status, an hour or a Soll.
 *
 * - `attendanceBand()`     — the counts of the Kennzahlen-Band (Anwesend x von y, Erwartet, Abwesend).
 * - `ATTENDANCE_FILTERS`   — the list filter a Kennzahl links to (D-01: every figure opens its list).
 * - `openTeamLeaveTasks()` — the open leave requests this person may decide (never the own one: the
 *   four-eyes rule of the review route, mirrored so no impossible decision is offered).
 * - `TEAM_WEEK_PAGE_SIZE`  — D-02: the team week pages only from 25 persons on.
 */
import type { TodayAttendanceData, TodayEmployee } from "$lib/reports/today-attendance";
import type { LeaveReviewRequest } from "$lib/leave/leave-review";
import { LEAVE_TYPE_OPTIONS } from "$lib/leave/team-calendar-visibility";

export const TEAM_WEEK_PAGE_SIZE = 25;

/** Statuses that mean the person is expected in the salon today. */
const EXPECTED_TODAY: ReadonlySet<TodayEmployee["status"]> = new Set([
  "clocked_in",
  "present",
  "missing",
  "scheduled",
]);

export interface AttendanceBand {
  /** Clocked in right now. */
  present: number;
  /** Persons expected today (clocked in, worked already, missing or still to come). */
  expected: number;
  /** Persons whose shift started and who have not clocked in („Fehlt“). */
  missing: number;
  /** Persons still to come today („Geplant“). */
  scheduled: number;
  /** Absent today (leave, sickness, Berufsschule …). */
  absent: number;
  /** Already worked today and clocked out. */
  done: number;
}

export function attendanceBand(data: TodayAttendanceData | null): AttendanceBand {
  const band: AttendanceBand = {
    present: 0,
    expected: 0,
    missing: 0,
    scheduled: 0,
    absent: 0,
    done: 0,
  };
  for (const e of data?.employees ?? []) {
    if (EXPECTED_TODAY.has(e.status)) band.expected++;
    if (e.status === "clocked_in") band.present++;
    else if (e.status === "missing") band.missing++;
    else if (e.status === "scheduled") band.scheduled++;
    else if (e.status === "present") band.done++;
    else if (e.status === "absent") band.absent++;
  }
  return band;
}

/** The filters of the „Jetzt im Salon“ list; the key is the URL value (`?status=`). */
export const ATTENDANCE_FILTERS = {
  alle: { label: "Alle", statuses: null },
  anwesend: { label: "Anwesend", statuses: ["clocked_in", "present"] },
  erwartet: { label: "Erwartet", statuses: ["missing", "scheduled"] },
  abwesend: { label: "Abwesend", statuses: ["absent"] },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly TodayEmployee["status"][] | null }
>;

export type AttendanceFilter = keyof typeof ATTENDANCE_FILTERS;

/** Reads the filter from a URL value; anything unknown is „alle“ (allow-list). */
export function attendanceFilterOf(value: string | null | undefined): AttendanceFilter {
  return value !== null && value !== undefined && value in ATTENDANCE_FILTERS
    ? (value as AttendanceFilter)
    : "alle";
}

/** The rows of the list under a filter; „alle“ hides only persons with nothing today. */
export function filterAttendance(
  rows: readonly TodayEmployee[],
  filter: AttendanceFilter,
): TodayEmployee[] {
  const statuses = ATTENDANCE_FILTERS[filter].statuses as readonly string[] | null;
  if (statuses === null) return rows.filter((r) => r.status !== "none");
  return rows.filter((r) => statuses.includes(r.status));
}

/** A row of `GET /leave/requests?status=PENDING`, the shape the shared review dialog takes. */
export type TeamTaskLeave = LeaveReviewRequest;

/** The open requests the caller may decide: PENDING, not the caller's own, oldest start first. */
export function openTeamLeaveTasks(
  rows: readonly TeamTaskLeave[],
  myEmployeeId: string | null | undefined,
): TeamTaskLeave[] {
  return rows
    .filter((r) => r.status === "PENDING" && r.employeeId !== (myEmployeeId ?? null))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

/** The display name of a leave type code (the one requestable list), never `leaveType.name`. */
export function leaveTypeLabel(code: string): string {
  return LEAVE_TYPE_OPTIONS.find((t) => t.code === code)?.label ?? code;
}

// ── Issue #987: the missing days of the running month ──────────────────────────────────────────
// Whether a past day is „Fehlt“ is the server's decision (`resolveDayStatus`); this part only
// chooses WHICH weeks to ask for and collects the days the server already named „missing“.

/** The slice of a `GET /dashboard/team-week` answer the collection reads. */
export interface MissingWeekSource {
  team: ReadonlyArray<{
    id: string;
    name: string;
    days: ReadonlyArray<{ date: string; status: string }>;
  }>;
}

/** One person with the past days of the running month the server named „missing“. */
export interface MissingDaysRow {
  id: string;
  name: string;
  days: string[];
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday of the ISO week of a calendar day. */
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return isoOf(utcDay(iso) - ((dow + 6) % 7) * DAY_MS);
}

/**
 * The Mondays of every week that holds a day of `[fromIso, toExclusiveIso)`, ascending. The
 * caller passes tenant-local `YYYY-MM-DD` strings; no clock is read here.
 */
export function weekMondaysIn(fromIso: string, toExclusiveIso: string): string[] {
  const out = new Set<string>();
  for (let t = utcDay(fromIso); t < utcDay(toExclusiveIso); t += DAY_MS) {
    out.add(mondayOf(isoOf(t)));
  }
  return [...out].sort();
}

/**
 * The Mondays of every week that holds a day from the first of `todayStr`'s month up to
 * yesterday, EXCEPT the current week (the page already holds it).
 */
export function pastWeeksOfMonth(todayStr: string): string[] {
  const currentMonday = mondayOf(todayStr);
  return weekMondaysIn(`${todayStr.slice(0, 7)}-01`, todayStr).filter((m) => m !== currentMonday);
}

/**
 * The days of one person that the server named „missing“ in the given team-week answers, or
 * `null` when the person appears in none of them (outside the caller's reach or without a
 * contract): then the server made no statement and the caller keeps what it had.
 */
export function serverMissingDatesOf(
  weeks: ReadonlyArray<MissingWeekSource>,
  employeeId: string,
): Set<string> | null {
  let known = false;
  const days = new Set<string>();
  for (const week of weeks) {
    for (const member of week.team) {
      if (member.id !== employeeId) continue;
      known = true;
      for (const day of member.days) if (day.status === "missing") days.add(day.date);
    }
  }
  return known ? days : null;
}

/**
 * Per person the days of the running month before today whose server status is „missing“, over
 * the given weeks (a day that appears in two weeks counts once). Persons without such a day are
 * left out; the order is by name, the days ascend.
 */
export function missingDaysOfMonth(
  weeks: ReadonlyArray<MissingWeekSource>,
  todayStr: string,
): MissingDaysRow[] {
  const first = `${todayStr.slice(0, 7)}-01`;
  const byPerson = new Map<string, { name: string; days: Set<string> }>();
  for (const week of weeks) {
    for (const member of week.team) {
      for (const day of member.days) {
        if (day.status !== "missing" || day.date < first || day.date >= todayStr) continue;
        const entry = byPerson.get(member.id) ?? { name: member.name, days: new Set<string>() };
        entry.days.add(day.date);
        byPerson.set(member.id, entry);
      }
    }
  }
  return [...byPerson.entries()]
    .map(([id, v]) => ({ id, name: v.name, days: [...v.days].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

/**
 * Issue #987 (owner 16.11.2026): Mein Tag's „Für dich“ names at most this many missing days; the rest is
 * one summary row that opens Zeiten. The newest days are shown (the ones still easy to remember); the
 * order stays chronological.
 */
export const FOR_YOU_MISSING_DAYS_SHOWN = 5;

export function capMissingDays(
  dates: readonly string[],
  max: number = FOR_YOU_MISSING_DAYS_SHOWN,
): { shown: string[]; more: number } {
  const sorted = [...new Set(dates)].sort();
  const shown = sorted.slice(Math.max(0, sorted.length - max));
  return { shown, more: sorted.length - shown.length };
}
