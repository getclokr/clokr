// Issue #589 — the ONE place the shift roster decides its rows and its per-cell contract facts.
//
// Owner decision 19.10.2026 (OD-589-1): every person of a salon is in the Schichtplan and can be given
// shifts, whatever the Arbeitszeitmodell. The server (`GET /shifts/week`) lists every plannable person
// employed in the displayed week; this module keeps as rows those who hold a contract in it or a shift
// (D-589-01) — so a person counted in the Besetzung, by shift or by contract, is always a row
// (AC-589-4, D-589-05). Soll and saldo are untouched (OD-589-2): a non-SHIFT_BASED row shows planned
// shift hours and its model name, never a "Vertrag" figure.
//
// Pure and dependency-free (no store import): it is read by the page AND by the API suite
// `shifts-week-roster-589.test.ts`, which loads it by path to prove the counted-subset-of-rows invariant
// across the two layers. Every new response field is optional, so an older API during a rolling deploy
// degrades to "no mark, no hint".

/** A person as the week response lists them — only the fields this module reads. */
export interface RosterEmployeeLike {
  id: string;
  workSchedules?: ReadonlyArray<{ type?: string }>;
}

/** The slice of `GET /shifts/week` this module reads. */
export interface RosterWeekLike<E extends RosterEmployeeLike = RosterEmployeeLike> {
  employees: E[];
  shifts: ReadonlyArray<{ employeeId: string }>;
  coverage?: ReadonlyArray<{ date: string; contractEmployeeIds?: readonly string[] }>;
  /** Per fixed/flex person, the ISO days of the week that are contract workdays (D-589-07). */
  contractWorkDaysByEmp?: Readonly<Record<string, readonly string[]>>;
}

/** D-589-01 — every person with a contract in the displayed week or a shift in it, in server order. */
export function rosterRows<E extends RosterEmployeeLike>(week: RosterWeekLike<E>): E[] {
  const withShift = new Set(week.shifts.map((s) => s.employeeId));
  return week.employees.filter((e) => (e.workSchedules?.length ?? 0) > 0 || withShift.has(e.id));
}

const dayOf = (iso: string): string => iso.slice(0, 10);

/** D-589-05 — is the person counted in that day's Besetzung by their contract (not by a shift)? */
export function countedByContract(week: RosterWeekLike, employeeId: string, iso: string): boolean {
  const day = dayOf(iso);
  const entry = week.coverage?.find((c) => dayOf(c.date) === day);
  return entry?.contractEmployeeIds?.includes(employeeId) ?? false;
}

/**
 * D-589-07 — the tooltip hint of a shift on a day the person's fixed or flexible contract leaves free.
 * A hint, never a conflict and never a block (#950 keeps "Konflikt" for shifts in approved leave).
 */
export function contractFreeDayHint(
  week: RosterWeekLike,
  employee: RosterEmployeeLike,
  iso: string,
): string | null {
  const type = employee.workSchedules?.[0]?.type;
  if (type !== "FIXED_SCHEDULE" && type !== "FLEXTIME") return null;
  if (!week.contractWorkDaysByEmp) return null;
  const days = week.contractWorkDaysByEmp[employee.id] ?? [];
  return days.some((d) => dayOf(d) === dayOf(iso)) ? null : "An diesem Tag ist laut Vertrag frei.";
}

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Gross shift duration in hours; a cross-midnight shift (22:00–06:00) wraps to the next day. */
export function shiftHours(start: string, end: string): number {
  const a = parseHHMM(start);
  const b = parseHHMM(end);
  let dur = (b.h * 60 + b.m - (a.h * 60 + a.m)) / 60;
  if (dur < 0) dur += 24;
  return Math.max(0, dur);
}

/** The neutral text for a refused write when the server's own message is missing. */
export const SHIFT_NO_CONTRACT_FALLBACK = "Für diese Person gilt an diesem Tag kein Vertrag.";

/**
 * D-589-02 — the German text of a refused shift write (POST or PUT) because the person holds no
 * contract on the shift's date (422, code `SHIFT_NO_CONTRACT`, which replaced the retired type gate).
 * `null` for every other refusal, so the caller keeps its own handling. The code is the control value;
 * the text is display only.
 */
export function shiftNoContractMessage(
  status: number,
  data: { code?: string; message?: string } | undefined,
): string | null {
  if (status !== 422 || data?.code !== "SHIFT_NO_CONTRACT") return null;
  return data.message ?? SHIFT_NO_CONTRACT_FALLBACK;
}
