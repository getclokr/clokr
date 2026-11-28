/**
 * minor-working-time.ts — Issue #524 (D-05): the ONE § 8 JArbSchG working-time arithmetic.
 *
 * For a person under 18 on the work day, § 18 Abs. 2 ArbZG puts the JArbSchG in place of the ArbZG.
 * Zeiterfassung records and checks working-time law, so the day and week limits live here, once;
 * the roster check of Schichtplanung (`scheduling/minor-shift-limits.ts`, #1057) and the recording
 * check (`arbzg.ts`, #524) both call these functions, so planning and recording cannot drift.
 *
 * Legal reading (decision record: docs/compliance.md, "Lesart zu § 8 Abs. 2a"):
 *  - § 8 Abs. 1: at most 8:00 a day and 40:00 a week.
 *  - § 8 Abs. 2a: up to 8:30 a day when another Werktag (Monday to Saturday) of the same week is
 *    shortened to less than 8:00. A Werktag without work counts as shortened. The age of the person
 *    on that other day does not matter; the limit is a property of the week.
 *  - § 4 Abs. 4 S. 1: the week runs Monday to Sunday. § 4 Abs. 4 S. 2: the working time that falls
 *    out on a Werktag holiday counts towards the week as well.
 *  - § 8 Abs. 2 (Brückentage, five-week average) and Abs. 3 (agriculture) are not modelled.
 *
 * Pure leaf: this module has NO imports on purpose, so it can never join the measured import cycle.
 * Callers pass `week` as Monday..Sunday, 7 items; minutes are unrounded.
 */

/** § 8 Abs. 1 JArbSchG: 8 h a day. */
export const MINOR_DAILY_LIMIT_MINUTES = 480;
/** § 8 Abs. 2a JArbSchG: 8.5 h a day when another Werktag of the week is shortened. */
export const MINOR_DAILY_EXTENDED_LIMIT_MINUTES = 510;
/** § 8 Abs. 1 JArbSchG: 40 h a week. */
export const MINOR_WEEKLY_LIMIT_MINUTES = 2400;

/** One day of a minor's week, in minutes. */
export interface MinorWorkDay {
  /** True when the person is under 18 on this day (the 18th birthday itself is adult). */
  isMinor: boolean;
  /** Arbeitszeit (§ 4 Abs. 1) of the day: net of Ruhepause, plus the Berufsschule credit. */
  workMinutes: number;
  /** § 4 Abs. 4 S. 2: working time that falls out on a Werktag holiday; 0 when absent. */
  holidayMinutes?: number;
}

/** § 8 Abs. 2a: is another Werktag (Monday to Saturday) of the week below 8:00? */
export function hasShortenedOtherWerktag(week: readonly MinorWorkDay[], index: number): boolean {
  return week.some((d, i) => i !== index && i <= 5 && d.workMinutes < MINOR_DAILY_LIMIT_MINUTES);
}

/** The day limit of day `index`: 8:30 when another Werktag is shortened, else 8:00. */
export function minorDailyLimitMinutes(week: readonly MinorWorkDay[], index: number): number {
  return hasShortenedOtherWerktag(week, index)
    ? MINOR_DAILY_EXTENDED_LIMIT_MINUTES
    : MINOR_DAILY_LIMIT_MINUTES;
}

/** Does day `index` exceed its § 8 limit? Never for a day the person is an adult on. */
export function minorDailyLimitExceeded(week: readonly MinorWorkDay[], index: number): boolean {
  const day = week[index];
  if (!day.isMinor) return false;
  return day.workMinutes > minorDailyLimitMinutes(week, index);
}

/** The week sum of the minor days: worked minutes plus the holiday fallout (§ 4 Abs. 4 S. 2). */
export function minorWeekMinutes(week: readonly MinorWorkDay[]): number {
  return week.reduce(
    (sum, d) => sum + (d.isMinor ? d.workMinutes + (d.holidayMinutes ?? 0) : 0),
    0,
  );
}

/** The holiday fallout inside {@link minorWeekMinutes}, named in the weekly message. */
export function minorWeekHolidayMinutes(week: readonly MinorWorkDay[]): number {
  return week.reduce((sum, d) => sum + (d.isMinor ? (d.holidayMinutes ?? 0) : 0), 0);
}

/** Does the week sum exceed 40:00? */
export function minorWeeklyLimitExceeded(week: readonly MinorWorkDay[]): boolean {
  return minorWeekMinutes(week) > MINOR_WEEKLY_LIMIT_MINUTES;
}

/**
 * § 4 Abs. 4 S. 2: only what is not worked falls out, so a holiday adds the larger of its contract
 * Soll and its recorded work, never both. A Sunday holiday adds nothing (the statute speaks of a
 * Werktag).
 */
export function holidayFalloutMinutes(input: {
  isSunday: boolean;
  sollMinutes: number;
  workMinutes: number;
}): number {
  if (input.isSunday) return 0;
  return Math.max(0, input.sollMinutes - input.workMinutes);
}
