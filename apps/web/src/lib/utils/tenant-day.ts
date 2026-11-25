/**
 * The tenant's calendar day (Issue #1066).
 *
 * The server names "today" in the tenant's IANA zone (`todayInTz` / `dateStrInTz` in the API) and
 * files every clock stamp under that day. A browser says "today" in the DEVICE zone, which can be
 * another calendar day at night (a phone on UTC while the salon is in Europe/Berlin, a traveller).
 * The device clock still says WHEN now is; this module says which tenant day that instant is.
 *
 * The zone comes from the tenant settings (`$stores/tenant-features`). An empty or unknown zone
 * falls back to `DEFAULT_TIMEZONE`, the server's own default - never to the zone of the browser.
 *
 * Issue #1072: this is the ONLY module that turns an instant into a tenant calendar reading (day,
 * year, anchor). Two rules for callers:
 * - A first request whose URL carries a day, month or year derived from now awaits
 *   `tenantFeatures.loadTimezone()` before computing it (a child page's `onMount` runs before the
 *   layout's read settles).
 * - Render values, `$derived`s and event handlers read `$tenantFeatures.timezone` directly.
 *
 * A calendar ANCHOR (`dayAnchor`, `tenantDayAnchor`) is a Date at 12:00 device-local time whose
 * local fields (`getFullYear`, `getMonth`, `getDate`, `getDay`) are the tenant day. It exists for
 * date-fns month/week arithmetic and the local-accessor helpers; it is never sent or compared as
 * an instant. Noon, not midnight, because some zones skip local midnight on their DST day.
 */
import { DEFAULT_TIMEZONE } from "$lib/settings/allgemein";

const formatters = new Map<string, Intl.DateTimeFormat>();

function build(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One cached formatter per zone; an unknown zone name reads as the default zone. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const key = timeZone || DEFAULT_TIMEZONE;
  const cached = formatters.get(key);
  if (cached) return cached;
  let made: Intl.DateTimeFormat;
  try {
    made = build(key);
  } catch {
    // RangeError: not an IANA zone name
    return key === DEFAULT_TIMEZONE ? build("UTC") : formatterFor(DEFAULT_TIMEZONE);
  }
  formatters.set(key, made);
  return made;
}

function partsOf(now: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(now)) out[p.type] = p.value;
  return out;
}

/** The `YYYY-MM-DD` of `now` in the tenant's zone. */
export function tenantDay(now: Date, timeZone: string): string {
  const p = partsOf(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The `HH:mm` wall-clock time of `now` in the tenant's zone (24-hour, zero padded). */
export function tenantTimeOfDay(now: Date, timeZone: string): string {
  const p = partsOf(now, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** The calendar year of `now` in the tenant's zone. */
export function tenantYear(now: Date, timeZone: string): number {
  return Number(partsOf(now, timeZone).year);
}

/**
 * A calendar anchor for a `YYYY-MM-DD` day: a Date at 12:00 device-local time whose local fields
 * are that day. For calendar arithmetic only, never an instant.
 */
export function dayAnchor(isoDay: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The calendar anchor of the tenant day of `now` (see `dayAnchor`). */
export function tenantDayAnchor(now: Date, timeZone: string): Date {
  return dayAnchor(tenantDay(now, timeZone));
}
