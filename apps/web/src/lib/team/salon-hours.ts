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
  /** A missing clock-out of this salon on that day (an open WORK entry before today). */
  open: boolean;
}

/** A missing clock-out of this salon: the person, the day and the tenant-local start time. */
export interface SalonHoursOpenItem {
  employeeId: string;
  employeeName: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Tenant-local `HH:MM`. */
  startTime: string;
}

export interface SalonHoursExchangePerson {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  minutes: number;
}

/** The hours exchanged with ONE other salon (or with no Stammsalon: `salonId` null). */
export interface SalonHoursExchangeGroup {
  salonId: string | null;
  salonName: string | null;
  persons: number;
  minutes: number;
  people: SalonHoursExchangePerson[];
}

export interface SalonHoursExchange {
  /** The Aushilfen of this salon by their Stammsalon. */
  fromOtherSalons: SalonHoursExchangeGroup[];
  /** The Stammteam's hours in other salons by the salon of the entry. */
  ownTeamElsewhere: SalonHoursExchangeGroup[];
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
  kpis: {
    salonWorkedMinutes: number;
    stammteamMinutes: number;
    aushilfenMinutes: number;
    openCount: number;
  };
  stammteam: SalonHoursBlock;
  aushilfen: SalonHoursHelperBlock;
  /** The missing clock-outs of this salon in the window. */
  open: SalonHoursOpenItem[];
  exchange: SalonHoursExchange;
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

/** `GET /salon-hours/csv`: the exchange card of the very period the raster shows. */
export function salonHoursCsvPath(salonId: string, period: SalonPeriod): string {
  return salonHoursRequestPath(salonId, period).replace("/salon-hours?", "/salon-hours/csv?");
}

/** „Mo, 23.11. · seit 09:00“ - the second line of an open item. */
export function openItemSubtitle(item: SalonHoursOpenItem): string {
  const d = localNoon(item.date);
  return `${format(d, "EEEEEE", { locale: de })}, ${format(d, "dd.MM.")} · seit ${item.startTime}`;
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
  tone: "neutral" | "info" | "warn";
}

export interface SalonCellDisplay {
  /** The hours of the cell as H:MM; empty when the cell shows a chip or the muted dash. */
  text: string;
  /**
   * The state chips of the cell. A cell with hours shows them beneath the hours; a cell without
   * hours shows exactly ONE chip (the most important state), never a dash next to it.
   */
  chips: SalonCellChip[];
  /** True when the cell shows neither hours nor a chip: it renders one muted „–“. */
  nil: boolean;
  /** The accessible name of the cell; it names every state, also those the cell does not show. */
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

/**
 * What one cell shows - exactly ONE thing (Issue #1030, owner draft): hours (with their state chips
 * beneath), or one chip, or a muted dash. Days that are not counted yet read as the dash, too.
 * `personName` only widens the accessible name.
 */
export function cellDisplay(cell: SalonHoursCell, personName = ""): SalonCellDisplay {
  // In order of importance: a missing clock-out asks for action, absence explains the empty day,
  // another salon says where the person was, the hidden mark says only that it was somewhere else.
  const states: SalonCellChip[] = [];
  if (cell.open) states.push({ text: "offen", tone: "warn" });
  if (cell.absent) states.push({ text: "abwesend", tone: "info" });
  if (cell.elsewhere.length > 0) {
    states.push({
      text: elsewhereChipText(cell.elsewhere.map((e) => e.salonName)),
      tone: "neutral",
    });
  }
  // Time outside the reach reads as a neutral mark: no hours, no name, no way to tell which salon.
  if (cell.elsewhereHidden) states.push({ text: "anderer Salon", tone: "neutral" });

  const hasHours = cell.minutes > 0;
  const chips = hasHours || states.length === 0 ? states : [states[0]];

  const when = dayFullLabel(cell.date);
  const head = personName ? `${personName}, ${when}` : when;
  const what = hasHours ? `${fmtMin(cell.minutes)} im Salon` : "keine Stunden im Salon";
  return {
    text: hasHours ? fmtMin(cell.minutes) : "",
    chips,
    nil: !hasHours && chips.length === 0,
    label: [`${head}: ${what}`, ...states.map((chip) => chip.text)].join(", "),
  };
}

/** True when a row has a day with hours or a state: the card layout lists only such days. */
export function rowHasContent(cells: readonly SalonHoursCell[]): boolean {
  return cells.some((cell) => !cellDisplay(cell).nil);
}

/**
 * The one „Summe im Salon“ row sits under both groups of the raster, so each day shows the two
 * server totals of the groups added; nothing is recomputed from cells.
 */
export function combinedDayTotals(data: {
  stammteam: { dayTotals: number[] };
  aushilfen: { dayTotals: number[] };
}): number[] {
  return data.stammteam.dayTotals.map((minutes, i) => minutes + (data.aushilfen.dayTotals[i] ?? 0));
}
