/**
 * Issue #1030 - the Salonansicht of Team › Zeiten as an hours raster of one salon: the response
 * types of `GET /salon-hours`, the period state (a week or a calendar month), the request path and
 * the wording of a cell. Pure, no `$app/*` import, so it is directly testable.
 *
 * Presentation only: the server decides who is a row, which hours a caller may see and every sum;
 * nothing here adds a minute. A cell shows hours worked in THIS salon - never a Soll or saldo, those
 * belong to the person.
 */
import { format, getISOWeek } from "date-fns";
import { de } from "date-fns/locale";
import { fmtMin } from "$lib/utils/format-minutes";

export interface SalonHoursCell {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Minutes worked in this salon; 0 on a day that is not counted yet. */
  minutes: number;
  /** False after tenant-local yesterday: nothing is counted there. */
  counted: boolean;
  /** Other salons the person worked in that day, inside the caller's reach. */
  elsewhere: { salonId: string; salonName: string }[];
  /** Time the caller's reach does not cover: no hours, no salon. */
  elsewhereHidden: boolean;
  /** Leave or an absence covers the day (the kind is never sent). */
  absent: boolean;
}

export interface SalonHoursRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  totalMinutes: number;
  cells: SalonHoursCell[];
}

export interface SalonHoursHelperRow extends SalonHoursRow {
  /** The Stammsalon at the window's Stichtag; null = none. */
  homeSalonId: string | null;
  homeSalonName: string | null;
}

export interface SalonHoursHelperBlock {
  rows: SalonHoursHelperRow[];
  dayTotals: number[];
  totalMinutes: number;
}

export interface SalonHoursBlock {
  rows: SalonHoursRow[];
  /** The server's sum per day, aligned with `days`. */
  dayTotals: number[];
  totalMinutes: number;
}

export interface SalonHoursResponse {
  salonId: string;
  salonName: string;
  period: "week" | "month";
  from: string;
  to: string;
  days: string[];
  /** The last counted day, null when nothing is counted yet. */
  countedThrough: string | null;
  kpis: { salonWorkedMinutes: number; stammteamMinutes: number; aushilfenMinutes: number };
  stammteam: SalonHoursBlock;
  aushilfen: SalonHoursHelperBlock;
}

/** What the Salonansicht currently shows (the page decides, the component renders). */
export type SalonHoursStatus = "prompt" | "loading" | "rejected" | "error" | "ready";

export type SalonZoom = "woche" | "monat";

/** The period of the raster: a week (anchor = its Monday) or a month (anchor = its first day). */
export interface SalonPeriod {
  zoom: SalonZoom;
  /** `YYYY-MM-DD`. */
  anchor: string;
}

// ── calendar arithmetic on `YYYY-MM-DD` strings (UTC, so no host zone or DST ever enters) ──────

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
}

