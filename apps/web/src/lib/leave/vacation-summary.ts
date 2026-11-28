// Phase 114 (Issue #117) — the SINGLE source of every Urlaubs-Größe that
// `apps/web/src/routes/(app)/leave/+page.svelte` displays: the six numbers of the
// „Urlaubsjahr"-Leiste (Anspruch, Übertrag Vorjahr, Genommen, Beantragt, Übertrag-Rest,
// Verbleibend) plus the two the Urlaubskonto-Karte shows (its value and the total in its
// breakdown line).
//
// Pure and dependency-free (no `$api`, `$stores`, `svelte` or component import), same
// convention as its sibling `vacation-balance.ts`, so it is unit-testable without mounting a
// route page — which matters here because NO test in `apps/web` mounts one, and acceptance
// criterion RU-05 demands a test that pins these numbers.
//
// (a) These formulas are the single source. Before Phase 114 they were eight inline `$derived`
//     expressions scattered across a 2730-line route component; "Resturlaub" could therefore
//     mean three different things on one screen without anything noticing. Do not re-inline them.
//
// (b) THE ARITHMETIC IS A VERBATIM COPY of those pre-Phase-114 expressions and must never be
//     "improved". Phase 114 is explicitly a labelling fix: „Die Zahlen sind nachweislich
//     korrekt — dies ist ausdrücklich **kein** Rechenfehler" (114-CONTEXT.md, Umfangsgrenze).
//     `__tests__/vacation-summary.test.ts` re-implements the old formulas literally and asserts
//     this function deep-equals them over a table of cases. If you change a formula here, that
//     oracle is what will stop you — do not adjust the oracle to match.
//
// (c) `free`, `remainingBeforePending` and `availableTotal` are `number | null` ON PURPOSE.
//     `free === null` is what makes the Urlaubskonto card render the en-dash placeholder instead
//     of a fake „0", and `availableTotal === null` is what makes it omit its breakdown line
//     entirely for an employee who has no vacation entitlement row at all. Normalising either to
//     0 would change what the user sees and would break RU-05.
//
// (d) Issue #1109 (owner decision 28.11.2026): „Resturlaub“ is ONE number on every own-vacation
//     screen (Ich › Abwesenheiten, Mein Tag, Ich › Konto, the request dialog) — the days still
//     free after the pending requests, `free`. It is the server's `freeDays` (the Resturlaub
//     facade, #451), carried by `mapVacationBalance`; this module and its callers never subtract
//     the pending days themselves. `remainingBeforePending` is the figure before them and is for
//     the decision facts of an approver only (the request being decided is itself pending there).

import type { VacationBalance } from "./vacation-balance";
import { formatDays } from "./review-facts";
import { countNoun } from "../utils/count-word";
import { isEffectiveLeaveStatus } from "./effective-leave-statuses";

export interface VacationSummary {
  /** Jahresanspruch. */
  total: number;
  /** Übertrag aus dem Vorjahr (brutto). */
  carryOver: number;
  /** Genommen — includes provisional days at full value (Phase 107 D-13). */
  used: number;
  /** Beantragt (PENDING), the facade's `pendingDays` of the viewed year. */
  planned: number;
  /** Ungenutzter Rest des Vorjahresübertrags. Clamped at 0. */
  carryOverRemaining: number;
  /**
   * Resturlaub (Issue #1109): the days still free after Genommen AND Beantragt — the server's
   * `freeDays`, NOT clamped (may be negative). `null` when no balance.
   */
  free: number | null;
  /**
   * The balance BEFORE the pending requests (`total + carryOver - used`). Not „Resturlaub“: it
   * is read only where the pending request is itself the subject (an approver's decision facts).
   * `null` when no balance.
   */
  remainingBeforePending: number | null;
  /** Anspruch + Übertrag. `null` when no balance. */
  availableTotal: number | null;
}

/**
 * Derives every Urlaubs-Größe the `/leave` page renders from the mapped balance. The pending days
 * and the free days arrive with the balance (`mapVacationBalance`, from the Resturlaub facade) —
 * nothing here is read from a second list or subtracted a second time.
 */
