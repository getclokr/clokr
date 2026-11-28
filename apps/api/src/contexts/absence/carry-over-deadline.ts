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

/**
 * Issue #1162 — the deadline instant for a Stichtag a USER typed (`PUT /settings/vacation/:id`).
 *
 * A Stichtag always means "until the end of that day", so every accepted input is normalised to
 * {@link carryOverDeadlineFor}: `YYYY-MM-DD 23:59:59Z`. Never `new Date(input)`: a date-only string
 * parses to 00:00 UTC, which would forfeit the carry-over a full day early (§ 7 Abs. 3 BUrlG) and
 * make a re-save of an automatically built deadline rewrite it to 00:00.
 *
 * Accepted: a date-only `YYYY-MM-DD`, or a full ISO datetime. A datetime is read as the instant it
 * names and its UTC date part is the Stichtag (decision, Issue #1162) — the same reading every
 * other reader applies ({@link carryOverDeadlineDay}) — so `2027-03-31T00:00:00.000Z` (an old
 * stored value echoed back) and `2027-03-31T23:59:59.000Z` both mean 31 March. Its time of day
 * and offset do not move the day, except that an offset which crosses midnight UTC names the UTC
 * day (`2027-04-01T01:00:00+02:00` is 31 March 23:00Z, so 31 March).
 *
 * Returns `null` for an empty string (no deadline) and for a string that is no valid date; the
 * route schema rejects the latter with a 400 before the handler runs ({@link isCarryOverDeadlineInput}).
 */
export function parseCarryOverDeadlineInput(input: string | null | undefined): Date | null {
  if (!input) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    // Reject a calendar overflow such as 2027-02-31 instead of rolling it into March.
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      return null;
    }
    return carryOverDeadlineFor(y, m, d);
  }
  // A datetime must carry its offset or Z: without one `Date` reads it in the host zone.
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(input)) return null;
  const instant = new Date(input);
  if (Number.isNaN(instant.getTime())) return null;
  return carryOverDeadlineFor(
    instant.getUTCFullYear(),
    instant.getUTCMonth() + 1,
    instant.getUTCDate(),
  );
}

/** Schema guard: an empty string (no deadline) or an input {@link parseCarryOverDeadlineInput} accepts. */
export function isCarryOverDeadlineInput(input: string): boolean {
  return input === "" || parseCarryOverDeadlineInput(input) !== null;
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
