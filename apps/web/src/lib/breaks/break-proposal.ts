/**
 * Issue #1020 — the ONE place the two Zeiten edit forms propose a new or converted break slot.
 *
 * The start is the tenant's `defaultBreakStart` (TenantConfig, served by `GET /settings/work`) and
 * the slot is kept inside the entry. It is a convenience position the person edits, not a finding:
 * whether the break satisfies § 4 ArbZG is decided only by the server kernel (`evaluateDayBreaks`,
 * the preview and the day checks, Issue #511/#525), so this module reads no threshold and chooses
 * no length — the caller passes the length.
 */

/** Used only when the tenant value is unknown or not a valid `HH:MM`. */
export const FALLBACK_BREAK_START = "12:00";

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/** Strict `HH:MM` (00-23 / 00-59) to minutes of the day, else `null`. */
function toMinutes(time: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function proposeBreakSlot(input: {
  defaultBreakStart: string | null | undefined;
  entryStart: string | null | undefined;
  entryEnd: string | null | undefined;
  /** The length of the slot in minutes, chosen by the caller. */
  minutes: number;
}): { start: string; end: string } {
  const lengthMin = Math.max(1, Math.round(input.minutes));
  const fromMin = toMinutes(input.entryStart);
  const rawEnd = toMinutes(input.entryEnd);
  // An end at or before the start is an overnight entry: no end bound applies.
  const toMin = rawEnd !== null && (fromMin === null || rawEnd > fromMin) ? rawEnd : null;

  let proposedMin = toMinutes(input.defaultBreakStart) ?? toMinutes(FALLBACK_BREAK_START)!;
  if (toMin !== null) proposedMin = Math.min(proposedMin, toMin - lengthMin);
  if (fromMin !== null) proposedMin = Math.max(proposedMin, fromMin);
  proposedMin = Math.max(0, Math.min(proposedMin, LAST_MINUTE_OF_DAY));

  let endMin = Math.min(proposedMin + lengthMin, LAST_MINUTE_OF_DAY);
  if (toMin !== null) endMin = Math.min(endMin, toMin);
  return { start: toTime(proposedMin), end: toTime(endMin) };
}
