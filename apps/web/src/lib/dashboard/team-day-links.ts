// Issue #587 (D-587-4) — links from the team week and the attendance list into EXISTING flows.
//
// The receivers (`/team/time-entries`, `/team/leave`) validate every parameter themselves with
// `normalizeEmployeeIdParam` / `normalizeDateParam` and enforce their own permissions; these
// helpers only build relative URLs from ids the API already sent. A value that would not pass the
// receiver's validation yields `null`, so a caller leaves the element unlinked instead of
// rendering a link the target would ignore. No caller-supplied path segment ever enters a URL.
import { dayLabel } from "$lib/utils/day-label";
import { normalizeDateParam, normalizeEmployeeIdParam } from "$lib/breaks/deep-link";

/**
 * `/team/time-entries?employeeId=<id>` or `null` when the id is unusable (Issue #588, P-11): the
 * person link of the dashboard card "Salden". The receiver selects the person and shows their month;
 * the caller decides with `mayOpenTeamPage` whether the link may exist at all.
 */
export function teamPersonHref(employeeId: string): string | null {
  const id = normalizeEmployeeIdParam(employeeId);
  if (id === null) return null;
  const params = new URLSearchParams({ employeeId: id });
  return `/team/time-entries?${params.toString()}`;
}

/** `/team/time-entries?employeeId=<id>&date=<day>` or `null` when id or day is unusable. */
export function teamDayHref(employeeId: string, day: string): string | null {
  const id = normalizeEmployeeIdParam(employeeId);
  const date = normalizeDateParam(day);
  if (id === null || date === null || date !== day) return null;
  const params = new URLSearchParams({ employeeId: id, date });
  return `/team/time-entries?${params.toString()}`;
}

/** `/team/leave?create=1&employeeId=<id>&date=<day>` or `null` when id or day is unusable. */
export function teamLeaveCreateHref(employeeId: string, day: string): string | null {
  const id = normalizeEmployeeIdParam(employeeId);
  const date = normalizeDateParam(day);
  if (id === null || date === null || date !== day) return null;
  const params = new URLSearchParams({ create: "1", employeeId: id, date });
  return `/team/leave?${params.toString()}`;
}

/**
 * The accessible name of a team-week cell: „<name>, <Wochentag> <T.M.>: <status>“.
 * The weekday comes from the shared `dayLabel`, read at noon UTC, never from a local `getDay()`.
 */
export function teamCellAriaLabel(name: string, day: string, statusText: string): string {
  return `${name}, ${dayLabel(day, { weekday: true })}: ${statusText}`;
}
