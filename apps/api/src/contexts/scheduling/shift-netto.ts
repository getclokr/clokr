/**
 * shift-netto.ts
 *
 * Phase 100 (OTC-04) — pure shift netto-minutes arithmetic, originally extracted from the
 * `sumShiftNetto` closure of `month-saldo.ts`:
 *
 *   let brutto = hmToMin(sh.endTime) - hmToMin(sh.startTime);
 *   if (brutto < 0) brutto += 24 * 60;                    // midnight-crossing shift
 *   if (brutto <= 0) continue;
 *
 * `Shift.startTime` / `Shift.endTime` are STRINGS ("06:00"), not DateTime columns (see the
 * `Shift` model in the shared database schema). This module therefore lives entirely in
 * minutes-since-midnight space and never constructs a timezone-aware object from a local time —
 * the same convention `time-arithmetic.ts` states and follows for the Phorest
 * Vor-/Nachbereitungszeit padding.
 *
 * `Shift` has NO `breakMinutes` column. Since Issue #1011 the planned break comes from the
 * recording's own function, `breakAmountFor` (`time-tracking/break-amount.ts`): the
 * employee/tenant setting, raised to the § 11 JArbSchG minimum when the person is under 18 on the
 * shift date (§ 18 Abs. 2 ArbZG). A planned shift is therefore netted exactly like the recording of
 * the same times — one rule, no second copy. The thresholds are measured on the gross shift
 * duration, the same convention the recording uses. Adults and persons without a birth date get
 * the break the adult rule always gave (byte-identical).
 *
 * The Arbeitszeitkonto nets the SHIFT_BASED roster Soll with the SAME rule: since Issue #1056 its
 * three closures (`close-employee-month.ts`, `month-saldo.ts`, `overtime-balance.ts`) call
 * `rosterShiftBreakMinutes`, which delegates to `breakAmountFor` with the age decided per shift date,
 * so the Konto and the Dienstplan net one shift the same way (pinned by
 * `roster-minor-break-1056.test.ts` and `roster-minor-break-gate-1056.test.ts`).
 *
 * ONE intentional behavioural difference from the `month-saldo.ts` closure: that closure also skips
 * shifts that fall on a leave/absence-covered date — a saldo PRORATION concern ("does this day's
 * roster count toward the month's expected minutes"), not a "how many hours does this request
 * cost" concern. This module deliberately does NOT filter by covered dates; a caller that needs
 * that exclusion applies it to the input array before calling in.
 */
import { isMinorAtDate } from "../absence";
import {
  breakAmountFor,
  type BreakEmployeeShape,
  type BreakTenantConfigShape,
} from "../time-tracking";

/** The employee facts the planned break reads; `birthDate` is required so no caller can forget the age. */
export type ShiftBreakEmployee = BreakEmployeeShape & { birthDate: Date | null | undefined };

/** A shift as the netto arithmetic reads it; `date` is the stored `Shift.date` (UTC midnight of the work day). */
export interface ShiftNettoInput {
  date: Date;
  startTime: string;
  endTime: string;
}

/** Parse "HH:mm" into minutes since 00:00 (mirrors month-saldo.ts's hmToMin). */
function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Gross minutes of a shift, midnight-crossing corrected. 0 for a zero-length shift. */
function shiftBruttoMinutes(shift: ShiftNettoInput): number {
  let brutto = hmToMin(shift.endTime) - hmToMin(shift.startTime);
  if (brutto < 0) brutto += 24 * 60; // midnight-crossing shift (e.g. 22:00 -> 06:00)
  return brutto;
}

/**
 * The break the plan deducts from one shift: the recording's break rule (`breakAmountFor`, `time-tracking/break-amount.ts`) over
 * the gross shift duration on the shift date. 0 for a shift of no length.
 */
export function shiftBreakMinutes(
  shift: ShiftNettoInput,
  employee: ShiftBreakEmployee,
  tenantConfig: BreakTenantConfigShape,
): number {
  const brutto = shiftBruttoMinutes(shift);
  if (brutto <= 0) return 0;
  return breakAmountFor({
    employee,
    tenantConfig,
    presenceMin: brutto,
    isMinor: isMinorAtDate(employee.birthDate, shift.date),
  }).amountMin;
}

/**
 * Netto minutes of a single shift: brutto (end - start, midnight-crossing corrected) minus the
 * break `shiftBreakMinutes` prescribes. Never negative — a break configured longer than the shift
 * floors at 0, not a negative netto.
 */
export function shiftNettoMinutes(
  shift: ShiftNettoInput,
  employee: ShiftBreakEmployee,
  tenantConfig: BreakTenantConfigShape,
): number {
  const brutto = shiftBruttoMinutes(shift);
  if (brutto <= 0) return 0;
  return Math.max(0, brutto - shiftBreakMinutes(shift, employee, tenantConfig));
}

/** Sum of shiftNettoMinutes() over a list of shifts. Empty list -> 0. */
export function sumShiftNettoMinutes(
  shifts: ShiftNettoInput[],
  employee: ShiftBreakEmployee,
  tenantConfig: BreakTenantConfigShape,
): number {
  return shifts.reduce(
    (total, shift) => total + shiftNettoMinutes(shift, employee, tenantConfig),
    0,
  );
}
