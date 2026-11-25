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
 *
 * A cell carries three states beside its minutes, all booleans or salon names and never a kind:
 * `elsewhere` (time of the person in another salon INSIDE the caller's reach), `elsewhereHidden`
 * (valid time the caller's reach does not cover: neither minutes nor a salon, #85) and `absent`
 * (the person's Stammsalon is this salon on that day and leave or an imposed absence covers it - the
 * type, the reason and a half day never leave this module).
 */
import type { addWorkingMinutes } from "../contexts/time-tracking";
import { personDayKey } from "./team-entry-scope";
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
  /** Aushilfen only: the Stammsalon at the window Stichtag; `null` = none (`undefined` = not a helper row). */
  homeSalonId?: string | null;
  homeSalonName?: string | null;
}

export interface SalonHoursElsewhere {
  salonId: string;
  salonName: string;
}

export interface SalonHoursCell {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Worked minutes in THIS salon; 0 on a day that is not counted yet. */
  minutes: number;
  /** False for a day after tenant-local yesterday: nothing is counted there. */
  counted: boolean;
  /** Other salons the person worked in on this day, inside the caller's reach (counted days only). */
  elsewhere: SalonHoursElsewhere[];
  /** Valid time on a counted day that the caller's reach does not cover; no minutes, no salon. */
  elsewhereHidden: boolean;
  /** The person's Stammsalon is this salon on that day and leave or an absence covers it. */
  absent: boolean;
  /** An open (not clocked out) WORK row of this salon on a counted day: a missing clock-out (P-08). */
  open: boolean;
}

export interface SalonHoursRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalMinutes: number;
  cells: SalonHoursCell[];
  /** Aushilfen rows only. */
  homeSalonId?: string | null;
  homeSalonName?: string | null;
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
  /** Display names of the salons, inactive ones included. */
  salonNames: ReadonlyMap<string, string>;
  /** Stammteam: name the other salons a person worked in; off for the Aushilfen. */
  showElsewhere: boolean;
  /** Stammteam: per person the days that are `absent` (see {@link absentDaysOf}); absent = no day. */
  absentByPerson?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Scoped caller, Stammteam: valid rows per person-day outside the reach ({@link personDayKey}). */
  hiddenValidCounts?: ReadonlyMap<string, number>;
  /** Withhold the Personalnummer of every row (a scoped caller reading entry-only persons). */
  withholdNumbers?: boolean;
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

export interface AbsentDaysInput {
  salonId: string;
  days: readonly string[];
  /** The persons whose cells can be `absent` (the Stammteam). */
  personIds: readonly string[];
  /** The Stammsalon per person and day (`homeSalonsForDays`); a missing map is "not homed". */
  homeByPerson: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
  /** Effective leave rows and imposed absences overlapping the window; only person and period are read. */
  covers: ReadonlyArray<{ employeeId: string; startDate: Date; endDate: Date }>;
}

/**
 * Per person the days on which the Stammsalon is this salon (#84 D-13: an absence follows the
 * Stammsalon per day) and some leave or absence row covers the day. Only the person and the day
 * leave this function - never the type, the reason or a half day.
 */
export function absentDaysOf(input: AbsentDaysInput): Map<string, Set<string>> {
  const { salonId, days, personIds, homeByPerson, covers } = input;
  const byPerson = new Map<string, Array<{ start: string; end: string }>>();
  for (const row of covers) {
    const list = byPerson.get(row.employeeId) ?? [];
    list.push({
      start: entryDayKey({ date: row.startDate }),
      end: entryDayKey({ date: row.endDate }),
    });
    byPerson.set(row.employeeId, list);
  }
  const result = new Map<string, Set<string>>();
  for (const id of personIds) {
    const periods = byPerson.get(id);
    const home = homeByPerson.get(id);
    if (!periods || !home) continue;
    const absent = new Set<string>();
    for (const day of days) {
      if (home.get(day) !== salonId) continue;
      if (periods.some((p) => p.start <= day && day <= p.end)) absent.add(day);
    }
    if (absent.size > 0) result.set(id, absent);
  }
  return result;
}

export function buildSalonHoursBlock(input: SalonHoursBlockInput): SalonHoursBlock {
  const { salonId, days, countedThrough, yesterday, persons, rowsByPerson, salonNames } = input;
  const dayTotals = days.map(() => 0);
  const rows: SalonHoursRow[] = sortedPersons(persons).map((person) => {
    const byDay = new Map<string, SalonHoursEntryRow[]>();
    for (const row of countableRows(rowsByPerson.get(person.id) ?? [])) {
      const key = entryDayKey(row);
      const list = byDay.get(key);
      if (list) list.push(row);
      else byDay.set(key, [row]);
    }
    const absentDays = input.absentByPerson?.get(person.id);
    const allRows = rowsByPerson.get(person.id) ?? [];
    let totalMinutes = 0;
    const cells = days.map((date, index): SalonHoursCell => {
      const counted = countedThrough !== null && date <= countedThrough;
      const dayRows = byDay.get(date) ?? [];
      const minutes = counted ? salonWorkedMinutesOf(dayRows, salonId, yesterday) : 0;
      totalMinutes += minutes;
      dayTotals[index] += minutes;
      const elsewhere: SalonHoursElsewhere[] = [];
      if (counted && input.showElsewhere) {
        const seen = new Set<string>();
        for (const row of dayRows) {
          if (row.salonId === salonId || seen.has(row.salonId)) continue;
          seen.add(row.salonId);
          elsewhere.push({ salonId: row.salonId, salonName: salonNames.get(row.salonId) ?? "" });
        }
        elsewhere.sort((a, b) => byText(a.salonName, b.salonName) || byText(a.salonId, b.salonId));
      }
      return {
        date,
        minutes,
        counted,
        elsewhere,
        elsewhereHidden:
          counted && (input.hiddenValidCounts?.get(personDayKey(person.id, date)) ?? 0) > 0,
        absent: absentDays?.has(date) ?? false,
        open:
          counted &&
          allRows.some(
            (r) => r.endTime === null && r.salonId === salonId && entryDayKey(r) === date,
          ),
      };
    });
    const row: SalonHoursRow = {
      employeeId: person.id,
      employeeName: `${person.firstName} ${person.lastName}`,
      employeeNumber: input.withholdNumbers ? null : person.employeeNumber,
      totalMinutes,
      cells,
    };
    if (person.homeSalonId !== undefined) {
      row.homeSalonId = person.homeSalonId;
      row.homeSalonName = person.homeSalonName ?? null;
    }
    return row;
  });
  return { rows, dayTotals, totalMinutes: dayTotals.reduce((sum, m) => sum + m, 0) };
}

// ── Open items (P-08) ───────────────────────────────────────────────────────────────────────────

export interface SalonHoursOpenItem {
  employeeId: string;
  employeeName: string;
  /** Calendar day of the open entry, `YYYY-MM-DD`. */
  date: string;
  /** Tenant-local `HH:MM` the entry started. */
  startTime: string;
}

export interface OpenItemsInput {
  salonId: string;
  /** Tenant-local yesterday as a UTC-midnight calendar day: the last day an open row can be "missing". */
  yesterday: Date;
  persons: readonly SalonHoursPerson[];
  rowsByPerson: ReadonlyMap<string, readonly SalonHoursEntryRow[]>;
  /** Formats an instant as the tenant-local `HH:MM` (injected: this module reads no time zone). */
  timeOf: (instant: Date) => string;
}

/**
 * The missing clock-outs of this salon: open WORK rows recorded here and dated before tenant-local
 * today - the definition of `findMissingClockOutEntries` / the Aufgaben "Ausstempeln fehlt" (#853),
 * computed from the rows already read (and already narrowed to the caller's reach). A running row of
 * today is not "offen". Ordered by day, start time, name, id; nothing is created or written.
 */
export function buildOpenItems(input: OpenItemsInput): SalonHoursOpenItem[] {
  const items: Array<SalonHoursOpenItem & { sortStart: number }> = [];
  for (const person of input.persons) {
    for (const r of input.rowsByPerson.get(person.id) ?? []) {
      if (r.endTime !== null || r.salonId !== input.salonId || r.date > input.yesterday) continue;
      items.push({
        employeeId: person.id,
        employeeName: `${person.firstName} ${person.lastName}`,
        date: entryDayKey(r),
        startTime: input.timeOf(r.startTime),
        sortStart: r.startTime.getTime(),
      });
    }
  }
  items.sort(
    (a, b) =>
      byText(a.date, b.date) ||
      a.sortStart - b.sortStart ||
      byText(a.employeeName, b.employeeName) ||
      byText(a.employeeId, b.employeeId),
  );
  return items.map(({ sortStart: _sortStart, ...item }) => item);
}

// ── Exchange with other salons (P-04) ───────────────────────────────────────────────────────────

export interface SalonHoursExchangePerson {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  minutes: number;
}

export interface SalonHoursExchangeGroup {
  /** The counterpart salon; `null` = a helper without a Stammsalon. */
  salonId: string | null;
  salonName: string | null;
  persons: number;
  minutes: number;
  people: SalonHoursExchangePerson[];
}

export interface SalonHoursExchange {
  /** The Aushilfen of this salon, grouped by their Stammsalon. */
  fromOtherSalons: SalonHoursExchangeGroup[];
  /** The Stammteam's time in other salons (inside the caller's reach), grouped by entry salon. */
  ownTeamElsewhere: SalonHoursExchangeGroup[];
}

export interface ExchangeInput {
  salonId: string;
  yesterday: Date;
  countedThrough: string | null;
  salonNames: ReadonlyMap<string, string>;
  /** The Aushilfen rows of the block (hours already derived, Stammsalon on the Stichtag). */
  helpers: readonly SalonHoursRow[];
  stammteamPersons: readonly SalonHoursPerson[];
  rowsByPerson: ReadonlyMap<string, readonly SalonHoursEntryRow[]>;
}

/** Groups sorted by salon name, the group without a salon last. */
function sortGroups(groups: SalonHoursExchangeGroup[]): SalonHoursExchangeGroup[] {
  return groups.sort((a, b) => {
    if (a.salonId === null || b.salonId === null) {
      return a.salonId === b.salonId ? 0 : a.salonId === null ? 1 : -1;
    }
    return byText(a.salonName ?? "", b.salonName ?? "") || byText(a.salonId, b.salonId);
  });
}

function sortedPeople(people: SalonHoursExchangePerson[]): SalonHoursExchangePerson[] {
  return people.sort(
    (a, b) => byText(a.employeeName, b.employeeName) || byText(a.employeeId, b.employeeId),
  );
}

/**
 * The card "Austausch mit anderen Salons", built from rows already read. The Aushilfen direction is
 * the helper block itself, so its minutes are the block's by construction; the other direction sums
 * the Stammteam's counted days in each other salon through `salonWorkedMinutesOf` - the one minutes
 * derivation - never a second one.
 */
export function buildExchange(input: ExchangeInput): SalonHoursExchange {
  const from = new Map<string | null, SalonHoursExchangeGroup>();
  for (const helper of input.helpers) {
    const key = helper.homeSalonId ?? null;
    const group = from.get(key) ?? {
      salonId: key,
      salonName: key === null ? null : (input.salonNames.get(key) ?? helper.homeSalonName ?? null),
      persons: 0,
      minutes: 0,
      people: [],
    };
    group.persons += 1;
    group.minutes += helper.totalMinutes;
    group.people.push({
      employeeId: helper.employeeId,
      employeeName: helper.employeeName,
      employeeNumber: helper.employeeNumber,
      minutes: helper.totalMinutes,
    });
    from.set(key, group);
  }

  const elsewhere = new Map<string, SalonHoursExchangeGroup>();
  if (input.countedThrough !== null) {
    for (const person of input.stammteamPersons) {
      const byOtherSalon = new Map<string, Map<string, SalonHoursEntryRow[]>>();
      for (const r of countableRows(input.rowsByPerson.get(person.id) ?? [])) {
        const day = entryDayKey(r);
        if (r.salonId === input.salonId || day > input.countedThrough) continue;
        const days = byOtherSalon.get(r.salonId) ?? new Map<string, SalonHoursEntryRow[]>();
        days.set(day, [...(days.get(day) ?? []), r]);
        byOtherSalon.set(r.salonId, days);
      }
      for (const [otherSalonId, days] of byOtherSalon) {
        let minutes = 0;
        for (const dayRows of days.values()) {
          minutes += salonWorkedMinutesOf(dayRows, otherSalonId, input.yesterday);
        }
        if (minutes <= 0) continue;
        const group = elsewhere.get(otherSalonId) ?? {
          salonId: otherSalonId,
          salonName: input.salonNames.get(otherSalonId) ?? "",
          persons: 0,
          minutes: 0,
          people: [],
        };
        group.persons += 1;
        group.minutes += minutes;
        group.people.push({
          employeeId: person.id,
          employeeName: `${person.firstName} ${person.lastName}`,
          employeeNumber: person.employeeNumber,
          minutes,
        });
        elsewhere.set(otherSalonId, group);
      }
    }
  }

  const finish = (groups: Iterable<SalonHoursExchangeGroup>) =>
    sortGroups([...groups]).map((g) => ({ ...g, people: sortedPeople(g.people) }));
  return { fromOtherSalons: finish(from.values()), ownTeamElsewhere: finish(elsewhere.values()) };
}
