/**
 * Issue #1079 (D-02, D-03, D-05, D-06) - the ONE rule of who a Betriebsurlaub affects on which day.
 * Pure and import-free: only strings and arrays, so every reader shares it without a cycle.
 *
 * Readers (AC3, "no second computation"): the booking (`company-shutdown/booking.ts`), the leave
 * planner read (`leave-plan/planner-read.ts`) and the Bestand script
 * (`scripts/audit-1069-company-shutdown-bookings.ts`).
 *
 *  - A Betriebsurlaub without salons applies to the whole Unternehmen: every day of its period.
 *  - A Betriebsurlaub with salons affects a person on a day when the person's Stammsalon (the HOME
 *    assignment of that tenant-local day, `homeSalonsForDays`) is one of the named salons (D-02).
 *    A person without a Stammsalon on a day is never affected by a salon-scoped Betriebsurlaub.
 *  - The evaluation is per day (D-03): a person who changes the Stammsalon inside the period is
 *    affected only on the days in a named salon. The booking unit is a contiguous run of affected
 *    days split at calendar month boundaries.
 *  - Two Betriebsurlaube conflict when their periods share a day AND their scopes meet (D-05).
 *
 * All days are tenant-local calendar days, `YYYY-MM-DD`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** An inclusive range of calendar days. */
export type DayRange = { start: string; end: string };

/** `YYYY-MM-DD` of a UTC-midnight instant. */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The contiguous runs of days of `[from, to]` the Betriebsurlaub affects for one person.
 *
 *  - No salons: the single range `from..to` (empty when `from` is after `to`).
 *  - Salons: the runs of consecutive days whose Stammsalon (`homeSalonByDay`) is one of the salons;
 *    a day with a null or foreign salon, or without an entry, breaks a run. Without a map: none.
 */
export function shutdownAffectedRuns(input: {
  from: string;
  to: string;
  salonIds: readonly string[];
  homeSalonByDay?: ReadonlyMap<string, string | null> | undefined;
}): DayRange[] {
  const { from, to, salonIds, homeSalonByDay } = input;
  if (from > to) return [];
  if (salonIds.length === 0) return [{ start: from, end: to }];
  if (!homeSalonByDay) return [];

  const named = new Set(salonIds);
  const runs: DayRange[] = [];
  let open: DayRange | null = null;
  for (let cursor = Date.parse(from); cursor <= Date.parse(to); cursor += DAY_MS) {
    const day = dayOf(new Date(cursor));
    const salonId = homeSalonByDay.get(day) ?? null;
    if (salonId !== null && named.has(salonId)) {
      if (open) open.end = day;
      else {
        open = { start: day, end: day };
        runs.push(open);
      }
    } else {
      open = null;
    }
  }
  return runs;
}

/** Splits `[from, to]` (inclusive) at calendar month boundaries. */
function splitByMonth(from: string, to: string): DayRange[] {
  const segments: DayRange[] = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const lastOfMonth = dayOf(new Date(Date.UTC(year, month, 0)));
    segments.push({ start: cursor, end: lastOfMonth < to ? lastOfMonth : to });
    cursor = dayOf(new Date(Date.UTC(year, month, 1)));
  }
  return segments;
}

/**
 * The booking segments of a person: every affected run split at month boundaries (D-03). One
 * segment is one COMPANY_SHUTDOWN absence; for a Betriebsurlaub without salons this is exactly one
 * segment per calendar month of the person's days (the #1069 behaviour).
 */
export function shutdownBookingSegments(runs: readonly DayRange[]): DayRange[] {
  return runs.flatMap((run) => splitByMonth(run.start, run.end));
}

/**
 * D-05: whether two Betriebsurlaube conflict - their periods share a day AND their scopes meet
 * (either has no salons = the whole Unternehmen, or the salon sets intersect).
 */
export function shutdownScopesConflict(
  a: { start: string; end: string; salonIds: readonly string[] },
  b: { start: string; end: string; salonIds: readonly string[] },
): boolean {
  if (a.start > b.end || b.start > a.end) return false;
  if (a.salonIds.length === 0 || b.salonIds.length === 0) return true;
  const named = new Set(a.salonIds);
  return b.salonIds.some((salonId) => named.has(salonId));
}
