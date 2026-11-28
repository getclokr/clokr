/**
 * day-entry-actions.ts
 *
 * Issue #70 (D-07/D-12) — the presentation decisions of the two time-entry pages once a day may
 * hold several entries: what a calendar cell opens, what "Neuer Eintrag" opens, which salons the
 * form offers, which salon the page sends, and the tooltip of a multi-entry cell.
 *
 * Presentation only. The server decides validity, the salon, an overlap (409) and the month lock;
 * nothing here is an access rule, and the header salon selection is deliberately not an input
 * (`selectedSalonId` is a view filter, never a booking salon).
 *
 * Pure module: `date-fns` formatting only, so it is unit-testable without a mounted page (this
 * repo's vitest setup does not mount route pages).
 */
import { format } from "date-fns";

/** The default form of a day without entries, exactly what the pages always preset. */
export const DEFAULT_ENTRY_START = "09:00";
export const DEFAULT_ENTRY_END = "17:00";
const DEFAULT_START = DEFAULT_ENTRY_START;
const DEFAULT_END = DEFAULT_ENTRY_END;
/** Length of the preset for a further entry on a day that already has some. */
const PRESET_MINUTES = 60;
const LATEST_END = "23:59";

/** What the pages need of a loaded entry row to decide; the pages' own row types extend it. */
export interface DayEntryRow {
  id: string;
  date?: string | null;
  startTime: string;
  endTime: string | null;
  /** The salon the entry was recorded in. */
  salonId?: string | null;
  /** Display name of that salon, served by `GET /time-entries` since 70b-06. */
  salonName?: string | null;
  /** A row of a closed month: it can no longer be ended or edited. */
  isLocked?: boolean | null;
}

export interface SalonOption {
  id: string;
  name: string;
}

export type CellAction<T extends DayEntryRow> =
  { kind: "new" } | { kind: "edit"; entry: T } | { kind: "list" };

export type AddAction<T extends DayEntryRow> =
  { kind: "edit"; entry: T } | { kind: "new"; start: string; end: string };

/**
 * Whether a new-form preset is the plain default of an empty day (09:00 - 17:00). A preset that
 * continues after the day's last entry never equals it (its end is one hour after its start).
 */
export function isDefaultPreset(preset: { start: string; end: string }): boolean {
  return preset.start === DEFAULT_ENTRY_START && preset.end === DEFAULT_ENTRY_END;
}

/**
 * What clicking a calendar cell opens: nothing recorded -> the new form, exactly one entry -> that
 * entry for editing (the long-standing behaviour), several -> the list focused on the day.
 */
