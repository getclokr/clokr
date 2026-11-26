/**
 * minor-shift-limits.ts
 *
 * The ONE JArbSchG roster rule for a shift of a person who is under 18 on the shift date:
 * Issue #1057 (§ 8 daily and weekly working time, § 12 Schichtzeit) and Issue #1076 (§ 13 Freizeit,
 * § 14 Nachtruhe, § 15 Fünf-Tage-Woche with § 16 Abs. 3 and 4, § 17 Sonntagsruhe). This module only READS; it never writes a row, an audit entry
 * or a saldo figure.
 *
 * Legal reading (the decision record is the #1057 / #1076 comments and docs/compliance.md):
 *  - Scope: JArbSchG applies instead of the ArbZG to a person under 18 (§ 18 Abs. 2 ArbZG). The age
 *    is decided per day by `isMinorAtDate` (the 18th birthday itself is adult); a missing birth date
 *    is not a minor.
 *  - Trade: Clokr stores no trade; every tenant is read as a Friseurbetrieb (hair salons are the
 *    product). Only § 16 (Saturday) depends on it; §§ 13, 14 and 17 have no Friseur exception.
 *  - Arbeitszeit (§ 4 Abs. 1) is net of the Ruhepause: the sum of `shiftNettoMinutes()` (the one
 *    break rule, `breakAmountFor`, #1060) over the day's shifts plus the day's Berufsschule credit
 *    (§ 9 Abs. 2) as the Arbeitszeitkonto already computes it (read only).
 *  - § 8 Abs. 1 / 2a: more than 8:00 a day is a violation unless another Werktag (Mon-Sat) of the
 *    same week has less than 8:00; then up to 8:30 is allowed. A Werktag without work counts as
 *    shortened (the statute says "shortened to less than eight hours"). § 8 Abs. 2 proper (Brückentage,
 *    five-week average) is not modelled.
 *  - Week (§ 4 Abs. 4 S. 1): Monday to Sunday, minor days only, limit 40:00. § 4 Abs. 4 S. 2 (Issue
 *    #1077, owner decision 26.11.2026): the working time that falls out on a holiday at the work
 *    location on a Werktag counts as well. It is the day's contract Soll as the Arbeitszeitkonto
 *    prices it (`MinorShiftWeek.holidaySollMinutesByDate`), not the planned shift and not an
 *    average, so a holiday the planner leaves empty cannot lower the week. Only the weekly sum
 *    reads it; the daily limit, § 8 Abs. 2a, §§ 12-17 are unchanged.
 *  - § 12: Schichtzeit = earliest start to latest end of the day's shifts (every interruption of at
 *    least 15 min is a Ruhepause, so gaps are inside it), at most 10:00.
 *  - § 13: at least 12:00 uninterrupted Freizeit between the latest end of a day and the earliest
 *    start of the next calendar day (a midnight-crossing end counts past 24:00), in both directions
 *    and across the week boundary (the loader reads Monday-1 .. Sunday+1). It applies when the person
 *    is a minor on the LATER day; on the 18th birthday § 5 ArbZG answers instead (11 h, forceable).
 *  - § 14 Abs. 1: only 06:00-20:00. Every minute outside it (the part of a midnight-crossing shift
 *    included) is a violation. The extensions of Abs. 2 (other trades, multi-shift operations),
 *    Abs. 3, 5, 6 and 7 are not applied: a salon has none of those cases or Clokr cannot know it.
 *  - § 15 Satz 1 (with § 16 Abs. 3 and 4): at most five days a week (Monday to Sunday) with a shift
 *    or a Berufsschule. A Berufsschultag counts because § 16 Abs. 3 Satz 1 demands a
 *    "berufsschulfrei" compensation day. In a salon a sixth day is a Saturday (Sunday is forbidden);
 *    the Friseurhandwerk may work it (§ 16 Abs. 2 Satz 1 Nr. 2) when another Monday-Friday day without
 *    Berufsschule ends by 13:00 and carries at most 8:00 minus the Saturday's Arbeitszeit (§ 16 Abs. 4).
 *  - § 17 Abs. 1: no shift on a Sunday (decided from the ISO date). Abs. 2 lists no salon case.
 *  - NOT refused on purpose: § 16 Abs. 2 Satz 2 (at least two Saturdays a month SHOULD stay free: a
 *    Sollvorschrift, not bußgeldbewehrt in § 58, tariff-dispositive in § 21a Abs. 1 Nr. 4) and
 *    § 15 Satz 2 (the two rest days should follow each other where possible).
 *  - A write is refused only when it CREATES a violation or ENLARGES one (day figure, span, week
 *    sum, night minutes, Sunday minutes grow or a Freizeit gap shrinks), so an already illegal plan
 *    (legacy, Phorest import) never freezes the roster.
 *
 * The day/week arithmetic lives in `evaluateMinorWeekFigures` over per-day minute figures, not over
 * Shift rows, so the recording side (#524) can reuse it without a rewrite.
 *
 * A plan nobody can refuse (Phorest import, Issue #1074) is reported with
 * `findStoredMinorWeekViolations`, which lists every violation of the stored week with the same
 * predicates and messages; the module still only reads.
 */
