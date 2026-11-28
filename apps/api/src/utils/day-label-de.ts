/**
 * Issue #1117 — the one German day label of API notification texts.
 *
 * Notification texts name a day the way the glossary row "Datum (Ich und Team)" (Issue #992,
 * D-992-16) binds: day and month without a leading zero ("1.12.2026"), a range as "1.12.–2.12.2026"
 * (the year once when both ends share it, on both ends across New Year), a one-day range as one
 * date, an en dash without spaces. This mirrors `dayLabel` / `dayRangeLabel` (with `year: true`) of
 * `apps/web/src/lib/utils/day-label.ts`.
 *
 * Issue #1149: this is the ONLY formatter of a calendar day in a human-facing API text (a
 * notification, an error, a PDF). Machine formats (CSV, DATEV) keep their required form.
 *
 * Pure and never-throwing: it runs in post-commit notification paths, where a failing label must
 * not fail a request that already committed. A string that is not exactly YYYY-MM-DD comes back
 * unchanged.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Parts {
  y: number;
  m: number;
  d: number;
}

/**
 * A `Date` is read with UTC accessors because callers pass `@db.Date` values (UTC midnight). A
 * local formatter shifts the day on a host west of UTC (the WR-09 reason). An instant must be
 * passed as the tenant-local day string instead.
 */
function toDayString(day: string | Date): string {
  if (typeof day === "string") return day;
  if (Number.isNaN(day.getTime())) return String(day);
  return day.toISOString().slice(0, 10);
}

function parts(day: string): Parts | null {
  const hit = DAY.exec(day);
  if (!hit) return null;
  return { y: Number(hit[1]), m: Number(hit[2]), d: Number(hit[3]) };
}

/**
 * `year: false` drops the year ("1.12.", "1.12.–2.12."), for the short lists where the year is
 * clear from the context (the activity feed, Issue #1149) — the same option as the web `dayLabel`.
 * The default prints the year.
 */
export interface DayLabelOptions {
  year?: boolean;
}

/** One day: "1.12.2026" ("1.12." with `year: false`). An unparsable string comes back unchanged. */
export function dayLabelDe(day: string | Date, options: DayLabelOptions = {}): string {
  const text = toDayString(day);
  const p = parts(text);
  if (!p) return text;
  return options.year === false ? `${p.d}.${p.m}.` : `${p.d}.${p.m}.${p.y}`;
}

/**
 * A range of days: "1.12.–2.12.2026". The year is printed once when both ends share it, on both
 * ends when the range crosses a year. A one-day range is that one date. With `year: false` no year
 * is printed at all.
 */
export function dayRangeLabelDe(
  from: string | Date,
  to: string | Date,
  options: DayLabelOptions = {},
): string {
  const fromText = toDayString(from);
  const toText = toDayString(to);
  const a = parts(fromText);
  const b = parts(toText);
  if (!a || !b) return `${fromText}–${toText}`;
  if (fromText === toText) return dayLabelDe(fromText, options);
  if (options.year === false) return `${a.d}.${a.m}.–${b.d}.${b.m}.`;
  if (a.y !== b.y) return `${dayLabelDe(fromText)}–${dayLabelDe(toText)}`;
  return `${a.d}.${a.m}.–${b.d}.${b.m}.${b.y}`;
}