/** The ISO Monday of the week containing `day` (the API's weeks are Monday to Sunday). */
function mondayOf(day: string): string {
  const d = parseDay(day);
  const dow = d.getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function addMonths(firstDay: string, n: number): string {
  const d = parseDay(firstDay);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return dayString(d);
}

/** A `Date` at local noon of a `YYYY-MM-DD` day, for date-fns formatting. */
function localNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

// ── the period ─────────────────────────────────────────────────────────────────────────────────

/**
 * The period the Salonansicht opens with: the week containing tenant-local yesterday, so a Monday
 * never opens an empty week (P-07). `todayStr` is the tenant-local today.
 */
export function defaultSalonPeriod(todayStr: string): SalonPeriod {
  return { zoom: "woche", anchor: mondayOf(addDays(todayStr, -1)) };
}

/** One period back (-1) or forward (+1) at the same zoom. */
export function shiftSalonPeriod(period: SalonPeriod, dir: 1 | -1): SalonPeriod {
  return period.zoom === "woche"
    ? { zoom: "woche", anchor: addDays(period.anchor, 7 * dir) }
    : { zoom: "monat", anchor: addMonths(period.anchor, dir) };
}

/** First day of the period (`YYYY-MM-DD`). */
export function salonPeriodStart(period: SalonPeriod): string {
  return period.anchor;
}

/** Last day of the period (`YYYY-MM-DD`). */
export function salonPeriodEnd(period: SalonPeriod): string {
  return period.zoom === "woche"
    ? addDays(period.anchor, 6)
    : addDays(addMonths(period.anchor, 1), -1);
}

/** The next arrow is disabled when the following period starts after tenant-local today. */
export function salonPeriodNextDisabled(period: SalonPeriod, todayStr: string): boolean {
  return salonPeriodStart(shiftSalonPeriod(period, 1)) > todayStr;
}

/**
 * Changes the zoom and keeps the period near where it was: a week becomes the month it starts in,
 * a month becomes its first week; a week that would lie in the future falls back to the default.
 */
export function salonPeriodWithZoom(
  period: SalonPeriod,
  zoom: SalonZoom,
  todayStr: string,
): SalonPeriod {
  if (period.zoom === zoom) return period;
  if (zoom === "monat") return { zoom, anchor: firstOfMonth(period.anchor) };
  const week = { zoom, anchor: mondayOf(period.anchor) };
  return week.anchor > todayStr ? defaultSalonPeriod(todayStr) : week;
}

/** „KW 48 · 23.–29.11.2026“ for a week, „November 2026“ for a month. */
export function salonPeriodLabel(period: SalonPeriod): string {
  if (period.zoom === "monat") {
    const label = format(localNoon(period.anchor), "LLLL yyyy", { locale: de });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const start = localNoon(period.anchor);
  const end = localNoon(salonPeriodEnd(period));
  const week = getISOWeek(start);
  let range: string;
  if (start.getFullYear() !== end.getFullYear()) {
    range = `${format(start, "d.M.yyyy")}–${format(end, "d.M.yyyy")}`;
  } else if (start.getMonth() !== end.getMonth()) {
    range = `${format(start, "d.M.")}–${format(end, "d.M.yyyy")}`;
  } else {
    range = `${format(start, "d.")}–${format(end, "d.M.yyyy")}`;
  }
  return `KW ${week} · ${range}`;
}

/** `GET /salon-hours` for one salon and period. */
export function salonHoursRequestPath(salonId: string, period: SalonPeriod): string {
  const kind = period.zoom === "woche" ? "week" : "month";
  return `/salon-hours?salonId=${encodeURIComponent(salonId)}&period=${kind}&date=${period.anchor}`;
}

/** „bis Di, 24.11.2026“ - the Stichtag of the counted hours, or „noch nichts gezählt“. */
export function countedThroughLabel(countedThrough: string | null): string {
  if (countedThrough === null) return "noch nichts gezählt";
  const d = localNoon(countedThrough);
  return `bis ${format(d, "EEEEEE", { locale: de })}, ${format(d, "dd.MM.yyyy")}`;
}

/** „Mo 23.“ - the head of a day column; the full date belongs in the head's title. */
export function dayColumnLabel(day: string): string {
  const d = localNoon(day);
  return `${format(d, "EEEEEE", { locale: de })} ${format(d, "d.")}`;
}

/** „Montag, 23.11.2026“ - the full date of a day column (title and accessible names). */
export function dayFullLabel(day: string): string {
  const d = localNoon(day);
  return format(d, "EEEE, dd.MM.yyyy", { locale: de });
}

/**
 * The mode Team › Zeiten opens in: the Salonansicht only when its tab exists (a multi-salon tenant
 * and the view permission), else the person view. A deep link `mode=salon` or a link to a person
 * outside the list therefore never lands in a mode without a tab.
 */
export function teamModeFor(
  requested: "person" | "salon",
  salonTabAvailable: boolean,
): "person" | "salon" {
  return requested === "salon" && salonTabAvailable ? "salon" : "person";
}

/**
 * The salon a header change leaves behind: the period returns to the default week only when the
 * salon id really changes, so a reload of the same salon keeps the shown period.
 */
export function periodAfterSalonChange(
  prevSalonId: string | null,
  nextSalonId: string | null,
  current: SalonPeriod,
  todayStr: string,
): SalonPeriod {
  return prevSalonId === nextSalonId ? current : defaultSalonPeriod(todayStr);
}

// ── a cell ─────────────────────────────────────────────────────────────────────────────────────

export interface SalonCellChip {
  text: string;
  tone: "neutral" | "info";
}

export interface SalonCellDisplay {
  /** The cell text: H:MM, „–“ on a counted day without hours, empty on a day not counted yet. */
  text: string;
  /** The state chips of the cell: „abwesend“, „in <Salon>“, „anderer Salon“. */
  chips: SalonCellChip[];
  /** The accessible name of the cell. */
  label: string;
}

/** At most this many salon names are spelled out in an „in <Salon>“ chip; the rest is „+N“. */
export const MAX_ELSEWHERE_NAMES = 2;

/** „in Süd“, „in Süd, Ost“, „in Süd, Ost +1“. */
export function elsewhereChipText(names: readonly string[]): string {
  const shown = names.slice(0, MAX_ELSEWHERE_NAMES).join(", ");
  const more = names.length - MAX_ELSEWHERE_NAMES;
  return more > 0 ? `in ${shown} +${more}` : `in ${shown}`;
}

/** What one cell shows. `personName` only widens the accessible name. */
export function cellDisplay(cell: SalonHoursCell, personName = ""): SalonCellDisplay {
  const text = cell.minutes > 0 ? fmtMin(cell.minutes) : cell.counted ? "–" : "";
  const chips: SalonCellChip[] = [];
  if (cell.absent) chips.push({ text: "abwesend", tone: "info" });
  if (cell.elsewhere.length > 0) {
    chips.push({
      text: elsewhereChipText(cell.elsewhere.map((e) => e.salonName)),
      tone: "neutral",
    });
  }
  // Time outside the reach reads as a neutral mark: no hours, no name, no way to tell which salon.
  if (cell.elsewhereHidden) chips.push({ text: "anderer Salon", tone: "neutral" });

  const when = dayFullLabel(cell.date);
  const head = personName ? `${personName}, ${when}` : when;
  const what = cell.minutes > 0 ? `${fmtMin(cell.minutes)} im Salon` : "keine Stunden im Salon";
  const states = chips.map((chip) => chip.text);
  return { text, chips, label: [`${head}: ${what}`, ...states].join(", ") };
}
