// Issue #959 — the ONE answer to "which OPEN entry does the next clock event of this person act on".
//
// The resolver (every trigger: web, NFC, WLAN) and the own clock-state read of Mein Tag
// (`GET /time-entries/clock-state`) and the clock-salon answer (`clockSalonChoice`) all call this,
// so the stage can never show "not clocked in" while the clock answers "already clocked in".
//
// Rule: the open row of the event's own day (`openEntryOf`, Issue #70 — at most one per day);
// otherwise the open row of the PREVIOUS day while it is still a running session
// (`crossDaySessionRuns`, Phase 376 / Issue #959). Only one day is looked back: a session longer
// than the tenant bound is a forgotten clock-out, and no bound spans two midnights in practice.
import type { TimeEntry } from "@clokr/db";
import {
  findEntriesOfDay,
  openEntryOf,
  type DayEntriesDb,
} from "../../contexts/time-tracking/day-entries";
import { crossDaySessionRuns } from "./state-machine";
import { CROSS_DAY_OPEN_ENTRY_FALLBACK_HOURS } from "./thresholds";

export type ClockOpenEntry = {
  entry: TimeEntry;
  /** true when the entry belongs to the previous calendar day (a session across midnight). */
  crossDay: boolean;
};

export async function findClockOpenEntry(
  db: DayEntriesDb,
  params: {
    tenantId: string;
    employeeId: string;
    /** UTC midnight of the tenant-local day of the event, as stored in `TimeEntry.date`. */
    date: Date;
    /** The event instant. */
    at: Date;
    /** The rows of `date` when the caller already read them (the resolver does). */
    dayEntries?: TimeEntry[];
  },
): Promise<ClockOpenEntry | null> {
  const { tenantId, employeeId, date, at } = params;
  const dayEntries =
    params.dayEntries ?? (await findEntriesOfDay(db, { tenantId, employeeId, date }));
  const sameDay = openEntryOf(dayEntries);
  if (sameDay) return { entry: sameDay, crossDay: false };

  const previousDate = new Date(date);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const candidate = openEntryOf(
    await findEntriesOfDay(db, { tenantId, employeeId, date: previousDate }),
  );
  if (!candidate) return null;
  const tenantConfig = await db.tenantConfig.findUnique({
    where: { tenantId },
    select: { autoDeleteOpenHours: true },
  });
  return crossDaySessionRuns(
    candidate.startTime,
    at,
    tenantConfig?.autoDeleteOpenHours,
    CROSS_DAY_OPEN_ENTRY_FALLBACK_HOURS,
  )
    ? { entry: candidate, crossDay: true }
    : null;
}
