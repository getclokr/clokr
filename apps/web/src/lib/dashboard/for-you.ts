/**
 * Issue #1028 - the ONE place Mein Tag derives the rows of „Für dich“.
 *
 * Moved out of the page so it is unit-testable. Nothing is computed here that a server did not decide:
 * the break days, the missing days and the invalid entries come from `GET /dashboard/open-items`, the
 * karenz summary from its own reader. This module only orders them into rows with their texts and links.
 *
 * Issue #1028 (P-07) replaces the #987 cap: EVERY missing day and EVERY day with an entry to fix is a row,
 * newest first, reachable through the pager of the list; the summary rows „N weitere Tage …“ are gone.
 * With the default page size of five, page 1 is exactly the five newest days #987 showed.
 */
import { breakNudgeHref, summarizeUnconfirmedBreakDays } from "$lib/breaks/break-nudge";
import {
  karenzNudgeHref,
  KARENZ_NUDGE_TOOLTIP,
  type KarenzNudgeSummary,
} from "$lib/leave/karenz-nudge";
import { invalidEntryRows, type InvalidEntryDay } from "$lib/dashboard/invalid-entry-rows";

export interface ForYouItem {
  key: string;
  title: string;
  subtitle?: string;
  chip: string;
  tone: "ok" | "warn" | "bad" | "info" | "brand" | "neutral";
  href: string;
  action: string;
  testId?: string;
  hint?: string;
}

/** The slice of the open-items answer the rows read. */
export interface ForYouOpenItems {
  missingDays: readonly string[];
  /** Issue #987: every missing day of the running month (the window list is a subset). */
  missingDaysInMonth?: readonly string[];
  pendingRequests: number;
  invalidEntries: number;
  /** Issue #1020: the day (and open flag) of each own invalid entry; absent on an older answer. */
  invalidEntryDays?: readonly InvalidEntryDay[];
}

export interface ForYouInput {
  /** The days with an unconfirmed break (the server's day check). */
  breakDays: Iterable<string>;
  openItems: ForYouOpenItems | null | undefined;
  karenz: KarenzNudgeSummary;
  /** „Mi 04.11.“ for a `YYYY-MM-DD` day. */
  dayShort: (iso: string) => string;
}

/** Distinct days, newest first. */
function newestFirst(days: Iterable<string>): string[] {
  return [...new Set(days)].sort().reverse();
}

export function forYouItems(input: ForYouInput): ForYouItem[] {
  const { openItems, dayShort } = input;
  const out: ForYouItem[] = [];

  // One row per break finding of the server's day check, each with its own day link.
  for (const d of [...input.breakDays].sort()) {
    out.push({
      key: `break-${d}`,
      title: `${dayShort(d)} ohne Pause`,
      subtitle: "Pause nachtragen oder Tag bestätigen.",
      chip: "Prüfen",
      tone: "warn",
      href: breakNudgeHref(summarizeUnconfirmedBreakDays([d])),
      action: "Öffnen",
      testId: out.length === 0 ? "dashboard-break-nudge" : undefined,
    });
  }

  // Issue #987: the server names the month's gaps; the window list only matters when the month list is
  // absent (an older answer), so the union keeps both without a second derivation.
  for (const missDate of newestFirst([
    ...(openItems?.missingDays ?? []),
    ...(openItems?.missingDaysInMonth ?? []),
  ])) {
    out.push({
      key: `miss-${missDate}`,
      title: `${dayShort(missDate)} ohne Zeiteintrag`,
      subtitle: "An diesem Arbeitstag fehlt deine Zeit.",
      chip: "Fehlt",
      tone: "bad",
      href: `/ich/zeiten?view=list&date=${missDate}`,
      action: "Nachtragen",
    });
  }

  out.push(...invalidEntryRows(openItems, dayShort)); // Issue #1020

  if (input.karenz.count > 0) {
    out.push({
      key: "karenz",
      title: input.karenz.label,
      subtitle: KARENZ_NUDGE_TOOLTIP,
      chip: "Info",
      tone: "info",
      href: karenzNudgeHref(input.karenz),
      action: "Öffnen",
      testId: "dashboard-karenz-nudge",
    });
  }

  if ((openItems?.pendingRequests ?? 0) > 0) {
    const n = openItems!.pendingRequests;
    out.push({
      key: "pending",
      title: n === 1 ? "Dein Antrag wartet" : `${n} Anträge warten`,
      subtitle: "Du bekommst Bescheid, sobald entschieden ist.",
      chip: "Offen",
      tone: "neutral",
      href: "/ich/abwesenheiten?tab=antraege",
      action: "Ansehen",
    });
  }

  return out;
}