export function cellClickAction<T extends DayEntryRow>(dayEntries: readonly T[]): CellAction<T> {
  if (dayEntries.length === 0) return { kind: "new" };
  if (dayEntries.length === 1) return { kind: "edit", entry: dayEntries[0] };
  return { kind: "list" };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmmOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The own entry of a day that is still OPEN (no end), the one whose end a person has to enter:
 * a row of a closed month cannot be ended and is skipped; a trip is always closed. `null` when the
 * day has none. With several (impossible since the database allows one open entry per day) the
 * first in the served order wins.
 */
export function openEntryOfDay<T extends DayEntryRow>(dayEntries: readonly T[]): T | null {
  return dayEntries.find((entry) => entry.endTime === null && entry.isLocked !== true) ?? null;
}

export interface AddActionOptions {
  /**
   * Issue #1085: a day with an open entry never gets a second entry from an add action - the open
   * entry opens instead, so its end is entered (inside the retro window) or requested as a
   * correction (outside it). Set by the own time page. Left off by the manager's team page, which
   * keeps the pre-#1085 rule: there the server answers an overlap with the open entry.
   */
  endOpenEntryFirst?: boolean;
}

/**
 * What "Neuer Eintrag" (and "Weiteren Eintrag an diesem Tag") opens for a day.
 *
 * Without salon options (`multiEntryUi` false, D-12) the page behaves as it always did: a day with
 * an entry opens that entry (the first row), an empty day opens the 09:00-17:00 form. With salon
 * options a day with entries opens a NEW form whose start is the day's latest recorded end (a
 * second entry begins where the last one stopped) and whose end is an hour later, at most 23:59.
 * An entry still running has no end and sets nothing; a day with only a running entry falls back
 * to the default (the server refuses an overlap with it anyway).
 *
 * Issue #1085: with `endOpenEntryFirst` the open entry of the day wins over all of that, in both
 * modes - the form of a NEW entry on such a day could only end in the overlap refusal, and outside
 * the retro window its Zeitnachtrag would never reach the correction path that closes the entry.
 */
export function addActionForDay<T extends DayEntryRow>(
  dayEntries: readonly T[],
  multiEntryUi: boolean,
  options: AddActionOptions = {},
): AddAction<T> {
  if (options.endOpenEntryFirst) {
    const open = openEntryOfDay(dayEntries);
    if (open) return { kind: "edit", entry: open };
  }
  if (!multiEntryUi && dayEntries.length > 0) return { kind: "edit", entry: dayEntries[0] };
  let latestEnd: string | null = null;
  for (const entry of dayEntries) {
    if (!entry.endTime) continue;
    const end = format(new Date(entry.endTime), "HH:mm");
    if (latestEnd === null || end > latestEnd) latestEnd = end;
  }
  if (!multiEntryUi || latestEnd === null) {
    return { kind: "new", start: DEFAULT_START, end: DEFAULT_END };
  }
  const end = Math.min(minutesOf(latestEnd) + PRESET_MINUTES, minutesOf(LATEST_END));
  return { kind: "new", start: latestEnd, end: hhmmOf(end) };
}

/** What `prefillNewEntry` needs of a loaded row; the pages' own row types satisfy it. */
export interface PrefillEntryRow {
  date?: string | null;
  startTime: string;
  endTime: string | null;
  breaks?: ReadonlyArray<{ startTime: string; endTime: string }> | null;
  type?: string | null;
  isInvalid?: boolean | null;
  /** `TRAVEL` marks a trip between two salons; never a usual working day. */
  activityKind?: string | null;
  /** Set on the row coupled to a pending Zeitnachtrag; it is not a recorded day yet. */
  retroRequestId?: string | null;
}

/** Where a prefilled form came from, so the page can say so in one visible line. */
export type PrefillSource =
  { kind: "usual"; day: string } | { kind: "contract"; minutes: number } | { kind: "default" };

export interface PrefillNewEntryResult {
  start: string;
  end: string;
  breaks: { start: string; end: string }[];
  source: PrefillSource;
}

export interface PrefillNewEntryInput {
  /** The rows loaded for the month on screen. */
  entries: readonly PrefillEntryRow[];
  /** The contract Soll of the weekday of the target day in minutes; 0 when unknown or a day off. */
  dayContractMinutes: number;
  /** The tenant's default break start (`HH:mm`), `null` when it has none. */
  defaultBreakStart: string | null;
  /**
   * The break a stay of `grossMinutes` presence that starts at `startHHmm` needs, asked from the
   * server (Issue #525: the preview route's `suggestedBreakMinutes`). Injected, so this module holds
   * no § 4 / § 11 threshold (`arbzg-threshold-guard.test.ts`); the server re-derives the break on save.
   */
  breakMinutesFor: (grossMinutes: number, startHHmm: string) => Promise<number>;
}

function dayKeyOf(entry: PrefillEntryRow): string {
  return (entry.date ?? entry.startTime).split("T")[0];
}

function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00`).getDay();
}

/** A break row for `[start, end]` only when it lies inside the work period (never invented). */
function placedBreak(
  defaultBreakStart: string | null,
  breakMinutes: number,
  start: string,
  end: string,
): { start: string; end: string }[] {
  if (breakMinutes <= 0 || !defaultBreakStart) return [];
  const breakStart = minutesOf(defaultBreakStart);
  const breakEnd = breakStart + breakMinutes;
  if (breakStart <= minutesOf(start) || breakEnd >= minutesOf(end)) return [];
  return [{ start: defaultBreakStart, end: hhmmOf(breakEnd) }];
}

/**
 * Issue #991 N-09 / M-44 (D-991-06) — what a NEW single entry on an empty day starts with, in this
 * order:
 *
 * 1. The person's usual day: the latest day other than `day` in the loaded month that has exactly one
 *    entry, which is closed, valid, a plain working entry (no trip, no row of a pending Zeitnachtrag),
 *    preferring the same weekday. Start, end and breaks are copied as recorded - the person's own data.
 * 2. The contract hours of that weekday: 09:00 plus the Soll plus the break the server's suggestion
 *    names for that stay (`breakMinutesFor`). The break ROW is only filled when the tenant has a
 *    default break start and it lies inside the work period: a break start is never invented
 *    (Phase 93, BREAK-07).
 * 3. 09:00-17:00, as before, with the same break rule.
 *
 * Presentation only (async only because the break suggestion is a server answer): the server stays
 * the authority for overlap, lock, the retro window and ArbZG, and the person sees the visible
 * „bitte prüfen“ line before anything is saved.
 */
export async function prefillNewEntry(
  day: string,
  input: PrefillNewEntryInput,
): Promise<PrefillNewEntryResult> {
  const byDay = new Map<string, PrefillEntryRow[]>();
  for (const entry of input.entries) {
    const key = dayKeyOf(entry);
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  }

  const candidates: { day: string; entry: PrefillEntryRow }[] = [];
  for (const [key, rows] of byDay) {
    if (key === day || rows.length !== 1) continue;
    const entry = rows[0];
    if (!entry.endTime || entry.isInvalid) continue;
    if ((entry.type ?? "WORK") !== "WORK" || entry.activityKind === "TRAVEL") continue;
    if (entry.retroRequestId) continue;
    const start = format(new Date(entry.startTime), "HH:mm");
    const end = format(new Date(entry.endTime), "HH:mm");
    if (end <= start) continue; // an overnight row is no usual day for a same-day form
    candidates.push({ day: key, entry });
  }
  candidates.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)); // latest first
  const wanted = weekdayOf(day);
  const usual = candidates.find((c) => weekdayOf(c.day) === wanted) ?? candidates[0];
  if (usual) {
    const { entry } = usual;
    return {
      start: format(new Date(entry.startTime), "HH:mm"),
      end: format(new Date(entry.endTime as string), "HH:mm"),
      breaks: (entry.breaks ?? []).map((b) => ({
        start: format(new Date(b.startTime), "HH:mm"),
        end: format(new Date(b.endTime), "HH:mm"),
      })),
      source: { kind: "usual", day: usual.day },
    };
  }

  const { dayContractMinutes: minutes, defaultBreakStart, breakMinutesFor } = input;
  if (minutes > 0) {
    const start = DEFAULT_START;
    const breakMinutes = await breakMinutesFor(minutes, start);
    const end = hhmmOf(Math.min(minutesOf(start) + minutes + breakMinutes, minutesOf(LATEST_END)));
    return {
      start,
      end,
      breaks: placedBreak(defaultBreakStart, breakMinutes, start, end),
      source: { kind: "contract", minutes },
    };
  }

  // The plain default, exactly the former prefill: the break for the gross stay of 09:00-17:00.
  return {
    start: DEFAULT_START,
    end: DEFAULT_END,
    breaks: placedBreak(
      defaultBreakStart,
      await breakMinutesFor(minutesOf(DEFAULT_END) - minutesOf(DEFAULT_START), DEFAULT_START),
      DEFAULT_START,
      DEFAULT_END,
    ),
    source: { kind: "default" },
  };
}

/**
 * The salons the entry form offers: the salons the caller reaches (from the salon-context store),
 * sorted by name, plus - when editing - the entry's own salon by its served name if the reach no
 * longer lists it (a deactivated salon, a salon outside today's reach). An entry whose answer
 * carries no name adds nothing; the form then simply cannot re-select it.
 */
export function salonFieldOptions(
  contextSalons: readonly SalonOption[],
  entry: DayEntryRow | null,
): SalonOption[] {
  const options = contextSalons.map((salon) => ({ id: salon.id, name: salon.name }));
  if (entry?.salonId && entry.salonName && !options.some((salon) => salon.id === entry.salonId)) {
    options.push({ id: entry.salonId, name: entry.salonName });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

/**
 * The `salonId` the page sends with a save or a preview. A new entry sends the salon only when
 * one was picked (no pick: the server derives it); an edited entry only when the pick differs from
 * the entry's own salon (a salon change is an explicit act, never a side effect of saving).
 */
export function salonIdToSend(picked: string, entrySalonId: string | null): string | undefined {
  if (picked === "") return undefined;
  if (entrySalonId !== null && picked === entrySalonId) return undefined;
  return picked;
}

/** The tooltip of a calendar cell with several entries; none for zero or one. */
export function entryCountTitle(count: number): string | null {
  return count >= 2 ? `${count} Einträge` : null;
}
