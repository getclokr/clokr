// Phase 76.2 (ARCH-V19-01) — Pure state machine for clock event resolution.
// No DB, no I/O — fully unit-testable. Resolver wires this to transactions.
import type {
  ClockState,
  ClockIntent,
  ClockDecision,
  BreakAction,
  BreakDecision,
  BreakEntryState,
} from "./types";

export function decide(
  state: ClockState,
  intent: ClockIntent,
  source: string,
  presenceOnly = false,
): ClockDecision {
  // AUTO — toggle semantics (NFC tap, WIFI connected event)
  if (intent === "AUTO") {
    if (state.kind === "NO_OPEN_ENTRY") return { kind: "START" };
    // D-01: closed same-day entry → reopen instead of creating a 2nd row
    if (state.kind === "CLOSED_SAME_DAY_ENTRY") return { kind: "REOPEN", entryId: state.entryId };
    // Issue #818: a card tap is a human act and closes the open entry whatever trigger opened it
    // (phone, web, terminal). Only a PASSIVE presence signal, flagged by its adapter through
    // `presenceOnly`, confirms an entry another source already opened (CONTEXT.md D-02, WIFI
    // re-detecting a running presence); the same source still toggles. The rule reads the flag,
    // never a source name, so a new trigger stays one adapter file.
    return presenceOnly && state.source !== source
      ? { kind: "CONFIRM", entryId: state.entryId }
      : { kind: "STOP", entryId: state.entryId };
  }
  // IN — explicit clock-in (web/mobile /clock-in route)
  if (intent === "IN") {
    if (state.kind === "NO_OPEN_ENTRY") return { kind: "START" };
    // D-01: closed same-day entry → reopen instead of creating a 2nd row
    if (state.kind === "CLOSED_SAME_DAY_ENTRY") return { kind: "REOPEN", entryId: state.entryId };
    return { kind: "CONFLICT", reason: "ALREADY_CLOCKED_IN" };
  }
  // OUT — only an OPEN_ENTRY can be stopped; closed same-day or none → NOT_CLOCKED_IN (Pitfall 4)
  return state.kind === "OPEN_ENTRY"
    ? { kind: "STOP", entryId: state.entryId }
    : { kind: "CONFLICT", reason: "NOT_CLOCKED_IN" };
}

/**
 * Issue #596 (#845): the break decision of an OPEN entry. Only a running entry has a break state;
 * a closed entry answers NOT_CLOCKED_IN, a locked one MONTH_LOCKED. Starting twice or ending a break
 * that does not run is a conflict, never a silent no-op, so two devices cannot disagree unseen.
 */
export function decideBreak(entry: BreakEntryState, action: BreakAction): BreakDecision {
  if (entry.endTime !== null) return { kind: "CONFLICT", reason: "NOT_CLOCKED_IN" };
  if (entry.isLocked) return { kind: "CONFLICT", reason: "MONTH_LOCKED" };
  if (action === "START") {
    return entry.breakStartedAt === null
      ? { kind: "BREAK_START" }
      : { kind: "CONFLICT", reason: "ALREADY_ON_BREAK" };
  }
  return entry.breakStartedAt !== null
    ? { kind: "BREAK_END", startedAt: entry.breakStartedAt }
    : { kind: "CONFLICT", reason: "NOT_ON_BREAK" };
}

/**
 * Issue #959 — the ONE rule whether an entry left open on the PREVIOUS calendar day is still the
 * running clock session (Phase 376: a shift across local midnight). It is, while the time since its
 * start is at most the tenant's `autoDeleteOpenHours` (the same bound after which
 * `attendance-checker.ts` invalidates an open entry as a missing clock-out); `0` or a missing value
 * falls back to the fixed cap `fallbackHours`, never to "forever".
 *
 * Inside the bound the person IS clocked in: every trigger acts on that entry (AUTO and OUT stop it,
 * IN answers ALREADY_CLOCKED_IN) and Mein Tag shows it as running. Beyond the bound the entry is a
 * forgotten clock-out: it blocks nothing, a clock event starts or re-opens an entry of its own day,
 * and the old entry stays open for its correction (its end is never fabricated). Pure: the resolver
 * and the own clock-state read (`open-entry.ts`) both decide through it.
 */
export function crossDaySessionRuns(
  startTime: Date,
  at: Date,
  autoDeleteOpenHours: number | null | undefined,
  fallbackHours: number,
): boolean {
  const boundHours = autoDeleteOpenHours || fallbackHours;
  return at.getTime() - startTime.getTime() <= boundHours * 3600_000;
}
