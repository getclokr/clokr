// Issue #854 (plan 854-12) - the pure half of the company shutdowns (Betriebsurlaub): the wire types, the
// checks the create form and the detail form share, and the date helpers of the list and the detail. No runes
// and no `$app` imports on purpose; `BetriebsurlaubPanel.svelte` and the detail sub-route own the state and the
// requests.
//
// The server stays the authority (the Zod schema of `/company-shutdowns`, the overlap refusal and the booking
// itself); the checks here only save a round trip.

import { dayLabel } from "$lib/utils/day-label";
import { SCOPE_TENANT_LABEL } from "$lib/roles/assignment-label";
import { countWord, personsLabel } from "../utils/count-word";

// Type aliases, not interfaces: DataTable rows must satisfy `Record<string, unknown>`.
export type ShutdownEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
};

export type ShutdownException = {
  id: string;
  employeeId: string;
  reason: string | null;
  employee: ShutdownEmployee;
};

/**
 * What a booking run of the API did (Issue #1069, D-21): counts only, no ids and no names. `POST` and `PATCH`
 * answer it as `booking`; the other answers carry none. Request counts (`vacation*`, `reversedRequests`) can
 * exceed the number of persons, because a person gets one request per run of free days; the closed-month count
 * can count a (person, month) twice when a change books again, so no text shows it as a number.
 */
export type ShutdownBooking = {
  persons: number;
  absencesWritten: number;
  vacationApproved: number;
  vacationPending: number;
  paidReleaseOnly: number;
  partlyPaidRelease: number;
  outsideCreateReach: number;
  skippedClosedMonths: number;
  existingLeavePersons: number;
  refused: Record<string, number>;
  reversedRequests: number;
  reversedAbsences: number;
};

/** A salon a Betriebsurlaub is limited to (Issue #1079); `isActive` false marks a since-deactivated salon. */
export type ShutdownSalon = { id: string; name: string; isActive: boolean };

/**
 * `GET /company-shutdowns/scope` (Issue #1079): what the caller may name. `canManageAllSalons` is the
 * whole-tenant reach (a Betriebsurlaub for the whole Unternehmen); `salons` are the active salons inside the reach.
 */
export type ShutdownScope = {
  canManageAllSalons: boolean;
  salons: Array<{ id: string; name: string }>;
};

export type CompanyShutdown = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  deductsFromVacation: boolean;
  notes: string | null;
  exceptions: ShutdownException[];
  /** Issue #1079: the named salons, empty = the whole Unternehmen. */
  salons: ShutdownSalon[];
  /** Issue #1079: whether the caller's reach covers every salon of this row (false = read-only). */
  canManage: boolean;
  /** Only in the answer of `POST` and `PATCH`. */
  booking?: ShutdownBooking;
};

/** How long a booking summary stays on screen: it is read, not just acknowledged. */
export const BOOKING_TOAST_MS = 9000;

const requestsLabel = (n: number) => countWord(n, "Urlaubsantrag", "Urlaubsanträge");

/**
 * The toast text after a save: what was booked, in German, du-form. Each clause appears only when its count is
 * above 0. Closed months get a sentence without a number (see `ShutdownBooking`). `lead` is the first sentence,
 * e.g. „Betriebsurlaub angelegt.“.
 */