export function deriveVacationSummary(balance: VacationBalance | null): VacationSummary {
  const total = balance?.total ?? 0;
  const carryOver = balance?.carryOver ?? 0;
  const used = balance?.used ?? 0;
  const planned = balance?.pending ?? 0;
  const carryOverRemaining = Math.max(0, carryOver - used);
  // Issue #1109: the server's answer, passed through. The `null` branch is load-bearing, see (c) above.
  const free = balance ? balance.free : null;
  const remainingBeforePending = balance ? balance.total + balance.carryOver - balance.used : null;
  // Verbatim from the card's `delta` prop at `:1146-1147`, which interpolated
  // `${vacationBalance.total + vacationBalance.carryOver}` and rendered nothing without a balance.
  const availableTotal = balance ? balance.total + balance.carryOver : null;

  return {
    total,
    carryOver,
    used,
    planned,
    carryOverRemaining,
    free,
    remainingBeforePending,
    availableTotal,
  };
}

// ── Urlaubskonto-Karte: deutsche Beschriftung ──────────────────────────────────────────────
// The copy lives here, not in the template: a string in a `.svelte` template cannot be
// unit-tested (`tsc --noEmit` does not typecheck templates) and drifts. Same precedent as
// Phase 113's `karenz-nudge.ts`. Both functions are pinned by exact-string assertions.

/** Label of the one big figure. `Resturlaub` means EXACTLY ONE thing on every own-vacation screen:
 *  the days still free after the pending requests (`VacationSummary.free`, Issue #1109) — never the
 *  Vorjahresübertrag, and never a figure that leaves the pending days out. The label is a constant
 *  on purpose: the number is the same with and without pending requests, so no qualifier
 *  („ohne beantragte“, retired in #1109, forbidden by lint:ui-terms) is needed. */
export const VAC_CARD_LABEL = "Resturlaub";

/** The line under the big figure, „davon 2 Tage beantragt“ (owner decision 28.11.2026, Issue #1109):
 *  names the pending days the figure already subtracted. `null` without pending days — nothing to
 *  say. Mein Tag and Ich › Konto word it the same way. */
export function vacationPendingLine(planned: number): string | null {
  if (!(planned > 0)) return null;
  return `davon ${formatDays(planned)} ${countNoun(planned, "Tag", "Tage")} beantragt`;
}

/** Replaces the pre-Phase-114 `von ${total + carryOver} verfügbar` line. Two changes, both
 *  required by the acceptance criteria: `verfügbar` → `gesamt` (the word `verfügbar` now
 *  belongs to nothing on this page — the balance is `Resturlaub`), and the sum is broken
 *  down so `Genommen 31 bei Anspruch 24` resolves without arithmetic. No year is
 *  interpolated: `loadVacationSummary()` always fetches the CURRENT year regardless of the
 *  viewed `calYear`, so a year in this string would be a false statement. */
export function vacationCardDelta(total: number, carryOver: number): string {
  if (carryOver > 0) {
    return `von ${formatDays(total + carryOver)} gesamt (${formatDays(total)} Anspruch + ${formatDays(carryOver)} Übertrag Vorjahr)`;
  }
  return `von ${formatDays(total)} gesamt`;
}

// ── „Genommen & genehmigt“: the one hint line (Issue #991 N-18, D-991-18) ───────────────────────

/** The part of an own request the hint reads; the page's rows satisfy it. */
export interface VacationHintRequest {
  typeCode: string | null;
  status: string;
  startDate: string;
  endDate: string;
}

function hintDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.`;
}

/** One date for a one-day range, „1.12.–2.12.“ otherwise (a request of one day reads „2.3.“). */
function hintRange(startDate: string, endDate: string): string {
  const start = hintDay(startDate);
  const end = hintDay(endDate);
  return start === end ? start : `${start}–${end}`;
}

/**
 * The line under „Genommen & genehmigt“. An effective vacation ahead wins („nächster: 1.12.–2.12.“);
 * without one, a waiting vacation request is named, so the card never says „kein Urlaub geplant“
 * while a request is being decided; otherwise „kein Urlaub geplant“. `today` is the tenant-local day
 * (`YYYY-MM-DD`); a request starting today counts as ahead. Only VACATION is read.
 */
export function vacationTakenHint(requests: readonly VacationHintRequest[], today: string): string {
  const ahead = requests
    .filter((r) => r.typeCode === "VACATION" && r.startDate.slice(0, 10) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const next = ahead.find((r) => isEffectiveLeaveStatus(r.status));
  if (next) return `nächster: ${hintRange(next.startDate, next.endDate)}`;
  const waiting = ahead.find((r) => r.status === "PENDING");
  if (waiting) {
    return `beantragt: ${hintRange(waiting.startDate, waiting.endDate)}, wartet auf Entscheidung`;
  }
  return "kein Urlaub geplant";
}
