/**
 * Issue #86, D-01 - the employment state of a person, decided from `exitDate` and a calendar day,
 * never from a display string. The exit date is the END OF THE EMPLOYMENT: the person stays visible
 * with all data (retention), and the app login stays active until someone with access management
 * locks it separately (a deliberate split, see the exit-date hint on the detail page).
 *
 * `exitDate` is read by its UTC calendar day, the convention of the employee form (`@db.Timestamptz`
 * holding a UTC-midnight date). Callers pass the TENANT's calendar day from `tenantDay()` in
 * `$lib/utils/tenant-day` (Issues #1066, #1072), never the device day. A person whose last day is
 * today is still employed (EXIT_PLANNED) until the day is over.
 */
import { dayLabel } from "$lib/utils/day-label";

export type EmploymentKind = "EMPLOYED" | "EXIT_PLANNED" | "ENDED";

export interface EmploymentState {
  kind: EmploymentKind;
  /** „Austritt am T.M.JJJJ“ / „Ausgeschieden am T.M.JJJJ“; empty for EMPLOYED. */
  label: string;
}

function germanDay(isoDay: string): string {
  return dayLabel(isoDay, { year: true });
}

/** `today` is a `YYYY-MM-DD` calendar day. */
export function employmentState(
  exitDate: string | null | undefined,
  today: string,
): EmploymentState {
  if (!exitDate) return { kind: "EMPLOYED", label: "" };
  const exitDay = String(exitDate).slice(0, 10);
  if (exitDay >= today) return { kind: "EXIT_PLANNED", label: `Austritt am ${germanDay(exitDay)}` };
  return { kind: "ENDED", label: `Ausgeschieden am ${germanDay(exitDay)}` };
}
