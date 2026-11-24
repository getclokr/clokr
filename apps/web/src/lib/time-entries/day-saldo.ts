// Issue #1029: the one place the web reads the day series of GET /overtime/month-saldo. Nothing is
// computed here: the day difference is the account's own day step (`days[].balanceMinutes`, #594 -
// exactly cumulative(D) - cumulative(D-1), and the days add up to the Monatssaldo) and the running
// figure is the account's cumulative series (`days[].cumulativeSaldoMinutes`, #681). A day the
// server states no step for (today, future, a closed month's single terminal entry, withheld day
// details #86) shows no difference - the browser never subtracts a Soll itself.
import { fmtBalance } from "$lib/utils/format-minutes";

/** The fields of one `days[]` item of GET /overtime/month-saldo this module reads. */
export interface ServerDayFigures {
  date: string;
  cumulativeSaldoMinutes: number;
  /** The day step; absent on the single terminal entry of a closed month. */
  balanceMinutes?: number;
}

export interface DaySaldo {
  /** The server's day step; null where the server states none. */
  diffMin: number | null;
  /** The running account saldo up to and including the day. */
  runningMin: number;
}

/** Label of the running figure wherever it is shown - never as an unlabelled number (#1029). */
export const RUNNING_SALDO_LABEL = "Gesamtsaldo bis zu diesem Tag";

/** Tooltip of every column or figure named „Differenz“. */
export const DAY_DIFF_TITLE = "So verändert dieser Tag den Gesamtsaldo.";

/**
 * Maps every date of the server's day series to its two figures. `withheld` (#86: the caller may
 * not read this person's day lists) and a missing series give an empty map.
 */
export function daySaldoByDate(
  days: readonly ServerDayFigures[] | null | undefined,
  withheld = false,
): Map<string, DaySaldo> {
  const map = new Map<string, DaySaldo>();
  if (withheld || !days) return map;
  for (const d of days) {
    map.set(d.date, {
      diffMin: typeof d.balanceMinutes === "number" ? d.balanceMinutes : null,
      runningMin: d.cumulativeSaldoMinutes,
    });
  }
  return map;
}

/** „+0:30“, „±0:00“, „−1:15“ - the format of the list chips and the day view (P-1029-07). */
export function dayDiffText(min: number): string {
  return fmtBalance(min);
}

/** The tooltip part of a calendar cell: the day step and the labelled running saldo. */
export function daySaldoTitle(s: DaySaldo | undefined): string | undefined {
  if (!s) return undefined;
  const parts: string[] = [];
  if (s.diffMin !== null) parts.push(`Differenz: ${dayDiffText(s.diffMin)}`);
  parts.push(`${RUNNING_SALDO_LABEL}: ${dayDiffText(s.runningMin)}`);
  return parts.join(" · ");
}
