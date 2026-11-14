/**
 * Issue #959 — the open entry the own clock acts on, as the SERVER decides it.
 *
 * The clock resolver acts on today's open entry or, when today has none, on yesterday's open entry
 * while it is still a session across midnight (bounded by the tenant's `autoDeleteOpenHours`,
 * `findClockOpenEntry` / `crossDaySessionRuns` in the API). Mein Tag cannot know that bound, so it
 * does not mirror the rule: it reads the answer of `GET /api/v1/time-entries/clock-state` and adds a
 * cross-day session to today's rows before `resolveDayState()` runs. The stage then shows that
 * entry as running with „Ausstempeln“, exactly where the clock answers „bereits eingestempelt“.
 * Beyond the bound the answer is empty, the stage stays idle and Einstempeln starts a new entry.
 *
 * Any failure resolves to `null` (unknown): the stage then behaves exactly as before #959 and the
 * hint of #942 promises nothing for yesterday's entry.
 */
import { api, ApiError } from "$api/client";
import { clientLogger } from "$lib/utils/logger";
import { isPendingNachtragRow, type ClockDayEntry } from "./day-state";

/** The body of GET /api/v1/time-entries/clock-state. */
export interface ClockStateAnswer {
  /** The open entry the next clock event acts on; `null` = the next clock-in starts or re-opens one of today. */
  entry: ClockDayEntry | null;
  /** True when `entry` belongs to the previous day (a session across midnight). */
  crossDay: boolean;
}

export async function loadClockState(): Promise<ClockStateAnswer | null> {
  try {
    return await api.get<ClockStateAnswer>("/time-entries/clock-state");
  } catch (err) {
    const status = err instanceof ApiError ? err.status : null;
    if (status !== 401 && status !== 403) {
      clientLogger.warn("Clock state could not be loaded", { status });
    }
    return null;
  }
}

/** The cross-day session of the answer, or `null` (none, or the answer is unknown). */
export function crossDaySession(state: ClockStateAnswer | null | undefined): ClockDayEntry | null {
  return state?.crossDay && state.entry ? state.entry : null;
}

/**
 * The rows the stage's clock state is derived from: today's rows, plus the cross-day session the
 * server named. Today's own open row always wins (the server never names a cross-day session then),
 * and a row already in the list is never added twice.
 */
export function clockRows(
  todayEntries: readonly ClockDayEntry[],
  state: ClockStateAnswer | null | undefined,
): ClockDayEntry[] {
  const session = crossDaySession(state);
  if (!session || todayEntries.some((e) => e.id === session.id)) return [...todayEntries];
  const runningToday = (e: ClockDayEntry) =>
    (e.endTime === null || e.endTime === undefined) && !isPendingNachtragRow(e);
  if (todayEntries.some(runningToday)) {
    return [...todayEntries];
  }
  return [session, ...todayEntries];
}

function localHm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** „gestern, 20:00“ — the start of a cross-day session for the stage's „seit“. */
export function crossDaySinceLabel(session: Pick<ClockDayEntry, "startTime">): string {
  return `gestern, ${localHm(session.startTime)}`;
}

/**
 * The note below the stage while a cross-day session runs: it names the start and what the two
 * ways out do. „Ausstempeln“ ends the entry NOW (the stage button, the resolver's STOP); a forgotten
 * clock-out is corrected through the unchanged edit flow of Zeiten (`endEntryHref`, #942).
 */
export function crossDaySessionText(session: Pick<ClockDayEntry, "startTime">): {
  title: string;
  detail: string;
} {
  return {
    title: `Du bist seit ${crossDaySinceLabel(session)} Uhr eingestempelt.`,
    detail:
      "Ausstempeln beendet diesen Eintrag jetzt. Hast du gestern vergessen auszustempeln, trag das richtige Ende ein.",
  };
}
