/**
 * minor-shift-limits.ts
 *
 * Issue #1057 — § 8 (daily and weekly working time) and § 12 (Schichtzeit) JArbSchG for a roster
 * shift of a person who is under 18 on the shift date. This module only READS; it never writes a
 * row, an audit entry or a saldo figure.
 *
 * Legal reading (the decision record is the #1057 comment and docs/compliance.md):
 *  - Scope: JArbSchG applies instead of the ArbZG to a person under 18 (§ 18 Abs. 2 ArbZG). The age
 *    is decided per day by `isMinorAtDate` (the 18th birthday itself is adult); a missing birth date
 *    is not a minor.
 *  - Arbeitszeit (§ 4 Abs. 1) is net of the Ruhepause: the sum of `shiftNettoMinutes()` (the one
 *    break rule, `breakAmountFor`, #1060) over the day's shifts plus the day's Berufsschule credit
 *    (§ 9 Abs. 2) as the Arbeitszeitkonto already computes it (read only).
 *  - § 8 Abs. 1 / 2a: more than 8:00 a day is a violation unless another Werktag (Mon-Sat) of the
 *    same week has less than 8:00; then up to 8:30 is allowed. A Werktag without work counts as
 *    shortened (wording "auf weniger als acht Stunden verkürzt"). § 8 Abs. 2 proper (Brückentage,
 *    five-week average) is not modelled.
 *  - Week (§ 4 Abs. 4 S. 1): Monday to Sunday, minor days only, limit 40:00. § 4 Abs. 4 S. 2 (the
 *    working time lost to a public holiday counts) is NOT applied: an owner decision is open.
 *  - § 12: Schichtzeit = earliest start to latest end of the day's shifts (every interruption of at
 *    least 15 min is a Ruhepause, so gaps are inside it), at most 10:00.
 *  - A write is refused only when it CREATES a violation or ENLARGES one (day figure, span or week
 *    sum grows), so an already illegal plan (legacy, Phorest import) never freezes the roster.
 *
 * The day/week arithmetic lives in `evaluateMinorWeekFigures` over per-day minute figures, not over
 * Shift rows, so the recording side (#524) can reuse it without a rewrite.
 *
 * A plan nobody can refuse (Phorest import, Issue #1074) is reported with
 * `findStoredMinorWeekViolations`, which lists every violation of the stored week with the same
 * predicates and messages; the module still only reads.
 */
import type { PrismaClient } from "@clokr/db";
import { isMinorAtDate, mondayOfWeekUtc } from "../absence";
import {
  dayRangeUtc,
  getTenantTimezone,
  getVocationalSchoolMinutesForDate,
} from "../working-time-account";
import type { BreakTenantConfigShape } from "../time-tracking";
import { shiftNettoMinutes, type ShiftBreakEmployee } from "./shift-netto";

/** § 8 Abs. 1 JArbSchG: 8 h a day. */
export const MINOR_DAILY_LIMIT_MINUTES = 480;
/** § 8 Abs. 2a JArbSchG: 8.5 h a day when another Werktag of the week is shortened. */
export const MINOR_DAILY_EXTENDED_LIMIT_MINUTES = 510;
/** § 8 Abs. 1 JArbSchG: 40 h a week. */
export const MINOR_WEEKLY_LIMIT_MINUTES = 2400;
/** § 12 JArbSchG: Schichtzeit of at most 10 h. */
export const MINOR_SHIFT_TIME_LIMIT_MINUTES = 600;

export type MinorShiftLimitCode =
  | "JARBSCHG_VIOLATION_DAILY_MAX"
  | "JARBSCHG_VIOLATION_WEEKLY_MAX"
  | "JARBSCHG_VIOLATION_SHIFT_TIME";

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
  shifts: Array<ShiftDraft & { id: string }>;
}

/** The per-day minute figures the week arithmetic works on. */
export interface MinorDayFigures {
  isMinor: boolean;
  /** Net Arbeitszeit of the day including the Berufsschule credit. */
  workMinutes: number;
  /** Earliest start to latest end of the day's shifts; 0 without a shift. */
  spanMinutes: number;
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

function weekSum(figures: MinorDayFigures[]): number {
  return figures.reduce((sum, f) => sum + (f.isMinor ? f.workMinutes : 0), 0);
}

function dailyMessage(dateIso: string, workMinutes: number): string {
  return `Die geplante Arbeitszeit am ${formatDateDe(dateIso)} beträgt ${formatHm(workMinutes)} Stunden. Für Jugendliche sind höchstens 8 Stunden am Tag erlaubt, bis zu 8,5 Stunden nur, wenn an einem anderen Werktag derselben Woche weniger als 8 Stunden gearbeitet wird (§ 8 Abs. 1 und 2a JArbSchG).`;
}

function shiftTimeMessage(dateIso: string, spanMinutes: number): string {
  return `Die Schichtzeit am ${formatDateDe(dateIso)} beträgt ${formatHm(spanMinutes)} Stunden (Beginn bis Ende einschließlich Pausen). Für Jugendliche sind höchstens 10 Stunden erlaubt (§ 12 JArbSchG).`;
}

/** With a trigger day the text names the shift that tipped the week; without, it names the week. */
function weeklyMessage(weekDays: string[], sumMinutes: number, triggerIso: string | null): string {
  const limit =
    "Für Jugendliche sind höchstens 40 Stunden in der Woche erlaubt, Berufsschulzeit eingerechnet (§ 8 Abs. 1 und § 9 Abs. 2 JArbSchG).";
  const range = `${formatShortDateDe(weekDays[0])} bis ${formatDateDe(weekDays[6])}`;
  if (triggerIso === null) {
    return `In der Woche vom ${range} beträgt die geplante Arbeitszeit ${formatHm(sumMinutes)} Stunden. ${limit}`;
  }
  return `Mit der Schicht am ${formatDateDe(triggerIso)} beträgt die geplante Arbeitszeit in der Woche vom ${range} ${formatHm(sumMinutes)} Stunden. ${limit}`;
}

/**
 * Compares the week before and after a change. `before` and `after` hold seven figures, Monday to
 * Sunday. The trigger day is checked first, the rest in calendar order; the weekly sum last.
 */
export function evaluateMinorWeekFigures(input: {
  weekDays: string[];
  triggerIso: string;
  before: MinorDayFigures[];
  after: MinorDayFigures[];
}): MinorShiftLimitViolation | null {
  const { weekDays, triggerIso, before, after } = input;

  const triggerIndex = weekDays.indexOf(triggerIso);
  const order = [
    ...(triggerIndex >= 0 ? [triggerIndex] : []),
    ...weekDays.map((_, i) => i).filter((i) => i !== triggerIndex),
  ];

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
  }

