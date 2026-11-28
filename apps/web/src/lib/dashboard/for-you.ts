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
 *
 * Issue #604 adds one row per appointment hint (`appointmentHints`, the server's own answer of
 * `GET /appointment-hints`): newest day first, right after the break rows. A NO_ENTRY hint names the
 * same day as the generic `miss-<day>` row and replaces it (D-11); an AFTER_CLOCK_OUT hint is a
 * different finding and leaves a missing-day row of its day alone. The row links to the day without
 * any time (D-13) and carries the dismissal („Stimmt so“) the page wires to its button.
 */
import { breakNudgeHref, summarizeUnconfirmedBreakDays } from "$lib/breaks/break-nudge";
import {
  karenzNudgeHref,
  KARENZ_NUDGE_TOOLTIP,
  type KarenzNudgeSummary,
} from "$lib/leave/karenz-nudge";
import { invalidEntryRows, type InvalidEntryDay } from "$lib/dashboard/invalid-entry-rows";
import {
  APPOINTMENT_HINT_TOOLTIP,
  appointmentHintHref,
  appointmentHintTexts,
  type AppointmentHintKind,
  type OwnAppointmentHint,
} from "$lib/time-entries/appointment-hints"; // Issue #604

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
  /** Issue #604: set on an appointment hint row - the day and kind „Stimmt so“ answers. */
  dismiss?: { date: string; kind: AppointmentHintKind };
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
  /** „Mi 4.11.“ for a `YYYY-MM-DD` day. */
  dayShort: (iso: string) => string;
  /** Issue #604: the own appointment hints of `GET /appointment-hints` (absent while the switch is off). */
  appointmentHints?: readonly OwnAppointmentHint[];
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

  // Issue #604: one row per hint, newest first; a malformed day yields no row. The NO_ENTRY days
  // replace the generic missing row of the same day (D-11).
  const noEntryDays = new Set<string>();
  const hints = [...(input.appointmentHints ?? [])].sort((a, b) =>
    a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? 1 : -1,
  );
  for (const h of hints) {
    const href = appointmentHintHref(h.date);
    if (href === null) continue;
    if (h.kind === "NO_ENTRY") noEntryDays.add(h.date);
    const { title, subtitle } = appointmentHintTexts(h, dayShort(h.date));
    out.push({
      key: `termin-${h.date}-${h.kind}`,
      title,
      subtitle,
      chip: "Prüfen",
      tone: "warn",
      href,
      action: "Nachtragen",
      hint: APPOINTMENT_HINT_TOOLTIP,
      dismiss: { date: h.date, kind: h.kind },
    });
  }

  // Issue #987: the server names the month's gaps; the window list only matters when the month list is
  // absent (an older answer), so the union keeps both without a second derivation.
  for (const missDate of newestFirst([
    ...(openItems?.missingDays ?? []),
    ...(openItems?.missingDaysInMonth ?? []),
  ]).filter((d) => !noEntryDays.has(d))) {
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
