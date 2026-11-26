/**
 * Issue #992 (D-992-16) — the date wording of the Ich and Team areas: day and month without a
 * leading zero ("1.12.", "1.12.2026"), with the weekday on request ("Di 1.12.2026"), a range as
 * "1.12.–2.12.2026" and a single day as one date. The glossary row "Datum (Ich und Team)" names it.
 *
 * Pure string work on the calendar day: the weekday comes from the day at noon UTC, never from
 * `getDay()` of a local midnight, so the zone of the browser cannot move it.
 */

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

export interface DayLabelOptions {
  /** Append the year ("1.12.2026"). */
  year?: boolean;
  /** Prefix the weekday ("Di 1.12."). */
  weekday?: boolean;
}

interface Parts {
  y: number;
  m: number;
  d: number;
}

function parts(iso: string): Parts | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!hit) return null;
  return { y: Number(hit[1]), m: Number(hit[2]), d: Number(hit[3]) };
}

/** One day: "1.12.", "1.12.2026", "Di 1.12.2026". An unparsable string comes back unchanged. */
export function dayLabel(iso: string, options: DayLabelOptions = {}): string {
  const p = parts(iso);
  if (!p) return iso;
  const date = `${p.d}.${p.m}.${options.year ? p.y : ""}`;
  if (!options.weekday) return date;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).getUTCDay();
  return `${WEEKDAYS[dow]} ${date}`;
}

/**
 * A range of days: "1.12.–2.12.2026". The year is printed once when both ends share it, on both
 * ends when the range crosses a year. A one-day range is that one date.
 */
export function dayRangeLabel(
  fromIso: string,
  toIso: string,
  options: { year?: boolean } = {},
): string {
  const a = parts(fromIso);
  const b = parts(toIso);
  if (!a || !b) return `${fromIso}–${toIso}`;
  if (fromIso.slice(0, 10) === toIso.slice(0, 10)) return dayLabel(fromIso, options);
  if (options.year && a.y !== b.y) {
    return `${dayLabel(fromIso, { year: true })}–${dayLabel(toIso, { year: true })}`;
  }
  return `${dayLabel(fromIso)}–${dayLabel(toIso, options)}`;
}