export function bookingSummaryText(booking: ShutdownBooking, lead: string): string {
  const parts: string[] = [lead];
  const refusedByCore = Object.entries(booking.refused)
    .filter(([reason]) => !reason.startsWith("APPROVAL_"))
    .reduce((sum, [, n]) => sum + n, 0);

  if (booking.persons === 0 && booking.reversedRequests === 0 && booking.reversedAbsences === 0) {
    parts.push("Niemand ist betroffen.");
  }
  if (booking.reversedRequests > 0) {
    parts.push(
      `${requestsLabel(booking.reversedRequests)} storniert, der Urlaub ist zurückgebucht.`,
    );
  }
  if (booking.vacationApproved > 0) {
    parts.push(
      `${requestsLabel(booking.vacationApproved)} genehmigt und vom Urlaubskonto abgezogen.`,
    );
  }
  if (booking.vacationPending > 0) {
    parts.push(
      booking.vacationPending === 1
        ? "1 Urlaubsantrag wartet unter Aufgaben auf Genehmigung."
        : `${booking.vacationPending} Urlaubsanträge warten unter Aufgaben auf Genehmigung.`,
    );
  }
  if (booking.persons > 0 && booking.paidReleaseOnly === booking.persons) {
    parts.push("Alle Tage gelten als bezahlte Freistellung.");
  } else if (booking.paidReleaseOnly > 0) {
    parts.push(
      `Für ${personsLabel(booking.paidReleaseOnly)} gelten alle Tage als bezahlte Freistellung.`,
    );
  }
  if (booking.partlyPaidRelease > 0) {
    parts.push(
      `${personsLabel(booking.partlyPaidRelease)} ${booking.partlyPaidRelease === 1 ? "hat" : "haben"} zu wenig Resturlaub, die fehlenden Tage gelten als bezahlte Freistellung.`,
    );
  }
  if (booking.outsideCreateReach > 0) {
    parts.push(
      "Für Personen außerhalb deiner Zuständigkeit wurde kein Urlaubsantrag angelegt, ihre Tage gelten als bezahlte Freistellung.",
    );
  }
  if (refusedByCore > 0) {
    parts.push(
      "Nicht alle Urlaubsanträge konnten gebucht werden, die übrigen Tage gelten als bezahlte Freistellung.",
    );
  }
  if (booking.existingLeavePersons > 0) {
    parts.push(
      `Bei ${personsLabel(booking.existingLeavePersons)} stehen in dieser Zeit schon Anträge oder gearbeitete Tage, sie bleiben unverändert.`,
    );
  }
  if (booking.skippedClosedMonths > 0) {
    parts.push("Abgeschlossene Monate bleiben unverändert.");
  }
  return parts.join(" ");
}

/** The toast after a save: the summary when the API answered one, else the plain `lead`. */
export function bookingToast(shutdown: Pick<CompanyShutdown, "booking">, lead: string) {
  return shutdown.booking
    ? { message: bookingSummaryText(shutdown.booking, lead), duration: BOOKING_TOAST_MS }
    : { message: lead, duration: undefined };
}

export type ShutdownForm = {
  name: string;
  startDate: string;
  endDate: string;
};

/** The longest name the API accepts. */
export const SHUTDOWN_NAME_MAX = 100;

/** The first problem of the form, or null. Dates are `YYYY-MM-DD`, which compare as text. */
export function shutdownFormMessage(form: ShutdownForm): string | null {
  if (!form.name.trim() || !form.startDate || !form.endDate)
    return "Bezeichnung, Start- und Enddatum sind Pflichtfelder.";
  if (form.startDate > form.endDate) return "Das Startdatum muss vor dem Enddatum liegen.";
  return null;
}

/** The message of each field of the detail form, "" for a valid one. The API limits the name to 100 characters. */
export function shutdownFieldMessages(form: ShutdownForm): Record<keyof ShutdownForm, string> {
  return {
    name: !form.name.trim()
      ? "Gib eine Bezeichnung an."
      : form.name.trim().length > SHUTDOWN_NAME_MAX
        ? `Die Bezeichnung darf höchstens ${SHUTDOWN_NAME_MAX} Zeichen lang sein.`
        : "",
    startDate: form.startDate ? "" : "Gib das Startdatum an.",
    endDate: !form.endDate
      ? "Gib das Enddatum an."
      : form.startDate && form.startDate > form.endDate
        ? "Das Enddatum darf nicht vor dem Startdatum liegen."
        : "",
  };
}

/** The body of `POST /company-shutdowns`; `salonIds` is left out for a Betriebsurlaub for the whole Unternehmen. */
export function createShutdownBody(
  form: ShutdownForm & {
    deductsFromVacation: boolean;
    notes: string;
    salonIds?: readonly string[];
  },
) {
  return {
    name: form.name.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    deductsFromVacation: form.deductsFromVacation,
    notes: form.notes || undefined,
    ...(form.salonIds && form.salonIds.length > 0 ? { salonIds: [...form.salonIds] } : {}),
  };
}