import type { PrismaClient } from "@clokr/db";
import { hasVocationalSchoolDay, isMinorAtDate, mondayOfWeekUtc } from "../absence";
import { holidaysAtWorkLocation, type EmployeeScope } from "../platform";
import {
  calcExpectedMinutesTz,
  dateStrInTz,
  dayRangeUtc,
  getTenantTimezone,
  getVocationalSchoolMinutesForDate,
} from "../working-time-account";
import { getWorkedEntriesInRange, type BreakTenantConfigShape } from "../time-tracking";
import { shiftNettoMinutes, type ShiftBreakEmployee } from "./shift-netto";

/** § 8 Abs. 1 JArbSchG: 8 h a day. */
export const MINOR_DAILY_LIMIT_MINUTES = 480;
/** § 8 Abs. 2a JArbSchG: 8.5 h a day when another Werktag of the week is shortened. */
export const MINOR_DAILY_EXTENDED_LIMIT_MINUTES = 510;
/** § 8 Abs. 1 JArbSchG: 40 h a week. */
export const MINOR_WEEKLY_LIMIT_MINUTES = 2400;
/** § 12 JArbSchG: Schichtzeit of at most 10 h. */
export const MINOR_SHIFT_TIME_LIMIT_MINUTES = 600;
/** § 14 Abs. 1 JArbSchG: work only from 06:00 ... */
export const MINOR_NIGHT_REST_UNTIL_MINUTE = 360;
/** ... until 20:00. */
export const MINOR_NIGHT_REST_FROM_MINUTE = 1200;
/** § 13 JArbSchG: at least 12 h uninterrupted Freizeit after the daily working time. */
export const MINOR_FREE_TIME_MINUTES = 720;

/** § 15 Satz 1 JArbSchG: at most five days a week. */
export const MINOR_WORK_DAYS_PER_WEEK = 5;
/** § 16 Abs. 4 JArbSchG: the compensation day ends by 13:00 ... */
export const MINOR_SATURDAY_COMPENSATION_UNTIL_MINUTE = 780;

const DAY_MINUTES = 24 * 60;

export type MinorShiftLimitCode =
  | "JARBSCHG_VIOLATION_DAILY_MAX"
  | "JARBSCHG_VIOLATION_WEEKLY_MAX"
  | "JARBSCHG_VIOLATION_SHIFT_TIME"
  | "JARBSCHG_VIOLATION_NIGHT_REST"
  | "JARBSCHG_VIOLATION_SUNDAY_REST"
  | "JARBSCHG_VIOLATION_FREE_TIME"
  | "JARBSCHG_VIOLATION_FIVE_DAY_WEEK";

export interface MinorShiftLimitViolation {
  code: MinorShiftLimitCode;
  dateIso: string;
  message: string;
}

/** A shift as the check reads it: `date` is the stored `Shift.date` (UTC midnight of the work day). */
export interface ShiftDraft {
  date: Date;
  startTime: string;
  endTime: string;
}

export interface MinorShiftWeek {
  employeeId: string;
  /** Monday .. Sunday as ISO dates. */
  weekDays: string[];
  birthDate: Date;
  breakEmployee: ShiftBreakEmployee;
  breakTenantConfig: BreakTenantConfigShape;
  /** Berufsschule credit (minutes) per ISO day, read from the Arbeitszeitkonto. */
  creditedMinutesByDate: Record<string, number>;
  /** ISO days of `weekDays` on which the person is a minor and has a Berufsschule (§ 15, § 16 Abs. 3). */
  schoolDays: string[];
  /**
   * § 4 Abs. 4 Satz 2 JArbSchG (Issue #1077): per ISO day of `weekDays` on which the person is a
   * minor and employed and the work location has a holiday, that day's contract Soll as the
   * Arbeitszeitkonto prices it. A missing day means no holiday Soll. Always set by
   * `loadMinorShiftWeeks`; optional only so the holiday-free week literals of the #1057 / #1074 /
   * #1075 / #1076 tests stay valid.
   */
  holidaySollMinutesByDate?: Record<string, number>;
  /** The shifts of the week AND of the Sunday before / the Monday after (see `minorWeekHorizon`). */
  shifts: Array<ShiftDraft & { id: string }>;
}

/** The per-day minute figures the week arithmetic works on. */
export interface MinorDayFigures {
  isMinor: boolean;
  /** Net Arbeitszeit of the day including the Berufsschule credit. */
  workMinutes: number;
  /** Earliest start to latest end of the day's shifts; 0 without a shift. */
  spanMinutes: number;
  /** Earliest start in minutes after the day's 00:00; null without a shift. */
  firstStartMinute: number | null;
  /** Latest end in minutes after the day's 00:00 (above 1440 for a midnight-crossing shift). */
  lastEndMinute: number | null;
  /** Shift minutes outside 06:00-20:00 (§ 14 Abs. 1). */
  nightMinutes: number;
  /** Sum of the gross shift minutes of the day. */
  shiftMinutes: number;
  /** The day is a Berufsschultag (an `Absence` of type VOCATIONAL_SCHOOL). */
  isSchoolDay: boolean;
  /**
   * The holiday time that falls out on this day (§ 4 Abs. 4 Satz 2): the contract Soll beyond what
   * is planned. Read by the weekly sum only (Issue #1077).
   */
  holidayMinutes: number;
}

