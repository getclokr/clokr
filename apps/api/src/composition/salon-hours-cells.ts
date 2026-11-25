/**
 * Issue #1030 - the pure builder of the Salonansicht's hours raster (Person x day) for ONE salon.
 *
 * The composition layer owns no model and carries no rule. This module only arranges rows the
 * caller has already read and already narrowed to the caller's reach: it reads no database, no
 * request and no clock. The ONE minutes derivation is `salonWorkedMinutesOf` of the period report
 * (#542/#714: closed, valid WORK entries recorded in the salon through tenant-local yesterday, a
 * travel row counted for its departure salon) - this file never computes a minute any other way, and
 * it never names a Soll, saldo, balance, overtime or expected figure: salon hours are not a contract
 * figure (they belong to the person).
 */
import type { addWorkingMinutes } from "../contexts/time-tracking";
import { salonWorkedMinutesOf } from "./reports-period";

/** A recorded WORK row as the Zeiterfassung facade returns it (the subset this module reads). */
export type SalonHoursEntryRow = {
  employeeId: string;
  date: Date;
  isInvalid: boolean;
  salonId: string;
} & Parameters<typeof addWorkingMinutes>[1];

export interface SalonHoursPerson {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
}

export interface SalonHoursCell {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Worked minutes in THIS salon; 0 on a day that is not counted yet. */
  minutes: number;
  /** False for a day after tenant-local yesterday: nothing is counted there. */
  counted: boolean;
}

export interface SalonHoursRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalMinutes: number;
  cells: SalonHoursCell[];
}

export interface SalonHoursBlock {
  rows: SalonHoursRow[];
  /** Sum of the rows per day, aligned with `days`. */
  dayTotals: number[];
  totalMinutes: number;
}

export interface SalonHoursBlockInput {
  salonId: string;
  /** Calendar days (`YYYY-MM-DD`) of the window, ascending. */
  days: readonly string[];
  /** The last counted day (`YYYY-MM-DD`), null when no day of the window is counted yet. */
  countedThrough: string | null;
  /** Tenant-local yesterday as a UTC-midnight calendar day (the viewpoint's own cut). */
  yesterday: Date;
  persons: readonly SalonHoursPerson[];
  /** The caller's rows per person (any salon, any state); the builder keeps the closed, valid ones. */
  rowsByPerson: ReadonlyMap<string, readonly SalonHoursEntryRow[]>;
}

/** The day key of a recorded row: the UTC date part of its `@db.Date` value (Issue #493). */
export function entryDayKey(row: { date: Date }): string {
  return row.date.toISOString().slice(0, 10);
}

/** The closed, valid rows of a day - the only rows that can ever become minutes. */
function countableRows(rows: readonly SalonHoursEntryRow[]): SalonHoursEntryRow[] {
  return rows.filter((r) => r.endTime !== null && !r.isInvalid);
}

const byText = (a: string, b: string): number => a.localeCompare(b, "de");

/** Rows of a block ordered by last name, first name, id. */
function sortedPersons(persons: readonly SalonHoursPerson[]): SalonHoursPerson[] {
  return [...persons].sort(
    (a, b) =>
      byText(a.lastName, b.lastName) || byText(a.firstName, b.firstName) || byText(a.id, b.id),
  );
}

export function buildSalonHoursBlock(input: SalonHoursBlockInput): SalonHoursBlock {
  const { salonId, days, countedThrough, yesterday, persons, rowsByPerson } = input;
  const dayTotals = days.map(() => 0);
  const rows: SalonHoursRow[] = sortedPersons(persons).map((person) => {
    const byDay = new Map<string, SalonHoursEntryRow[]>();
    for (const row of countableRows(rowsByPerson.get(person.id) ?? [])) {
      const key = entryDayKey(row);
      const list = byDay.get(key);
      if (list) list.push(row);
      else byDay.set(key, [row]);
    }
    let totalMinutes = 0;
    const cells = days.map((date, index): SalonHoursCell => {
      const counted = countedThrough !== null && date <= countedThrough;
      const minutes = counted ? salonWorkedMinutesOf(byDay.get(date) ?? [], salonId, yesterday) : 0;
      totalMinutes += minutes;
      dayTotals[index] += minutes;
      return { date, minutes, counted };
    });
    return {
      employeeId: person.id,
      employeeName: `${person.firstName} ${person.lastName}`,
      employeeNumber: person.employeeNumber,
      totalMinutes,
      cells,
    };
  });
  return { rows, dayTotals, totalMinutes: dayTotals.reduce((sum, m) => sum + m, 0) };
}