  const afterSum = weekSum(after);
  if (afterSum > MINOR_WEEKLY_LIMIT_MINUTES && afterSum > weekSum(before)) {
    const weeklyDateIso = triggerIndex >= 0 ? weekDays[triggerIndex] : weekDays[0];
    return {
      code: "JARBSCHG_VIOLATION_WEEKLY_MAX",
      dateIso: weeklyDateIso,
      message: weeklyMessage(weekDays, afterSum, weeklyDateIso),
    };
  }
  return null;
}

/**
 * Every violation the given figures hold (Issue #1074) — the stored week of a plan nobody can
 * refuse. Same predicates and message builders as `evaluateMinorWeekFigures`: per day in calendar
 * order DAILY_MAX then SHIFT_TIME (both may occur on one day), then WEEKLY_MAX (dated Monday).
 */
export function listMinorWeekViolations(input: {
  weekDays: string[];
  figures: MinorDayFigures[];
}): MinorShiftLimitViolation[] {
  const { weekDays, figures } = input;
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
  }
  const sum = weekSum(figures);
  if (sum > MINOR_WEEKLY_LIMIT_MINUTES) {
    out.push({
      code: "JARBSCHG_VIOLATION_WEEKLY_MAX",
      dateIso: weekDays[0],
      message: weeklyMessage(weekDays, sum, null),
    });
  }
  return out;
}

/** Short German label of a finding for a list of further violations ("DD.MM.YYYY (Arbeitszeit)"). */
export function minorShiftLimitLabel(v: MinorShiftLimitViolation): string {
  if (v.code === "JARBSCHG_VIOLATION_DAILY_MAX") return `${formatDateDe(v.dateIso)} (Arbeitszeit)`;
  if (v.code === "JARBSCHG_VIOLATION_SHIFT_TIME") return `${formatDateDe(v.dateIso)} (Schichtzeit)`;
  return "Wochenarbeitszeit";
}

// ── rows -> figures ──────────────────────────────────────────────────────────────────────────────

function figuresFor(
  week: MinorShiftWeek,
  shifts: Array<ShiftDraft & { id?: string }>,
): MinorDayFigures[] {
  return week.weekDays.map((iso) => {
    const day = shifts.filter((s) => isoOf(s.date) === iso);
    const dayDate = utcMidnightOf(iso);
    let work = week.creditedMinutesByDate[iso] ?? 0;
    let earliest = Number.POSITIVE_INFINITY;
    let latest = Number.NEGATIVE_INFINITY;
    for (const s of day) {
      work += shiftNettoMinutes(s, week.breakEmployee, week.breakTenantConfig);
      let gross = hmToMin(s.endTime) - hmToMin(s.startTime);
      if (gross < 0) gross += 24 * 60; // midnight-crossing, the shift-netto convention
      if (gross <= 0) continue;
      earliest = Math.min(earliest, hmToMin(s.startTime));
      latest = Math.max(latest, hmToMin(s.startTime) + gross);
    }
    return {
      isMinor: isMinorAtDate(week.birthDate, dayDate),
      workMinutes: work,
      spanMinutes: latest > earliest ? latest - earliest : 0,
    };
  });
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
  const inWeek = (d: ShiftDraft) => week.weekDays.includes(isoOf(d.date));
  const beforeShifts = week.shifts.filter((s) => week.weekDays.includes(isoOf(s.date)));
  const afterShifts = [
    ...beforeShifts.filter((s) => s.id !== change.removeShiftId),
    ...change.add.filter(inWeek),
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
  const stored = week.shifts.filter((s) => week.weekDays.includes(isoOf(s.date)));
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
 * exactly one employee read.
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
  const sunday = utcMidnightOf(weekDays[6]);

  const employees = await prisma.employee.findMany({
    where: { id: { in: Array.from(new Set(employeeIds)) }, tenantId },
    select: { id: true, birthDate: true, breakOver6hOverride: true, breakOver9hOverride: true },
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

  for (const emp of minors) {
    const shifts = await prisma.shift.findMany({
      where: {
        employeeId: emp.id,
        employee: { tenantId },
        date: { gte: monday, lte: sunday },
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
    for (const iso of weekDays) {
      if (!isMinorAtDate(emp.birthDate, utcMidnightOf(iso))) continue;
      const dayEnd = dayRangeUtc(iso, tz).end;
      const schedule = schedules.find((s) => s.validFrom <= dayEnd) ?? null;
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
      shifts,
    });
  }
  return result;
}
