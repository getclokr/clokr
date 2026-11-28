/**
 * Issue #613 (P-03) - the label that names the exit day of a person in the Monatsabschluss.
 *
 * The server sends `exitDate` as the tenant-local calendar day (`YYYY-MM-DD`) on every status row
 * of a person with an exit date, `null` otherwise. The web only formats that string: it is split,
 * never parsed into a `Date`, so no browser time zone can move the day.
 */
import { dayLabel } from "$lib/utils/day-label";

const ISO_DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "Austritt am T.M.JJJJ", or `null` when there is no (or no well-formed) exit day. */
export function exitLabel(exitDate: string | null | undefined): string | null {
  if (!exitDate) return null;
  if (!ISO_DAY.test(exitDate)) return null;
  return `Austritt am ${dayLabel(exitDate, { year: true })}`;
}
