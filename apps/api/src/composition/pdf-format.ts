/**
 * Issue #617 (D-617-3) - the ONE place PDF numbers become German text.
 *
 * Input is always MINUTES (or a plain number of days), never an hours figure that was rounded for
 * the JSON report: `fmtHM(9225)` is "153:45 h" because the minutes are split, whereas deriving it
 * from 153.75 rounded to two places would drift by a minute on other values (research Pitfall 8).
 *
 * Pure and dependency-free: no PDFKit, no ICU (`Intl` / `toLocaleString` depend on the runtime's
 * locale data and are not used), integer arithmetic only. The minus sign is the ASCII hyphen because
 * PDFKit's built-in Helvetica (WinAnsi) has no U+2212. No PDF output path calls `.toFixed` - the
 * decimal point it writes is exactly what this module exists to avoid.
 */

/** Hours and minutes from a minute count, e.g. 9225 -> "153:45 h", -30 -> "-0:30 h". */
export function fmtHM(minutes: number): string {
  const whole = Math.round(minutes);
  const abs = Math.abs(whole);
  const h = Math.floor(abs / 60);
  const mm = String(abs % 60).padStart(2, "0");
  return `${whole < 0 ? "-" : ""}${h}:${mm} h`;
}

/** Like `fmtHM` with an explicit "+" for a positive value; zero is printed unsigned. */
export function fmtSignedHM(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole > 0) return `+${fmtHM(whole)}`;
  return fmtHM(whole);
}

// The decimal-comma number and the day-count text live in `utils/number-de.ts` (Issue #1155) so
// contexts can reach them too (a context never imports from `composition/`); re-exported here for the
// PDF and CSV callers.
export { fmtDecimalDe, fmtDays } from "../utils/number-de";
