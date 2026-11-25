/**
 * open-entry-correction.ts
 *
 * Issue #1085 — the own time page and a day that still has an OPEN entry (started, never ended).
 *
 * A person can only end such an entry; a second entry on that day is the wrong tool. Outside the
 * retro window the end is requested as a CORRECTION of that entry (`POST /retro-entry-requests`,
 * applied by its approval, Issue #1021), never as a new entry-first Zeitnachtrag
 * (`POST /time-entries` + reason), which the server refuses as an overlap with the open entry.
 *
 * This module is the ONE place the page decides
 *  - which open entry a proposed interval collides with (`openEntryClash`),
 *  - which request a Zeitnachtrag becomes (`retroSubmitPath`) and which open entry it is about
 *    (`retroOpenEntryTarget`),
 *  - what the dialog calls itself for an open entry (`openEntryDialogEyebrow`), and
 *  - the words around it (`OPEN_ENTRY_TEXTS`).
 *
 * Presentation only. The server decides validity, the overlap, the retro window and the month lock;
 * its own refusal of an entry-first request on such a day is the guard behind this (409
 * `OPEN_ENTRY_USE_CORRECTION`). Pure module, unit-testable without a mounted page.
 */
import { format } from "date-fns";
import { countWord } from "$lib/utils/count-word";
import { openEntryOfDay, type DayEntryRow } from "./day-entry-actions";

/**
 * The open entry of the day a proposed interval would collide with, or `null`. Mirrors the server's
 * overlap rule for an open entry (`checkOverlap`, `entry-overlap-error.ts`): an open entry runs to
 * the end of its day, so a new interval collides when it ends after the open entry's start; an
 * interval without an end always does. A locked row cannot be ended and never collides here.
 */
export function openEntryClash<T extends DayEntryRow>(
  dayEntries: readonly T[],
  proposedEnd: Date | null,
): T | null {
  const open = openEntryOfDay(dayEntries);
  if (!open) return null;
  if (proposedEnd === null) return open;
  return new Date(open.startTime).getTime() < proposedEnd.getTime() ? open : null;
}

export type RetroSubmitPath<T extends DayEntryRow> =
  /** `POST /retro-entry-requests`: a correction proposal; `target` is the open entry it ends, if any. */
  | { kind: "correction"; target: T | null }
  /** `POST /time-entries` with a reason: a new interval with no entry to correct. */
  | { kind: "entry-first" };

/**
 * Which request a Zeitnachtrag form files. An entry being edited is a correction (the unchanged
 * Phase 96 rule). A NEW form is an entry-first request EXCEPT when its interval collides with the
 * open entry of the day: that is the end of the open entry, filed as its correction (Issue #1085).
 */
export function retroSubmitPath<T extends DayEntryRow>(input: {
  editEntry: T | null;
  dayEntries: readonly T[];
  proposedEnd: Date | null;
}): RetroSubmitPath<T> {
  const target = retroOpenEntryTarget(input);
  if (input.editEntry !== null || target !== null) return { kind: "correction", target };
  return { kind: "entry-first" };
}

/**
 * The open entry a retro form is about: the entry being edited when it is still open, else the
 * open entry a NEW form collides with, else `null`. Drives the wording only.
 */
export function retroOpenEntryTarget<T extends DayEntryRow>(input: {
  editEntry: T | null;
  dayEntries: readonly T[];
  proposedEnd: Date | null;
}): T | null {
  if (input.editEntry) return input.editEntry.endTime === null ? input.editEntry : null;
  return openEntryClash(input.dayEntries, input.proposedEnd);
}

function dayOf(entry: Pick<DayEntryRow, "date" | "startTime">): string {
  return (entry.date ?? entry.startTime).split("T")[0];
}

/** An open entry of an EARLIER day: the forgotten clock-out („Ausstempeln fehlt“). */
export function isStaleOpenEntry(entry: DayEntryRow, todayStr: string): boolean {
  return entry.endTime === null && dayOf(entry) < todayStr;
}

/**
 * The eyebrow of the entry dialog: an open entry of an EARLIER day is the forgotten clock-out, so
 * the dialog says what the person does there. A running entry of today is just edited.
 */
export function openEntryDialogEyebrow(entry: DayEntryRow | null, todayStr: string): string {
  if (entry === null) return "Neuer Eintrag";
  return isStaleOpenEntry(entry, todayStr) ? OPEN_ENTRY_TEXTS.eyebrow : "Eintrag bearbeiten";
}

/**
 * The label of an action that opens the day's open entry: „Ausstempeln nachtragen“ for the
 * forgotten clock-out of an earlier day, „Ende eintragen“ (the label of the day panel) for the
 * entry that runs today.
 */
export function openEntryActionLabel(entry: DayEntryRow, todayStr: string): string {
  return isStaleOpenEntry(entry, todayStr) ? OPEN_ENTRY_TEXTS.eyebrow : "Ende eintragen";
}

/** The wording of the open-entry flow. German, „du“ (docs/glossar.md). */
export const OPEN_ENTRY_TEXTS = {
  eyebrow: "Ausstempeln nachtragen",
  /** The retro form's callout: the day lies outside the window and an entry still runs. */
  retroCallout(startHm: string, windowDays: number): string {
    return (
      `An diesem Tag läuft noch ein Eintrag (seit ${startHm}), und der Tag liegt außerhalb des ` +
      `Bearbeitungsfensters (${countWord(windowDays, "Tag", "Tage")}). Stelle einen Antrag, sein ` +
      `Ende nachzutragen – es entsteht kein zweiter Eintrag. Mit der Genehmigung wird der ` +
      `Eintrag beendet.`
    );
  },
  /** Under the end field of an open entry whose end is not yet switched on. */
  openHint: "Dieser Eintrag hat noch kein Ende. Hake „erfasst“ an und trage die Uhrzeit ein.",
  /** The Zeitnachtrag needs a proposed end; „erfasst“ is the end toggle of the form. */
  endRequired: "Bitte hake „Arbeitsende erfasst“ an und gib die Uhrzeit des Endes an.",
  /** A new form was switched to the open entry of its day (inside the window). */
  switchedToOpenEntry(startHm: string): string {
    return `An diesem Tag läuft noch ein Eintrag seit ${startHm}. Trage sein Ende ein – es entsteht kein zweiter Eintrag.`;
  },
} as const;

/** The local start time of an entry, `HH:mm` (the page shows times in the browser's zone). */
export function startHm(entry: Pick<DayEntryRow, "startTime">): string {
  return format(new Date(entry.startTime), "HH:mm");
}
