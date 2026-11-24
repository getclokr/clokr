/**
 * break-amount.ts
 *
 * Issue #1011 — the ONE break-amount rule: which break regime a work day is under and how many
 * minutes it prescribes. The recording's automatic break (`planAutoBreak`) and the roster's planned
 * netto (`scheduling/shift-netto.ts`) both call it, so a planned shift and the recording of the same
 * times can never disagree on the break.
 *
 * Regime = § 11 JArbSchG for a person under 18 on the work date (§ 18 Abs. 2 ArbZG), else § 4 ArbZG.
 * Amount = the configured break (employee override, else tenant default) raised to the § 11 minimum
 * for a minor (`autoBreakAmountFor`). `presenceMin` is the GROSS presence — the existing threshold
 * convention of the recording.
 *
 * The age decision is injected (`isMinor`, from `isMinorAtDate(birthDate, workDate)` of Abwesenheiten)
 * and not read here: this module is a leaf that imports neither the absence nor any other context, so
 * exporting it from the time-tracking index adds no module to the measured import cycle
 * (`measure-context-boundary-imports.ts --cycles`). Same technique as `break-finding-days.ts`.
 */
import { getEffectiveBreakDuration } from "./break-effective";
import type { BreakEmployeeShape, BreakTenantConfigShape } from "./break-effective";
import { breakRegimeFor, type BreakRegime } from "./break-regime";
import { autoBreakAmountFor } from "./place-auto-break";

export function breakAmountFor(input: {
  employee: BreakEmployeeShape;
  tenantConfig: BreakTenantConfigShape;
  presenceMin: number;
  /** True when the person is under 18 on the work date: `isMinorAtDate(birthDate, workDate)`. */
  isMinor: boolean;
}): { regime: BreakRegime; amountMin: number } {
  const { employee, tenantConfig, presenceMin } = input;
  const regime = breakRegimeFor(input.isMinor);
  const amountMin = autoBreakAmountFor({
    configuredMin: getEffectiveBreakDuration(employee, tenantConfig, presenceMin),
    presenceMin,
    regime,
  });
  return { regime, amountMin };
}
