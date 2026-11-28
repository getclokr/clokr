/**
 * Issue #1095 - the ONE reading of "this leave comes from a Betriebsurlaub" for every absence view.
 *
 * A Betriebsurlaub with leave deduction books an approved Urlaub request per person; the API names
 * that link on the row (`companyShutdownId`, plus the shutdown's `companyShutdown.name` where the
 * read joins it). The decision is the FIELD: a row is a Betriebsurlaub row iff it carries the id.
 * Nothing here looks at a type name or any other display string (CLAUDE.md § Context Boundaries).
 *
 * The code `COMPANY_SHUTDOWN` also names the imposed release days (an `Absence`, no deduction) the
 * calendar answer carries; it is a member of the `LeaveTypeCode` enum (guard G7 of
 * `absence-vocabulary-guard.test.ts`). Pure, no `$app` imports.
 */

/** The code of a Betriebsurlaub release day and of the legend entry for every Betriebsurlaub row. */
export const COMPANY_SHUTDOWN_CODE = "COMPANY_SHUTDOWN" as const;

/** The German word, display only. */
export const COMPANY_SHUTDOWN_LABEL = "Betriebsurlaub";

/** The two fields a leave row (list or calendar) carries when it comes from a Betriebsurlaub. */
export interface ShutdownFields {
  companyShutdownId?: string | null;
  companyShutdown?: { id: string; name: string } | null;
}

export interface ShutdownMark {
  id: string;
  /** The shutdown's own name; `null` when the read did not join it. */
  name: string | null;
}

/** The mark of a row, or `null` for every row that does not come from a Betriebsurlaub. */
export function shutdownMark(row: ShutdownFields | null | undefined): ShutdownMark | null {
  if (!row) return null;
  const id = row.companyShutdownId ?? row.companyShutdown?.id ?? null;
  if (id === null || id === "") return null;
  const name = row.companyShutdown?.name?.trim();
  return { id, name: name ? name : null };
}

/** „Betriebsurlaub“ or „Betriebsurlaub: Weihnachtsschließung“ - the long form for tooltips and sheets. */
export function shutdownTitle(mark: ShutdownMark): string {
  return mark.name === null ? COMPANY_SHUTDOWN_LABEL : `${COMPANY_SHUTDOWN_LABEL}: ${mark.name}`;
}

/**
 * The short text of a bar or a row title: the type with „Betriebsurlaub“ added („Urlaub ·
 * Betriebsurlaub“). A release day (`typeCode` COMPANY_SHUTDOWN) already IS the Betriebsurlaub, so it is
 * not said twice - decided by the code, never by comparing the text.
 */
export function withShutdownLabel(
  typeLabel: string,
  mark: ShutdownMark | null,
  typeCode: string | null,
): string {
  if (mark === null || typeCode === COMPANY_SHUTDOWN_CODE) return typeLabel;
  return `${typeLabel} · ${COMPANY_SHUTDOWN_LABEL}`;
}

/** The long text of a tooltip: the type plus „Betriebsurlaub: <name>“ („Urlaub · Betriebsurlaub: Weihnachten“). */
export function withShutdownTitle(
  typeLabel: string,
  mark: ShutdownMark | null,
  typeCode: string | null,
): string {
  if (mark === null) return typeLabel;
  return typeCode === COMPANY_SHUTDOWN_CODE
    ? shutdownTitle(mark)
    : `${typeLabel} · ${shutdownTitle(mark)}`;
}

/**
 * The type code a legend and a colour lookup use for a row: a row from a Betriebsurlaub is drawn as
 * Betriebsurlaub whatever request type it is booked as, every other row keeps its own code.
 */
export function legendTypeCode<T extends string | null>(
  code: T,
  mark: ShutdownMark | null,
): T | typeof COMPANY_SHUTDOWN_CODE {
  return mark === null ? code : COMPANY_SHUTDOWN_CODE;
}
