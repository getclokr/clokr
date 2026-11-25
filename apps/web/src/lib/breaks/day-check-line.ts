// Issue #1029: the slim line above the Team › Zeiten calendar that names the days with a day-check
// result, instead of one full callout per day. The browser derives no finding here - it only groups
// the server's day checks by the server's own flags (`breakFinding`, `acknowledged`) and by the one
// rule that decides whether the break panel has anything to show. A redacted check (#85 D-07) is
// never a „Pausenbefund“: it sits in the neutral „Hinweis“ group with every other non-finding day,
// so the line reveals nothing a partial reach may not see; the line prints dates only.
import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { DayCheck } from "$lib/breaks/day-break-violation";

/**
 * How many days the sentence names; the rest is counted and opens the full list view.
 *
 * Issue #1028 (P-07) deliberately KEEPS this cap: the line is ONE sentence above the Zeiten calendar -
 * the shape #1029 accepted - not a list widget, and its „N weitere“ already is a button that opens the
 * full list. It has its own constant (it used to borrow the #987 one of Mein Tag, which #1028 removed).
 */
export const DAY_CHECK_LINE_NAMED_DAYS = 5;

/** The newest `max` distinct days in chronological order, and how many further days there are. */
function newestDays(dates: readonly string[], max: number): { shown: string[]; more: number } {
  const sorted = [...new Set(dates)].sort();
  const shown = sorted.slice(Math.max(0, sorted.length - max));
  return { shown, more: sorted.length - shown.length };
}

/**
 * Whether the day-break panel has anything to render for this check. This is THE rule of
 * DayBreakPanel (moved here verbatim from the component, so the line and the panel never disagree).
 *
 * A withheld day always renders (its hint is the whole point); a full day is shown for a
 * cross-salon finding (open or acknowledged), a cross-salon § 3 breach or as soon as a day break is
 * recorded on it. A single-entry finding day is shown only when the caller can act on it
 * (acknowledge, record a break) or an acknowledgement exists.
 */
export function dayBreakPanelVisible(check: DayCheck): boolean {
  if (check.detail !== "full") return true;
  const dayBreaks = check.dayBreaks ?? [];
  return (
    (check.crossSalon && (check.breakFinding || check.maxDailyExceeded)) ||
    dayBreaks.length > 0 ||
    (check.breakFinding && (check.mayAcknowledge || check.mayRecordDayBreak || check.acknowledged))
  );
}

export interface DayCheckGroup {
  /** The days named in the line, chronological (at most `DAY_CHECK_LINE_NAMED_DAYS`). */
  days: string[];
  /** How many further days of this group are not named. */
  more: number;
  /** All days of the group. */
  total: number;
}

export interface DayCheckLineModel {
  /** Open break findings (server `breakFinding` and not acknowledged). */
  findings: DayCheckGroup;
  /** Every other day the break panel has something to show for. */
  others: DayCheckGroup;
}

function group(days: string[]): DayCheckGroup {
  const { shown, more } = newestDays(days, DAY_CHECK_LINE_NAMED_DAYS);
  return { days: shown, more, total: days.length };
}

/** The two groups of the line; null when there is nothing to name. */
export function dayCheckLine(checks: readonly DayCheck[]): DayCheckLineModel | null {
  const findings: string[] = [];
  const others: string[] = [];
  for (const check of checks) {
    if (check.detail === "full" && check.breakFinding === true && check.acknowledged === false) {
      findings.push(check.date);
    } else if (dayBreakPanelVisible(check)) {
      others.push(check.date);
    }
  }
  if (findings.length === 0 && others.length === 0) return null;
  return { findings: group(findings), others: group(others) };
}

/** „Mi 04.11.“ for a `YYYY-MM-DD` day. */
export function lineDayLabel(day: string): string {
  return format(new Date(`${day}T12:00:00`), "EEEEEE dd.MM.", { locale: de });
}
