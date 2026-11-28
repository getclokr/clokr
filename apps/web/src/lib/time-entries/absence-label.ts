/**
 * Issue #528 — the German label of an absence in the time-entries calendars (own and team).
 *
 * It reads the ONE mapping the absence pages use (`LEAVE_TYPES`), so a calendar cell, its tooltip,
 * the day sheet and the phone row name an absence exactly like the request list does. A code the
 * catalogue does not know never reaches the screen as an enum value: it reads
 * `OTHER_ABSENCE_LABEL`, the same words the calendar legend uses for it.
 */
import { LEAVE_TYPES } from "$lib/leave/team-calendar-visibility";

/** The word for an absence code without a catalogue entry (cell label and legend entry). */
export const OTHER_ABSENCE_LABEL = "Sonstige Abwesenheit";

/** The display label of an absence code; display only, never a control value. */
export function calendarAbsenceLabel(code: string): string {
  return LEAVE_TYPES.find((t) => t.code === code)?.label ?? OTHER_ABSENCE_LABEL;
}
