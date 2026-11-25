// Issue #1085 — the ONE place that refuses an entry-first Zeitnachtrag on a day whose own open
// entry it would collide with, and names the right path instead of the generic overlap.
//
// An entry-first request (`POST /time-entries` + `reason`, outside the retro window) creates a NEW
// pending entry. A day that still has an OPEN own entry (started, never ended) cannot take it: the
// overlap rule treats the open entry as running to the end of its day. What the person means is the
// END of that entry, and that is a correction proposal (`POST /retro-entry-requests`), whose
// approval closes the open entry (Issue #1021, `selectRetroApplyTarget` → CORRECT). Before this
// guard the person got „Überschneidung mit bestehendem Eintrag vom … (08:30 – läuft)“ and no hint
// which request to file.
//
// The guard is exactly as wide as the overlap rule (`checkOverlap`, entry-overlap-error.ts):
//  - only the OPEN entry of the day (`openEntryOf`, day-entries.ts — a row that is itself a pending
//    Zeitnachtrag is no recorded entry and no correction target, `selectRetroApplyTarget` skips it);
//  - only when the new interval reaches into it (its end is after the open entry's start; an
//    interval without an end always does). An interval that ends before the open entry starts is
//    still a valid second interval and keeps the entry-first path;
//  - a closed entry keeps the generic overlap text — there the correction path has no target.
// It runs inside the creation transaction, after `lockEmployeeForEntryWrite()` and BEFORE
// `recheckOverlapInTx`, so it sees the committed rows of a racing writer and answers first.
//
// The text names no date, time or salon, so no reach decision (`overlapMessageForCaller`) is needed
// to word it; the caller of an entry-first request is always the person themself.
import type { Prisma } from "@clokr/db";
import { findEntriesOfDay, openEntryOf } from "./day-entries";

/** Control value of the refusal; the German text below is display only. */
export const OPEN_ENTRY_USE_CORRECTION_CODE = "OPEN_ENTRY_USE_CORRECTION";
export const OPEN_ENTRY_USE_CORRECTION_MESSAGE =
  "An diesem Tag läuft noch ein Eintrag ohne Ende. Lege dafür keinen neuen Eintrag an, sondern stelle einen Antrag auf Korrektur dieses Eintrags („Ausstempeln nachtragen“): Mit der Genehmigung wird er beendet.";

/** Thrown inside the creation transaction; the route maps it to 409. Never classified by message. */
export class OpenEntryUseCorrectionError extends Error {
  constructor() {
    super(OPEN_ENTRY_USE_CORRECTION_CODE);
    this.name = "OpenEntryUseCorrectionError";
  }
}

/**
 * Throws `OpenEntryUseCorrectionError` when the person has an open entry on `date` that a new
 * interval ending at `newEnd` reaches into (the open entry runs to the end of its day, so only the
 * new end matters). Call it under the employee row lock, inside the transaction.
 */
export async function assertNoOpenEntryToCorrect(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    employeeId: string;
    /** The stored `@db.Date` value of the target day (UTC midnight). */
    date: Date;
    newEnd: Date | null;
  },
): Promise<void> {
  const rows = await findEntriesOfDay(tx, {
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    date: params.date,
  });
  const open = openEntryOf(rows);
  if (!open) return;
  if (params.newEnd === null || open.startTime.getTime() < params.newEnd.getTime()) {
    throw new OpenEntryUseCorrectionError();
  }
}
