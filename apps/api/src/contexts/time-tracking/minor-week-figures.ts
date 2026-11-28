/**
 * minor-week-figures.ts — Issue #524: the recorded ISO week of one person as per-day § 8 JArbSchG
 * figures, the input of the pure kernel in `minor-working-time.ts`.
 *
 * Read by `checkArbZG` (the recording check of every save path) and by the clock-path notice. Not
 * exported from the context index: it is module-internal, the public surface is the arithmetic.
 *
 * Arbeitszeit (§ 4 Abs. 1) of a day = the working minutes of every closed WORK entry of the person
 * on that day in every salon (the figure § 3 ArbZG sums today), plus on a minor Berufsschultag the
 * Berufsschule credit (§ 9 Abs. 2) as the Arbeitszeitkonto computes it. The age is decided per day,
 * so the week of a person who turns 18 mid-week counts only the days before the birthday.
 */
import type { PrismaClient } from "@clokr/db";
import { getVocationalSchoolDays, isMinorAtDate } from "../absence";
import {
  dayRangeUtc,
  getVocationalSchoolMinutesForDate,
  weekDateRange,
} from "../working-time-account";
import { addWorkingMinutes } from "./entry-durations";
import type { MinorWorkDay } from "./minor-working-time";

/** The TenantConfig fields the loader needs (a subset of what `checkArbZG` reads). */
export interface MinorWeekTenantConfig {
  vocationalSchoolMinutesPerDay?: number | null;
  vocationalSchoolBlockMinutesPerWeek?: number | null;
  bsSlotFirstLongDayMinutes?: number | null;
  bsSlotSecondLongDayMinutes?: number | null;
  bsSlotShortDayMinutes?: number | null;
  bsSlotBlockWeekMinutes?: number | null;
  defaultWorkDays?: number[] | null;
}

export interface MinorRecordedWeek {
  /** Monday..Sunday as YYYY-MM-DD in the tenant time zone. */
  weekDays: string[];
  /** One figure per `weekDays` item. */
  days: MinorWorkDay[];
  /** Index of the evaluated day inside `weekDays`. */
  dayIndex: number;
}

const DAY_MS = 86_400_000;

function utcMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export async function loadMinorRecordedWeek(
  db: PrismaClient,
  input: {
    tenantId: string;
    employee: { id: string; birthDate: Date | null; hireDate: Date; exitDate: Date | null };
    dayIso: string;
    tz: string;
    tenantConfig: MinorWeekTenantConfig | null;
  },
): Promise<MinorRecordedWeek> {
  const { tenantId, employee, dayIso, tz, tenantConfig } = input;

  // Noon keeps the reference instant on the same calendar day in every time zone.
  const { firstDay, lastDay } = weekDateRange(new Date(`${dayIso}T12:00:00Z`), tz);
  const weekStart = firstDay;
  const weekEnd = lastDay;
  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(new Date(weekStart.getTime() + i * DAY_MS).toISOString().slice(0, 10));
  }

  const rows = await db.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      employee: { tenantId },
      deletedAt: null,
      type: "WORK",
      endTime: { not: null },
      date: { gte: weekStart, lte: weekEnd },
    },
    select: {
      startTime: true,
      endTime: true,
      breakMinutes: true,
      date: true,
      salonId: true,
      employeeId: true,
    },
  });

  const schoolRows = await getVocationalSchoolDays(
    db,
    { kind: "employee", employeeId: employee.id, tenantId },
    weekStart,
    weekEnd,
  );
  const schoolDays = new Set(schoolRows.map((r) => r.startDate.toISOString().slice(0, 10)));

  const schedules = await db.workSchedule.findMany({
    where: {
      employeeId: employee.id,
      employee: { tenantId },
      validFrom: { lte: dayRangeUtc(weekDays[6], tz).end },
    },
    orderBy: { validFrom: "desc" },
  });

  const days: MinorWorkDay[] = [];
  for (const iso of weekDays) {
    const isMinor = isMinorAtDate(employee.birthDate, utcMidnight(iso));
    let workMinutes = rows
      .filter((r) => r.date.toISOString().slice(0, 10) === iso)
      .reduce((sum, r) => addWorkingMinutes(sum, r), 0);
    if (isMinor && schoolDays.has(iso)) {
      const dayEnd = dayRangeUtc(iso, tz).end;
      const schedule = schedules.find((s) => s.validFrom <= dayEnd) ?? null;
      workMinutes += await getVocationalSchoolMinutesForDate(
        db,
        employee.id,
        utcMidnight(iso),
        tenantConfig,
        { schedule, scheduleType: schedule?.type ?? null },
      );
    }
    days.push({ isMinor, workMinutes });
  }

  return { weekDays, days, dayIndex: Math.max(0, weekDays.indexOf(dayIso)) };
}
