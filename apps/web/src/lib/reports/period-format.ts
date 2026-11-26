/**
 * Issue #612, UI-SPEC "Number format" — minutes in, German text out.
 *
 * Hours are always H:MM taken from whole minutes (built on `fmtMin` / `fmtBalance`) with a German
 * thousands separator on the hour part; never from rounded decimal hours (Pitfall 8). Days carry
 * at most two decimals with a decimal comma (Issue #993 N-05).
 */

import { fmtBalance, fmtMin } from "$lib/utils/format-minutes";
import { MONTH_NAMES_DE } from "./period-state";

function group(digits: string): string {
  // A linear walk instead of a look-ahead regex (Sonar S8786: super-linear backtracking).
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    parts.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return parts.join(".");
}

/**
 * Minutes as H:MM with a grouped hour part: 230535 → "3.842:15". With `signed` a sign
 * character is always shown: "+12:45", "−0:45" (U+2212), "±0:00".
 */
export function fmtHoursDe(min: number, opts?: { signed?: boolean }): string {
  const whole = Math.round(min);
  const [hours, minutes] = fmtMin(whole).split(":");
  const body = `${group(hours)}:${minutes}`;
  if (!opts?.signed) return body;
  const sign = fmtBalance(whole).charAt(0);
  return `${sign}${body}`;
}

/**
 * Days with at most two decimals and a decimal comma, no trailing zeros: 12.5 → "12,5", 12 → "12",
 * 6.25 → "6,25". Issue #993 N-05 (D-993-04): the same day figure reads the same in the table, the
 * person tab (`formatDays`) and the PDF (`fmtDecimalDe`); the one-decimal rule of #612 showed 6,25 as
 * 6,3. Integer arithmetic only, no `toFixed`.
 */
export function fmtDaysDe(days: number): string {
  // The epsilon keeps a binary-float value such as 2.255 * 100 = 225.49999... on the side the
  // decimal reading expects (the PDF helper does the same).
  const scaled = Math.round(Math.abs(days) * 100 + 1e-9);
  const int = Math.floor(scaled / 100);
  const fraction = scaled % 100;
  const intText = group(String(int));
  const text = fraction === 0 ? intText : `${intText},${trimFraction(fraction)}`;
  return days < 0 && scaled !== 0 ? `−${text}` : text;
}

/** 5 → "05", 50 → "5", 25 → "25" (a two-digit fraction without its trailing zero). */
function trimFraction(fraction: number): string {
  return fraction % 10 === 0 ? String(fraction / 10) : String(fraction).padStart(2, "0");
}

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-03-31" → "31.03.2026"; anything else is returned unchanged. */
export function fmtDateDe(isoDay: string): string {
  const m = ISO_DAY_RE.exec(isoDay);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : isoDay;
}

/** "2026-03-31" → "31.03."; anything else is returned unchanged. */
export function fmtDateShortDe(isoDay: string): string {
  const m = ISO_DAY_RE.exec(isoDay);
  return m ? `${m[3]}.${m[2]}.` : isoDay;
}

/** (2026, 7) → "Juli 2026". */
export function monthNameDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Issue #1011: the ONE running-month rule of the web. `asOf` (`YYYY-MM-DD`, the server's
 * tenant-local yesterday or a report's `closingAsOf`) is the Stichtag of the month `to`
 * (`YYYY-MM`) when it lies before that month's last calendar day, else null (a month that is
 * whole). Pure, no clock read; malformed input returns null.
 */
export function runningMonthStichtag(to: string, asOf: string): string | null {
  const ym = YEAR_MONTH_RE.exec(to);
  if (!ym || !ISO_DAY_RE.test(asOf)) return null;
  const lastDay = new Date(Date.UTC(Number(ym[1]), Number(ym[2]), 0)).getUTCDate();
  const lastIso = `${ym[1]}-${ym[2]}-${String(lastDay).padStart(2, "0")}`;
  return asOf >= lastIso ? null : asOf;
}

/**
 * Issue #985 (D-01): the period report counts the running month like the Arbeitszeitkonto - Soll,
 * Ist and saldo through tenant-local yesterday. The page derives no figure; this only names the
 * Stichtag. `to` is the answer's `YYYY-MM`, `closingAsOf` its `kpis.closingAsOf` (`YYYY-MM-DD`): the
 * server sets it to yesterday when `to` is the running month and to the last day of `to` otherwise,
 * so the note is due exactly when `closingAsOf` lies before the last calendar day of `to`. Pure, no
 * clock read; malformed input returns null. Since #1011 the absence counts of the running month stop at
 * the same day, so the note names them too. It lives here and not in `period-state.ts` because this
 * module already imports from that one - the reverse import would create a cycle.
 */
export function runningMonthNote(to: string, closingAsOf: string): string | null {
  const stichtag = runningMonthStichtag(to, closingAsOf);
  if (stichtag === null) return null;
  return `Laufender Monat bis gestern (${fmtDateShortDe(stichtag)}): Soll, Ist, Saldo und Abwesenheiten zählen bis zu diesem Tag.`;
}

/**
 * Issue #1011: the label of the two absence tables of the Urlaub tab. When the period ends in the
 * running month the absence counts stop at the report's Stichtag (`closingAsOf`), so the label names
 * it: „Januar – November 2026 · bis 14.11.2026“. Otherwise (or for malformed input) the label as is.
 */
export function absencePeriodLabel(
  label: string,
  to: string | null,
  closingAsOf: string | null,
): string {
  if (to === null || closingAsOf === null) return label;
  const stichtag = runningMonthStichtag(to, closingAsOf);
  return stichtag === null ? label : `${label} · bis ${fmtDateDe(stichtag)}`;
}
