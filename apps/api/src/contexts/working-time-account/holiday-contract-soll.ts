/**
 * holiday-contract-soll.ts — Issue #524 (D-07), moved verbatim from `loadMinorShiftWeeks` (#1077
 * D-01/D-03): the Arbeitszeitkonto's price of a holiday for one person and one day.
 *
 * § 4 Abs. 4 S. 2 JArbSchG counts the working time that falls out on a Werktag holiday towards the
 * week. What falls out is the day's contract Soll under the contract valid on that day, priced by
 * the Arbeitszeitkonto's own day Soll over this ONE day (FIXED_SCHEDULE = the weekday's hours like
 * the month close's holiday reduction, MONTHLY_HOURS = its Ø-day, SHIFT_BASED / FLEXTIME =
 * weeklyHours over the contract days on a contract weekday); a non-contract day prices 0 and so
 * does a day outside the employment (hire day to exit day in tenant-local days, like the exit clip
 * of Issue #447).
 *
 * "Is that day a holiday at the work location" is the Unterbau's answer and stays with the caller.
 * The roster (Schichtplanung) and the recording week (Zeiterfassung) both call this one function.
 *
 * Imports only `./timezone` (a pure leaf), so it can never join the measured import cycle.
 */
import { calcExpectedMinutesTz, dateStrInTz, dayRangeUtc } from "./timezone";

export function holidayContractSollMinutes<
  S extends { validFrom: Date } & Record<string, unknown>,
>(input: {
  /** The tenant-local calendar day, YYYY-MM-DD. */
  dayIso: string;
  /** The person's schedules, latest `validFrom` first. */
  schedules: readonly S[];
  hireDate: Date;
  exitDate: Date | null;
  tz: string;
  defaultWorkDays?: readonly number[] | null;
}): number {
  const { dayIso, schedules, hireDate, exitDate, tz, defaultWorkDays } = input;
  const { start, end } = dayRangeUtc(dayIso, tz);
  const schedule = schedules.find((s) => s.validFrom <= end) ?? null;
  if (!schedule) return 0;
  if (dateStrInTz(hireDate, tz) > dayIso) return 0;
  if (exitDate !== null && dayIso > dateStrInTz(exitDate, tz)) return 0;
  return calcExpectedMinutesTz(schedule, start, end, tz, undefined, defaultWorkDays);
}
