// Issue #853 (owner review of Team › Zeiten): the person's month as ONE row per day, the shape of
// the prototype's „Zeiten“ list (Tag · Salon · Zeiten · Pause · Netto · Soll · Differenz · Öffnen).
// The entries themselves (source, note, break intervals, edit and delete) live in the day sheet.
//
// Pure wording over what the page already holds: the entries the server returned for the
// caller's scope and the page's per-day Soll (`expectedMin` of its calendar days). Minutes are
// summed exactly as the page sums them for its Ist (closed, valid entries; presence minus the
// stored `breakMinutes`, #79), so a row never disagrees with the month figure above it. No Soll is
// computed here, and none is shown where the page has none to show (`sollVisible` false).
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { fmtBalance, fmtMin } from "$lib/utils/format-minutes";
import type { ChipTone } from "$lib/components/ui/chip-tone";

export interface DayRowEntry {
  id: string;
  /** The calendar day of the entry (`YYYY-MM-DD…`); falls back to `startTime`. */
  date?: string | null;
  startTime: string;
  endTime: string | null;
  /** The stored break minutes (#79: working time = presence − this). */
  breakMinutes: number;
  /** Set while a break is running (#851 break start/stop). */
  breakStartedAt?: string | null;
  isInvalid?: boolean;
  /** Display name of the salon, or the trip „Nord → Süd“ of a travel row (#92). */
  salonLabel?: string | null;
}

export interface DayRowDayInfo {
  /** The page's Soll of the day in minutes (0 = none). */
  expectedMin: number;
  /**
   * Issue #986: the account's Ist of the day (entries plus credits such as a Berufsschule day),
   * where the page read the account; the Differenz is then taken against it, like the account does.
   */
  creditedMin?: number | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface TeamDayRowsInput {
  entries: DayRowEntry[];
  /** Berufsschule days of the month (`YYYY-MM-DD`), shown as rows without times. */
  vocationalSchoolDays: string[];
  dayInfo: (day: string) => DayRowDayInfo | undefined;
  /** False when the page has no per-day Soll to show (refused read, weekly or monthly total only). */
  sollVisible: boolean;
  /** Days with a finding of the server's day check. */
  findingDays: ReadonlySet<string>;
  /**
   * Issue #987: past workdays the server named „missing“ (`resolveDayStatus` through the team
   * week); each becomes a row, so a gap is never an absent line. Nothing is derived here.
   */
  missingDays?: ReadonlySet<string>;
}

export interface TeamDayRow {
  /** `YYYY-MM-DD`, also the row key. */
  day: string;
  /** „Fr 6.11.“ */
  dayLabel: string;
  salon: string;
  times: string;
  pause: string;
  net: string;
  /** null = the Soll column is not shown. */
  soll: string | null;
  /** The Differenz chip; null = nothing to compare (no Soll, today, future, no closed entry). */
  diff: { label: string; tone: ChipTone } | null;
  /** A quiet status instead of a difference: a running entry or an invalid one. */
  state: { label: string; tone: ChipTone } | null;
  finding: boolean;
  /** The server named this day „missing“ and it has no entry. */
  missing: boolean;
  vocationalSchool: boolean;
  entryIds: string[];
}

function dayOf(e: DayRowEntry): string {
  return (e.date ?? e.startTime).split("T")[0];
}

function hhmm(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

/** Presence minus the stored breaks of a closed entry, in whole minutes (the page's Ist rule). */
export function entryNetMinutes(e: DayRowEntry): number {
  if (!e.endTime) return 0;
  return (
    Math.floor((new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000) -
    (e.breakMinutes ?? 0)
  );
}

/** „Fr 6.11.“ for a `YYYY-MM-DD` day. */
export function weekdayDateLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return `${format(d, "EEEEEE", { locale: de })} ${format(d, "d.M.")}`;
}

/**
 * The pause of a set of entries: the stored minutes of the closed ones as H:MM, or „läuft“ while a
 * break runs. A running entry's stored minutes are not final yet and are never shown.
 */
export function pauseLabel(entries: DayRowEntry[]): string {
  if (entries.some((e) => !e.endTime && e.breakStartedAt)) return "läuft";
  const minutes = entries.filter((e) => e.endTime).reduce((s, e) => s + (e.breakMinutes ?? 0), 0);
  return minutes > 0 ? fmtMin(minutes) : "–";
}

export function teamDayRows(input: TeamDayRowsInput): TeamDayRow[] {
  const byDay = new Map<string, DayRowEntry[]>();
  for (const e of input.entries) {
    const day = dayOf(e);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  const missingSet = input.missingDays ?? new Set<string>();
  const days = new Set<string>([
    ...byDay.keys(),
    ...input.vocationalSchoolDays,
    ...[...missingSet].filter((d) => !byDay.has(d)),
  ]);

  const rows: TeamDayRow[] = [];
  for (const day of days) {
    const list = (byDay.get(day) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const info = input.dayInfo(day);
    const closedValid = list.filter((e) => e.endTime && !e.isInvalid);
    const running = list.some((e) => !e.endTime);
    const invalid = list.some((e) => e.isInvalid);
    const netMin = closedValid.reduce((s, e) => s + entryNetMinutes(e), 0);
    const sollMin = input.sollVisible && info ? info.expectedMin : null;

    const salons = [...new Set(list.map((e) => e.salonLabel).filter(Boolean))] as string[];
    const times = list
      .map((e) =>
        e.endTime ? `${hhmm(e.startTime)}–${hhmm(e.endTime)}` : `ab ${hhmm(e.startTime)}`,
      )
      .join(", ");

    const credited = info?.creditedMin ?? null;
    const comparable =
      sollMin !== null &&
      sollMin > 0 &&
      info !== undefined &&
      !info.isToday &&
      !info.isFuture &&
      !running &&
      (closedValid.length > 0 || credited !== null);
    const diffMin = comparable ? (credited ?? netMin) - (sollMin ?? 0) : null;

    rows.push({
      day,
      dayLabel: weekdayDateLabel(day),
      salon: salons.length > 0 ? salons.join(", ") : "–",
      times:
        list.length > 0
          ? times
          : missingSet.has(day) && !input.vocationalSchoolDays.includes(day)
            ? "Keine Zeit erfasst"
            : "Berufsschule",
      pause: list.length > 0 ? pauseLabel(list) : "–",
      net: closedValid.length > 0 ? fmtMin(netMin) : "–",
      soll: sollMin === null ? null : sollMin > 0 ? fmtMin(sollMin) : "–",
      diff:
        diffMin === null
          ? null
          : {
              label: diffMin === 0 ? "±0:00" : fmtBalance(diffMin),
              tone: diffMin > 0 ? "ok" : diffMin < 0 ? "bad" : "neutral",
            },
      // A running entry of an earlier day is a clock-out that never came; today it simply runs.
      state:
        missingSet.has(day) && list.length === 0
          ? { label: "Fehlt", tone: "bad" }
          : running
            ? info && !info.isToday && !info.isFuture
              ? { label: "nicht ausgestempelt", tone: "warn" }
              : { label: "läuft", tone: "neutral" }
            : invalid
              ? { label: "ungültig", tone: "warn" }
              : null,
      finding: input.findingDays.has(day),
      missing: missingSet.has(day) && list.length === 0,
      vocationalSchool:
        input.vocationalSchoolDays.includes(day) && list.length === 0 && !missingSet.has(day),
      entryIds: list.map((e) => e.id),
    });
  }
  return rows.sort((a, b) => b.day.localeCompare(a.day));
}
