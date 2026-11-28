/**
 * Issue #1156 — the one representation of `LeaveEntitlement.carryOverDeadline`.
 *
 * The column is a `Timestamptz`, but the deadline is a calendar DAY (the Stichtag, e.g. 31 March,
 * § 7 Abs. 3 BUrlG): "the last day the carry-over may be taken". It is stored as the LAST SECOND
 * OF THAT DAY IN UTC (`YYYY-MM-DD 23:59:59Z`), never in the host's time zone:
 *
 * - every reader that names the day (warning text, `CARRYOVER_WARNED` audit value, the leave
 *   entitlement and report payloads, the web's `slice(0, 10)`) reads the UTC date part, so the
 *   writer must anchor the day in UTC for all of them to agree on the same day;
 * - the instant comparisons of the forfeiture logic (`effectiveCarryOverDays`,
 *   `carryOverAtRiskDays`, `vacationBalanceForRow`, the warning scan) compare against this exact
 *   instant, so the stored value stays what it has always been in the (UTC) production containers.
 *
 * Building the value with `new Date(y, m - 1, d, 23, 59, 59)` anchors it in the HOST zone: right
 * in a UTC container, hours off on any other host (and a whole day off at the day edge).
 * Nothing outside this file may build or read the deadline's day with host-zone accessors
 * (`getDate()`, `getMonth()`, `new Date(y, m, d, …)`).
 */

/**
 * The deadline instant for the day `day`.`month`.`year`: 23:59:59 UTC. `month` is 1-based. A day
 * past the end of the month rolls over into the next month, exactly like `Date` always has.
 */
export function carryOverDeadlineFor(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
}

/** The Stichtag a stored deadline names, as `YYYY-MM-DD` (its UTC date part). */
export function carryOverDeadlineDay(deadline: Date): string {
  return deadline.toISOString().slice(0, 10);
}

/** The Stichtag a stored deadline names, in the German reading `DD.MM.YYYY`. */
export function formatCarryOverDeadlineDe(deadline: Date): string {
  const [y, m, d] = carryOverDeadlineDay(deadline).split("-");
  return `${d}.${m}.${y}`;
}
