// Issue #1011 (finding U-01 of 16.11.2026): the running month of Verwalten › Monatsabschluss opens read-only.
// The API already ends the running month's gap window at the tenant-local yesterday (#986) and redacts the
// dates per person (#86 D-02); the web only refused to open the month. Presentation only: the API refuses a
// close of a not-ended month with 400 regardless.
import { isRunningMonth } from "$lib/saldo/month-status";
import type { MonthStatus } from "$lib/month-close/types";

/** Note above the persons of the running month. */
export const RUNNING_MONTH_NOTE =
  "Der Monat läuft noch: Fehlende Tage zählen bis gestern, der Abschluss folgt nach dem Monatsende.";

/** Reason cell of the running month's row. */
export const RUNNING_MONTH_REASON = "Abschluss nach Monatsende";

/** Chip of a person without gaps so far (instead of „Bereit“, which would announce a close). */
export const RUNNING_READY_LABEL = "Bisher vollständig";

/** The month is reported as `future` by the API and is today's month. */
export function isRunningMonthStatus(ms: MonthStatus, year: number, today: string): boolean {
  return ms.status === "future" && isRunningMonth(year, ms.month, today);
}

/** Whether a month row opens its persons: never `no_data`; `future` only when running and it has persons. */
export function canOpenMonth(ms: MonthStatus, year: number, today: string): boolean {
  if (ms.status === "no_data") return false;
  if (ms.status === "future") return isRunningMonthStatus(ms, year, today) && ms.totalCount > 0;
  return true;
}