// ── Scope (Issue #1079) ───────────────────────────────────────────────────────────────────────────

/** The label of the whole-Unternehmen scope: the one wording of `lib/roles/assignment-label.ts` (#580). */
export const WHOLE_COMPANY_LABEL = SCOPE_TENANT_LABEL;

/** The scope control's state: the whole Unternehmen, or a choice of salons. */
export type ScopeSelection = { mode: "ALL" | "SALONS"; salonIds: string[] };

/** The name of a salon as shown in a chip; a deactivated salon says so. */
export function shutdownSalonLabel(salon: Pick<ShutdownSalon, "name" | "isActive">): string {
  return salon.isActive ? salon.name : `${salon.name} (deaktiviert)`;
}

/** What the „Gilt für“ column shows: the whole-Unternehmen label for no salons, else the salon names. */
export function shutdownScopeLabel(salons: readonly ShutdownSalon[]): string {
  return salons.length === 0 ? WHOLE_COMPANY_LABEL : salons.map(shutdownSalonLabel).join(", ");
}

/**
 * True when the caller has no choice: a single reachable salon and no whole-tenant reach. The salon is then
 * fixed and shown as text.
 */
export function isScopeFixed(scope: ShutdownScope): boolean {
  return !scope.canManageAllSalons && scope.salons.length === 1;
}

/**
 * The control's initial state for a NEW Betriebsurlaub: a whole-tenant caller starts with the whole Unternehmen;
 * a scoped caller with one salon has it fixed, with several none is chosen yet.
 */
export function initialShutdownScope(scope: ShutdownScope): ScopeSelection {
  if (scope.canManageAllSalons) return { mode: "ALL", salonIds: [] };
  return { mode: "SALONS", salonIds: isScopeFixed(scope) ? [scope.salons[0].id] : [] };
}

/** The state of the control for a stored row. */
export function scopeSelectionOf(salons: readonly ShutdownSalon[]): ScopeSelection {
  return salons.length === 0
    ? { mode: "ALL", salonIds: [] }
    : { mode: "SALONS", salonIds: salons.map((salon) => salon.id) };
}

/** The form message of the scope, or null: a chosen salon scope needs at least one salon. */
export function shutdownScopeMessage(selection: ScopeSelection): string | null {
  return selection.mode === "SALONS" && selection.salonIds.length === 0
    ? "Wähle mindestens einen Salon."
    : null;
}

/**
 * The `salonIds` of a request body, or undefined when the whole Unternehmen is meant. In a single-salon
 * Unternehmen there is no control: a whole-tenant caller sends none, a scoped caller its one salon.
 */
export function shutdownSalonIds(
  selection: ScopeSelection,
  scope: ShutdownScope,
  multiSalon: boolean,
): string[] | undefined {
  if (!multiSalon) return scope.canManageAllSalons ? undefined : scope.salons.map((s) => s.id);
  return selection.mode === "ALL" ? undefined : [...selection.salonIds];
}

/** True when two selections name the same scope (order is irrelevant). */
export function sameScope(a: ScopeSelection, b: ScopeSelection): boolean {
  if (a.mode !== b.mode) return false;
  if (a.salonIds.length !== b.salonIds.length) return false;
  const named = new Set(a.salonIds);
  return b.salonIds.every((id) => named.has(id));
}

/** The years offered by the list filter: last year to two years ahead. */
export function shutdownYears(currentYear: number): string[] {
  return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(String);
}

export function formatShutdownDate(date: string): string {
  return dayLabel(date, { year: true });
}

/** Calendar days of the period, both ends included. */
export function dayCount(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

/** „1 Tag“ / „8 Tage“. */
export function dayCountLabel(start: string, end: string): string {
  const days = dayCount(start, end);
  return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/** „1 Ausnahme“ / „3 Ausnahmen“. */
export function exceptionCountLabel(count: number): string {
  return `${count} ${count === 1 ? "Ausnahme" : "Ausnahmen"}`;
}