/** The figures of a week and of the two edge days that border it (the horizon). */
export interface MinorWeekFigures {
  previousDay: MinorDayFigures;
  /** Monday .. Sunday. */
  days: MinorDayFigures[];
  nextDay: MinorDayFigures;
}

// ── formatting ───────────────────────────────────────────────────────────────────────────────────

function formatDateDe(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function formatShortDateDe(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

function formatHm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Clock time HH:MM of a minute count after midnight (modulo one day). */
function formatClock(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function utcMidnightOf(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, n: number): string {
  const d = utcMidnightOf(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

function isSundayIso(iso: string): boolean {
  return utcMidnightOf(iso).getUTCDay() === 0;
}

/**
 * The ONE definition of the horizon of a minor week: the Sunday before, Monday .. Sunday, the Monday
 * after. § 13 compares neighbouring days, so the edge days are part of what the check reads.
 */
export function minorWeekHorizon(week: Pick<MinorShiftWeek, "weekDays">): string[] {
  return [addDaysIso(week.weekDays[0], -1), ...week.weekDays, addDaysIso(week.weekDays[6], 1)];
}

// ── pure arithmetic over per-day figures ─────────────────────────────────────────────────────────

// § 8 Abs. 2a: is another Werktag (Mon-Sat) of the list shorter than 8:00?
function hasShortenedOtherWerktag(figures: MinorDayFigures[], index: number): boolean {
  return figures.some((f, i) => i !== index && i <= 5 && f.workMinutes < MINOR_DAILY_LIMIT_MINUTES);
}

function dailyBad(figures: MinorDayFigures[], index: number): boolean {
  const f = figures[index];
  if (!f.isMinor) return false;
  if (f.workMinutes > MINOR_DAILY_EXTENDED_LIMIT_MINUTES) return true;
  return f.workMinutes > MINOR_DAILY_LIMIT_MINUTES && !hasShortenedOtherWerktag(figures, index);
}

function spanBad(figures: MinorDayFigures[], index: number): boolean {
  return figures[index].isMinor && figures[index].spanMinutes > MINOR_SHIFT_TIME_LIMIT_MINUTES;
}

// The holiday time inside `weekSum` (Issue #1077), named in the weekly message.
function weekHolidayMinutes(figures: MinorDayFigures[]): number {
  return figures.reduce((sum, f) => sum + (f.isMinor ? f.holidayMinutes : 0), 0);
}

function weekSum(figures: MinorDayFigures[]): number {
  return figures.reduce((sum, f) => sum + (f.isMinor ? f.workMinutes + f.holidayMinutes : 0), 0);
}

// § 14 Abs. 1: any shift minute outside 06:00-20:00.
function nightBad(f: MinorDayFigures): boolean {
  return f.isMinor && f.nightMinutes > 0;
}

// § 17 Abs. 1: any shift on a Sunday.
function sundayBad(f: MinorDayFigures, iso: string): boolean {
  return f.isMinor && isSundayIso(iso) && f.shiftMinutes > 0;
}

// § 15: a day counts when the person is a minor on it and it carries a shift or a Berufsschule.
function countedDay(f: MinorDayFigures): boolean {
  return f.isMinor && (f.shiftMinutes > 0 || f.isSchoolDay);
}

function countedDays(figures: MinorDayFigures[]): number {
  return figures.filter(countedDay).length;
}

const utcWeekdayOf = (iso: string): number => utcMidnightOf(iso).getUTCDay();

// § 16 Abs. 4: six counted days with a Saturday shift, no Sunday, and one Monday-Friday minor day
// without Berufsschule that ends by 13:00 and carries at most 8:00 minus the Saturday's Arbeitszeit.
function saturdayCompensationHolds(figures: MinorDayFigures[], weekDays: string[]): boolean {
  if (countedDays(figures) !== MINOR_WORK_DAYS_PER_WEEK + 1) return false;
  const saturday = weekDays.findIndex((iso) => utcWeekdayOf(iso) === 6);
  const sunday = weekDays.findIndex((iso) => utcWeekdayOf(iso) === 0);
  if (saturday < 0 || !figures[saturday].isMinor || figures[saturday].shiftMinutes <= 0) {
    return false;
  }
  if (sunday >= 0 && countedDay(figures[sunday])) return false;
  const allowance = Math.max(0, MINOR_DAILY_LIMIT_MINUTES - figures[saturday].workMinutes);
  return figures.some((f, i) => {
    const weekday = utcWeekdayOf(weekDays[i]);
    return (
      weekday >= 1 &&
      weekday <= 5 &&
      f.isMinor &&
      !f.isSchoolDay &&
      f.shiftMinutes > 0 &&
      (f.lastEndMinute ?? Number.POSITIVE_INFINITY) <= MINOR_SATURDAY_COMPENSATION_UNTIL_MINUTE &&
      f.workMinutes <= allowance
    );
  });
}

function fiveDayBad(figures: MinorDayFigures[], weekDays: string[]): boolean {
  return (
    countedDays(figures) > MINOR_WORK_DAYS_PER_WEEK && !saturdayCompensationHolds(figures, weekDays)
  );
}

/** Minutes of Freizeit between the end of `previous` and the start of `next`; null without both. */
function freeTimeGap(previous: MinorDayFigures, next: MinorDayFigures): number | null {
  if (previous.lastEndMinute === null || next.firstStartMinute === null) return null;
  return DAY_MINUTES + next.firstStartMinute - previous.lastEndMinute;
}

// § 13: the prohibition addresses the employment that would begin too early, so the LATER day
// decides whether the person is a minor.
function freeTimeBad(previous: MinorDayFigures, next: MinorDayFigures): boolean {
  const gap = freeTimeGap(previous, next);
  return next.isMinor && gap !== null && gap < MINOR_FREE_TIME_MINUTES;
}

function dailyMessage(dateIso: string, workMinutes: number): string {
  return `Die geplante Arbeitszeit am ${formatDateDe(dateIso)} beträgt ${formatHm(workMinutes)} Stunden. Für Jugendliche sind höchstens 8 Stunden am Tag erlaubt, bis zu 8,5 Stunden nur, wenn an einem anderen Werktag derselben Woche weniger als 8 Stunden gearbeitet wird (§ 8 Abs. 1 und 2a JArbSchG).`;
}

function shiftTimeMessage(dateIso: string, spanMinutes: number): string {
  return `Die Schichtzeit am ${formatDateDe(dateIso)} beträgt ${formatHm(spanMinutes)} Stunden (Beginn bis Ende einschließlich Pausen). Für Jugendliche sind höchstens 10 Stunden erlaubt (§ 12 JArbSchG).`;
}

function nightRestMessage(dateIso: string, f: MinorDayFigures): string {
  return `Die geplante Arbeitszeit am ${formatDateDe(dateIso)} reicht von ${formatClock(f.firstStartMinute ?? 0)} bis ${formatClock(f.lastEndMinute ?? 0)} Uhr. Jugendliche dürfen nur in der Zeit von 6 bis 20 Uhr beschäftigt werden (§ 14 Abs. 1 JArbSchG).`;
}

function sundayRestMessage(dateIso: string): string {
  return `Am Sonntag, ${formatDateDe(dateIso)}, ist eine Schicht geplant. Jugendliche dürfen an Sonntagen nicht beschäftigt werden (§ 17 Abs. 1 JArbSchG).`;
}

function freeTimeMessage(dateIso: string, gapMinutes: number): string {
  return `Zwischen dem Schichtende am ${formatDateDe(addDaysIso(dateIso, -1))} und dem Schichtbeginn am ${formatDateDe(dateIso)} liegen ${formatHm(Math.max(0, gapMinutes))} Stunden. Jugendliche brauchen nach dem Ende der täglichen Arbeitszeit mindestens 12 Stunden ununterbrochene Freizeit (§ 13 JArbSchG).`;
}

/**
 * With a trigger day the text names the shift that tipped the week; without, it names the week.
 * The sum includes the holiday time (§ 4 Abs. 4 Satz 2, Issue #1077); a week with some names it in
 * one extra sentence, a week without one keeps the text byte-identical (open Phorest notifications
 * are not re-sent).
 */
function weeklyMessage(
  weekDays: string[],
  sumMinutes: number,
  triggerIso: string | null,
  holidayMinutes: number,
): string {
  const holiday =
    holidayMinutes > 0
      ? ` Darin sind ${formatHm(holidayMinutes)} Stunden eingerechnet, die an einem Feiertag ausfallen (§ 4 Abs. 4 Satz 2 JArbSchG).`
      : "";
  const limit =
    "Für Jugendliche sind höchstens 40 Stunden in der Woche erlaubt, Berufsschulzeit eingerechnet (§ 8 Abs. 1 und § 9 Abs. 2 JArbSchG)." +
    holiday;
  const range = `${formatShortDateDe(weekDays[0])} bis ${formatDateDe(weekDays[6])}`;
  if (triggerIso === null) {
    return `In der Woche vom ${range} beträgt die geplante Arbeitszeit ${formatHm(sumMinutes)} Stunden. ${limit}`;
  }
  return `Mit der Schicht am ${formatDateDe(triggerIso)} beträgt die geplante Arbeitszeit in der Woche vom ${range} ${formatHm(sumMinutes)} Stunden. ${limit}`;
}

/** With a trigger day the text names the shift that tipped the week; without, it names the week. */
function fiveDayMessage(weekDays: string[], days: number, triggerIso: string | null): string {
  const range = `${formatShortDateDe(weekDays[0])} bis ${formatDateDe(weekDays[6])}`;
  const rule =
    "Jugendliche dürfen nur an fünf Tagen in der Woche beschäftigt werden. Wer samstags arbeitet, braucht in derselben Woche einen anderen freien Tag ohne Berufsschule; an diesem Tag ist höchstens ein Ausgleich bis 13 Uhr erlaubt (§ 15, § 16 Abs. 3 und 4 JArbSchG).";
  if (triggerIso === null) {
    return `In der Woche vom ${range} sind an ${days} Tagen Schicht oder Berufsschule geplant. ${rule}`;
  }
  return `Mit der Schicht am ${formatDateDe(triggerIso)} sind in der Woche vom ${range} an ${days} Tagen Schicht oder Berufsschule geplant. ${rule}`;
}

/** The figure list over the whole horizon: index 0 = Sunday before, 1..7 = Monday..Sunday, 8 = Monday after. */
function horizonList(f: MinorWeekFigures): MinorDayFigures[] {
  return [f.previousDay, ...f.days, f.nextDay];
}

/**
 * Compares the week before and after a change. `before` and `after` hold the seven figures of
 * Monday to Sunday plus the two edge days. Per day the trigger day is checked first, the rest in
 * calendar order (DAILY_MAX, SHIFT_TIME, NIGHT_REST, SUNDAY_REST, FREE_TIME of the pair ending that
 * day); then the pair Sunday -> next Monday; the weekly sum last (Arbeitszeit plus the holiday time
 * that falls out, § 4 Abs. 4 Satz 2, Issue #1077).
 */
export function evaluateMinorWeekFigures(input: {
  weekDays: string[];
  triggerIso: string;
  before: MinorWeekFigures;
  after: MinorWeekFigures;
}): MinorShiftLimitViolation | null {
  const { weekDays, triggerIso } = input;
  const before = input.before.days;
  const after = input.after.days;
  const beforeAll = horizonList(input.before);
  const afterAll = horizonList(input.after);

  const triggerIndex = weekDays.indexOf(triggerIso);
  const order = [
    ...(triggerIndex >= 0 ? [triggerIndex] : []),
    ...weekDays.map((_, i) => i).filter((i) => i !== triggerIndex),
  ];

  // The pair ending on horizon index `h` (h = 1 is Monday ... h = 8 is the Monday after): refused
  // when it is short now and was not short before, or the gap shrank.
  const freeTimeFinding = (h: number, dateIso: string): MinorShiftLimitViolation | null => {
    if (!freeTimeBad(afterAll[h - 1], afterAll[h])) return null;
    const gapAfter = freeTimeGap(afterAll[h - 1], afterAll[h]) as number;
    if (freeTimeBad(beforeAll[h - 1], beforeAll[h])) {
      const gapBefore = freeTimeGap(beforeAll[h - 1], beforeAll[h]) as number;
      if (gapAfter >= gapBefore) return null;
    }
    return {
      code: "JARBSCHG_VIOLATION_FREE_TIME",
      dateIso,
      message: freeTimeMessage(dateIso, gapAfter),
    };
  };

  for (const i of order) {
    const dateIso = weekDays[i];
    if (
      dailyBad(after, i) &&
      (!dailyBad(before, i) || after[i].workMinutes > before[i].workMinutes)
    ) {
      return {
        code: "JARBSCHG_VIOLATION_DAILY_MAX",
        dateIso,
        message: dailyMessage(dateIso, after[i].workMinutes),
      };
    }
    if (
      spanBad(after, i) &&
      (!spanBad(before, i) || after[i].spanMinutes > before[i].spanMinutes)
    ) {
      return {
        code: "JARBSCHG_VIOLATION_SHIFT_TIME",
        dateIso,
        message: shiftTimeMessage(dateIso, after[i].spanMinutes),
      };
    }
    if (nightBad(after[i]) && after[i].nightMinutes > before[i].nightMinutes) {
      return {
        code: "JARBSCHG_VIOLATION_NIGHT_REST",
        dateIso,
        message: nightRestMessage(dateIso, after[i]),
      };
    }
    if (sundayBad(after[i], dateIso) && after[i].shiftMinutes > before[i].shiftMinutes) {
      return {
        code: "JARBSCHG_VIOLATION_SUNDAY_REST",
        dateIso,
        message: sundayRestMessage(dateIso),
      };
    }
    const freeTime = freeTimeFinding(i + 1, dateIso);
    if (freeTime) return freeTime;
  }

  const freeTimeNextMonday = freeTimeFinding(8, addDaysIso(weekDays[6], 1));
  if (freeTimeNextMonday) return freeTimeNextMonday;

  const afterSum = weekSum(after);
  if (afterSum > MINOR_WEEKLY_LIMIT_MINUTES && afterSum > weekSum(before)) {
    const weeklyDateIso = triggerIndex >= 0 ? weekDays[triggerIndex] : weekDays[0];
    return {
      code: "JARBSCHG_VIOLATION_WEEKLY_MAX",
      dateIso: weeklyDateIso,
      message: weeklyMessage(weekDays, afterSum, weeklyDateIso, weekHolidayMinutes(after)),
    };
  }

  const afterCount = countedDays(after);
  if (
    fiveDayBad(after, weekDays) &&
    (!fiveDayBad(before, weekDays) || afterCount > countedDays(before))
  ) {
    const fiveDateIso = triggerIndex >= 0 ? weekDays[triggerIndex] : weekDays[0];
    return {
      code: "JARBSCHG_VIOLATION_FIVE_DAY_WEEK",
      dateIso: fiveDateIso,
      message: fiveDayMessage(weekDays, afterCount, fiveDateIso),
    };
  }
  return null;
}

/**
 * Every violation the given figures hold (Issue #1074) — the stored week of a plan nobody can
 * refuse. Same predicates and message builders as `evaluateMinorWeekFigures`: per day in calendar
 * order DAILY_MAX, SHIFT_TIME, NIGHT_REST, SUNDAY_REST, FREE_TIME (several may occur on one day),
 * then WEEKLY_MAX and FIVE_DAY_WEEK (dated Monday). The pair Sunday -> next Monday belongs to the next week and is
 * never listed here, so nothing is reported twice.
 */
export function listMinorWeekViolations(input: {
  weekDays: string[];
  figures: MinorWeekFigures;
}): MinorShiftLimitViolation[] {
  const { weekDays } = input;
  const figures = input.figures.days;
  const all = horizonList(input.figures);
  const out: MinorShiftLimitViolation[] = [];
  for (let i = 0; i < weekDays.length; i++) {
    const dateIso = weekDays[i];
    if (dailyBad(figures, i)) {
      out.push({
        code: "JARBSCHG_VIOLATION_DAILY_MAX",
        dateIso,
        message: dailyMessage(dateIso, figures[i].workMinutes),
      });
    }
    if (spanBad(figures, i)) {
      out.push({
        code: "JARBSCHG_VIOLATION_SHIFT_TIME",
        dateIso,
        message: shiftTimeMessage(dateIso, figures[i].spanMinutes),
      });
    }
    if (nightBad(figures[i])) {
      out.push({
        code: "JARBSCHG_VIOLATION_NIGHT_REST",
        dateIso,
        message: nightRestMessage(dateIso, figures[i]),
      });
    }
    if (sundayBad(figures[i], dateIso)) {
      out.push({
        code: "JARBSCHG_VIOLATION_SUNDAY_REST",
        dateIso,
        message: sundayRestMessage(dateIso),
      });
    }
    if (freeTimeBad(all[i], all[i + 1])) {
      out.push({
        code: "JARBSCHG_VIOLATION_FREE_TIME",
        dateIso,
        message: freeTimeMessage(dateIso, freeTimeGap(all[i], all[i + 1]) as number),
      });
    }
  }
  const sum = weekSum(figures);
  if (sum > MINOR_WEEKLY_LIMIT_MINUTES) {
    out.push({
      code: "JARBSCHG_VIOLATION_WEEKLY_MAX",
      dateIso: weekDays[0],
      message: weeklyMessage(weekDays, sum, null, weekHolidayMinutes(figures)),
    });
  }
  if (fiveDayBad(figures, weekDays)) {
    out.push({
      code: "JARBSCHG_VIOLATION_FIVE_DAY_WEEK",
      dateIso: weekDays[0],
      message: fiveDayMessage(weekDays, countedDays(figures), null),
    });
  }
  return out;
}

/** Short German label of a finding for a list of further violations ("DD.MM.YYYY (Arbeitszeit)"). */
export function minorShiftLimitLabel(v: MinorShiftLimitViolation): string {
  switch (v.code) {
    case "JARBSCHG_VIOLATION_DAILY_MAX":
      return `${formatDateDe(v.dateIso)} (Arbeitszeit)`;
    case "JARBSCHG_VIOLATION_SHIFT_TIME":
      return `${formatDateDe(v.dateIso)} (Schichtzeit)`;
    case "JARBSCHG_VIOLATION_NIGHT_REST":
      return `${formatDateDe(v.dateIso)} (Nachtruhe)`;
    case "JARBSCHG_VIOLATION_SUNDAY_REST":
      return `${formatDateDe(v.dateIso)} (Sonntagsruhe)`;
    case "JARBSCHG_VIOLATION_FREE_TIME":
      return `${formatDateDe(v.dateIso)} (Freizeit)`;
    case "JARBSCHG_VIOLATION_WEEKLY_MAX":
      return "Wochenarbeitszeit";
    case "JARBSCHG_VIOLATION_FIVE_DAY_WEEK":
      return "Fünf-Tage-Woche";
    default: {
      const unreachable: never = v.code;
      return unreachable;
    }
  }
}

// ── rows -> figures ──────────────────────────────────────────────────────────────────────────────

function overlapMinutes(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

function dayFigures(
  week: MinorShiftWeek,
  iso: string,
  shifts: Array<ShiftDraft & { id?: string }>,
): MinorDayFigures {
  const day = shifts.filter((s) => isoOf(s.date) === iso);
  let work = week.creditedMinutesByDate[iso] ?? 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let night = 0;
  let shiftMinutes = 0;
  for (const s of day) {
    work += shiftNettoMinutes(s, week.breakEmployee, week.breakTenantConfig);
    let gross = hmToMin(s.endTime) - hmToMin(s.startTime);
    if (gross < 0) gross += DAY_MINUTES; // midnight-crossing, the shift-netto convention
    if (gross <= 0) continue;
    const start = hmToMin(s.startTime);
    const end = start + gross;
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
    shiftMinutes += gross;
    // The allowed window is 06:00-20:00 of the start day and of the following day (a shift that
    // crosses midnight can reach 06:00 of the next morning).
    const inside =
      overlapMinutes(start, end, MINOR_NIGHT_REST_UNTIL_MINUTE, MINOR_NIGHT_REST_FROM_MINUTE) +
      overlapMinutes(
        start,
        end,
        DAY_MINUTES + MINOR_NIGHT_REST_UNTIL_MINUTE,
        DAY_MINUTES + MINOR_NIGHT_REST_FROM_MINUTE,
      );
    night += gross - inside;
  }
  const hasShift = latest > Number.NEGATIVE_INFINITY;
  // § 4 Abs. 4 Satz 2: only what is not worked falls out, so the day counts the larger of its
  // contract Soll and its planned Arbeitszeit, never both (Issue #1077).
  // § 4 Abs. 4 Satz 2 speaks of a Werktag, so a Sunday holiday adds nothing (GA-3).
  const holidayMinutes = isSundayIso(iso)
    ? 0
    : Math.max(0, (week.holidaySollMinutesByDate?.[iso] ?? 0) - work);
  return {
    isMinor: isMinorAtDate(week.birthDate, utcMidnightOf(iso)),
    workMinutes: work,
    spanMinutes: latest > earliest ? latest - earliest : 0,
    firstStartMinute: hasShift ? earliest : null,
    lastEndMinute: hasShift ? latest : null,
    nightMinutes: night,
    shiftMinutes,
    isSchoolDay: week.schoolDays.includes(iso),
    holidayMinutes,
  };
}

function figuresFor(
  week: MinorShiftWeek,
  shifts: Array<ShiftDraft & { id?: string }>,
): MinorWeekFigures {
  const horizon = minorWeekHorizon(week);
  const all = horizon.map((iso) => dayFigures(week, iso, shifts));
  return { previousDay: all[0], days: all.slice(1, 8), nextDay: all[8] };
}

/**
 * Checks one change of a minor's week. `before` is the stored week, `after` is the week without
 * `removeShiftId` and with the `add` drafts. Returns the first violation the change creates or
 * enlarges, else null. The first draft's date is the trigger day.
 */
export function findMinorShiftLimitViolation(
  week: MinorShiftWeek,
  change: { removeShiftId?: string; add: ShiftDraft[] },
): MinorShiftLimitViolation | null {
  if (change.add.length === 0) return null;
  const horizon = minorWeekHorizon(week);
  const inHorizon = (d: ShiftDraft) => horizon.includes(isoOf(d.date));
  const beforeShifts = week.shifts.filter(inHorizon);
  const afterShifts = [
    ...beforeShifts.filter((s) => s.id !== change.removeShiftId),
    ...change.add.filter(inHorizon),
  ];
  return evaluateMinorWeekFigures({
    weekDays: week.weekDays,
    triggerIso: isoOf(change.add[0].date),
    before: figuresFor(week, beforeShifts),
    after: figuresFor(week, afterShifts),
  });
}

/**
 * The stored week as it is (Issue #1074): every violation of `week.shifts` on `week.weekDays`, for a
 * plan that cannot be refused (Phorest import). Same rule as `findMinorShiftLimitViolation`.
 */
export function findStoredMinorWeekViolations(week: MinorShiftWeek): MinorShiftLimitViolation[] {
  const horizon = minorWeekHorizon(week);
  const stored = week.shifts.filter((s) => horizon.includes(isoOf(s.date)));
  return listMinorWeekViolations({
    weekDays: week.weekDays,
    figures: figuresFor(week, stored),
  });
}

/** The 422 body of a refused write — like § 3: not overridable, no birth date. */
export function minorShiftLimitReplyBody(v: MinorShiftLimitViolation): {
  error: "JArbSchG-Verstoß";
  code: MinorShiftLimitCode;
  message: string;
  canForce: false;
} {
  return { error: "JArbSchG-Verstoß", code: v.code, message: v.message, canForce: false };
}

// ── loader ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The week context of every person in `employeeIds` who is a minor on at least one day of the week
 * containing `anyDayOfWeek`. Adults and persons without a birth date are not in the map; they cost
 * exactly one employee read. For the minors it also reads the work-location holidays of the week
 * (the Unterbau, fed with the Zeiterfassung's closed work entries, like the roster week view) and
 * prices each one with the Arbeitszeitkonto's day Soll (Issue #1077).
 */
export async function loadMinorShiftWeeks(
  prisma: PrismaClient,
  tenantId: string,
  employeeIds: string[],
  anyDayOfWeek: Date,
): Promise<Map<string, MinorShiftWeek>> {
  const result = new Map<string, MinorShiftWeek>();
  if (employeeIds.length === 0) return result;

  const monday = mondayOfWeekUtc(anyDayOfWeek);
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    weekDays.push(isoOf(d));
  }
  // The horizon (Sunday before .. Monday after) feeds § 13, which compares neighbouring days.
  const horizonFrom = utcMidnightOf(addDaysIso(weekDays[0], -1));
  const horizonTo = utcMidnightOf(addDaysIso(weekDays[6], 1));

  const employees = await prisma.employee.findMany({
    where: { id: { in: Array.from(new Set(employeeIds)) }, tenantId },
    select: {
      id: true,
      birthDate: true,
      hireDate: true,
      exitDate: true,
      breakOver6hOverride: true,
      breakOver9hOverride: true,
    },
  });
  const minors = employees.filter(
    (e) => e.birthDate && weekDays.some((iso) => isMinorAtDate(e.birthDate, utcMidnightOf(iso))),
  );
  if (minors.length === 0) return result;

  const tenantConfig = await prisma.tenantConfig.findUnique({
    where: { tenantId },
    select: {
      defaultBreakOver6h: true,
      defaultBreakOver9h: true,
      defaultWorkDays: true,
      vocationalSchoolMinutesPerDay: true,
      vocationalSchoolBlockMinutesPerWeek: true,
      bsSlotFirstLongDayMinutes: true,
      bsSlotSecondLongDayMinutes: true,
      bsSlotShortDayMinutes: true,
      bsSlotBlockWeekMinutes: true,
    },
  });
  const breakTenantConfig: BreakTenantConfigShape = {
    defaultBreakOver6h: tenantConfig?.defaultBreakOver6h ?? 30,
    defaultBreakOver9h: tenantConfig?.defaultBreakOver9h ?? 45,
  };
  const tz = await getTenantTimezone(prisma, tenantId);

  // § 4 Abs. 4 Satz 2 (Issue #1077, D-02): the holidays of the week at each person's work location,
  // ONE batched read for all minors, resolved only by the Unterbau — the same pair of calls the
  // roster week view uses. The scope carries the tenant, and the minors come from the tenant-scoped
  // employee query above.
  const minorIds = minors.map((e) => e.id);
  const holidayScope: EmployeeScope = { kind: "employees", employeeIds: minorIds, tenantId };
  const weekEntries = await getWorkedEntriesInRange(
    prisma,
    holidayScope,
    utcMidnightOf(weekDays[0]),
    utcMidnightOf(weekDays[6]),
  );
  const holidaysByEmployee = await holidaysAtWorkLocation(
    prisma,
    tenantId,
    minorIds,
    weekDays[0],
    weekDays[6],
    weekEntries,
  );

  for (const emp of minors) {
    const holidays = holidaysByEmployee.get(emp.id);
    // The employment window in tenant-local days (like the Arbeitszeitkonto's exit clip, Issue #447).
    const hireDay = dateStrInTz(emp.hireDate, tz);
    const exitDay = emp.exitDate ? dateStrInTz(emp.exitDate, tz) : null;
    const shifts = await prisma.shift.findMany({
      where: {
        employeeId: emp.id,
        employee: { tenantId },
        date: { gte: horizonFrom, lte: horizonTo },
        deletedAt: null,
      },
      select: { id: true, date: true, startTime: true, endTime: true },
    });
    const schedules = await prisma.workSchedule.findMany({
      where: {
        employeeId: emp.id,
        employee: { tenantId },
        validFrom: { lte: dayRangeUtc(weekDays[6], tz).end },
      },
      orderBy: { validFrom: "desc" },
    });

    const creditedMinutesByDate: Record<string, number> = {};
    const holidaySollMinutesByDate: Record<string, number> = {};
    const schoolDays: string[] = [];
    for (const iso of weekDays) {
      if (!isMinorAtDate(emp.birthDate, utcMidnightOf(iso))) continue;
      // The Berufsschule credit can resolve to configured slot minutes, so "credit > 0" is not the
      // school-day flag; the Abwesenheiten index answers it.
      if (await hasVocationalSchoolDay(prisma, emp.id, tenantId, utcMidnightOf(iso))) {
        schoolDays.push(iso);
      }
      const dayEnd = dayRangeUtc(iso, tz).end;
      const schedule = schedules.find((s) => s.validFrom <= dayEnd) ?? null;
      // D-01: the time that falls out on a holiday is the day's Soll per contract, priced by the
      // Arbeitszeitkonto's own day Soll over this ONE day under the contract valid on it (D-03):
      // FIXED_SCHEDULE = the weekday's hours (like the month close's holiday reduction),
      // MONTHLY_HOURS = its Ø-day, SHIFT_BASED / FLEXTIME = weeklyHours over the contract days on a
      // contract weekday (like the roster's Planungs-Soll); a non-contract day prices 0.
      if (
        holidays?.has(iso) &&
        schedule &&
        hireDay <= iso &&
        (exitDay === null || iso <= exitDay)
      ) {
        const { start, end } = dayRangeUtc(iso, tz);
        const soll = calcExpectedMinutesTz(
          schedule,
          start,
          end,
          tz,
          undefined,
          tenantConfig?.defaultWorkDays,
        );
        if (soll > 0) holidaySollMinutesByDate[iso] = soll;
      }
      creditedMinutesByDate[iso] = await getVocationalSchoolMinutesForDate(
        prisma,
        emp.id,
        utcMidnightOf(iso),
        tenantConfig,
        { schedule, scheduleType: schedule?.type ?? null },
      );
    }

    result.set(emp.id, {
      employeeId: emp.id,
      weekDays,
      birthDate: emp.birthDate as Date,
      breakEmployee: {
        breakOver6hOverride: emp.breakOver6hOverride ?? null,
        breakOver9hOverride: emp.breakOver9hOverride ?? null,
        birthDate: emp.birthDate,
      },
      breakTenantConfig,
      creditedMinutesByDate,
      schoolDays,
      holidaySollMinutesByDate,
      shifts,
    });
  }
  return result;
}
