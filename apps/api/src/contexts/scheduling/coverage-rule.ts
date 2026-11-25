import type { AccessReach } from "../platform";

/**
 * Issue #647 (D-03 … D-05) — the ONE place the week coverage decides which salon is in view
 * (`coverageSalonInView`) and which rule applies on a day (`pickCoverageRule`).
 *
 * Candidates are the tenant-wide rules (`salonId` null) plus the rules of the salon in view. The
 * pre-#647 specificity ladder is unchanged:
 *   1. template + day   2. all templates + day   3. template + all days   4. all templates + all days
 *   5. DEFAULT_COVERAGE_RULE
 * Within each rung a rule of the salon in view beats a tenant-wide one, never across rungs: a
 * tenant-wide rule on a more specific rung still beats a salon rule on a less specific rung. With no
 * salon in view only the tenant-wide rules decide, which is exactly the behaviour before #647.
 *
 * Pure: a type-only import, no model access. Rule rows of other salons may be passed in and are ignored.
 *
 * Issue #589 (D-589-06, AC-589-7): the same module is the ONE server place a coverage day is judged
 * CLOSED (`closedWeekdaysOf`, `isCoverageDayClosed`). A day on which the salon in view (or, with no salon
 * in view, every salon of the caller's reach) is closed has no staffing target, so it never reads as a
 * shortfall; its `minStaff` stays the rule value and only the status is forced to "ok". The write-side
 * opening-hours rule of `checkShiftWrite` (shift-write-checks.ts) is a separate rule and is not touched.
 */

export interface CoverageRuleCandidate {
  /** null = tenant-wide */
  salonId: string | null;
  templateId: string | null;
  /** 0=Mo..6=So; -1 = all days */
  dayOfWeek: number;
  minStaff: number;
  requiresNonSupervised: boolean;
}

export interface PickedCoverageRule {
  minStaff: number;
  requiresNonSupervised: boolean;
}

/** No rule matches — matches the legacy hardcoded MIN_COVERAGE = 2. */
export const DEFAULT_COVERAGE_RULE: Readonly<PickedCoverageRule> = Object.freeze({
  minStaff: 2,
  requiresNonSupervised: false,
});

/**
 * Issue #647 (D-03/D-03a) — the salon in view of the week coverage. Precedence:
 *   1. the validated `salonId` filter;
 *   2. D-03a (accepted amendment): the caller's `shift:read` reach is `scoped` with exactly ONE salon
 *      that is among the active salons and holds no person ids — a salon manager reaching only salon A
 *      never sends a filter (#84 D-11), yet A is the salon whose rules they plan against;
 *   3. D-03: the tenant's only ACTIVE salon (a single-salon tenant must be able to use a salon rule,
 *      and the web never sends a filter there, #84 D-11).
 * With several active salons and none of the above there is no salon in view, so only tenant-wide
 * rules apply — exactly the behaviour before #647. The caller passes the tenant's ACTIVE salons,
 * never a reach-filtered list.
 */
export function coverageSalonInView(input: {
  chosenSalonId: string | null;
  activeSalonIds: readonly string[];
  reach: AccessReach;
}): string | null {
  if (input.chosenSalonId !== null) return input.chosenSalonId;
  const { reach, activeSalonIds } = input;
  if (reach.kind === "scoped" && reach.employeeIds.length === 0 && reach.salonIds.length === 1) {
    const only = reach.salonIds[0]!;
    if (activeSalonIds.includes(only)) return only;
  }
  return activeSalonIds.length === 1 ? activeSalonIds[0]! : null;
}

export function pickCoverageRule(
  rules: readonly CoverageRuleCandidate[],
  salonInView: string | null,
  templateId: string | null,
  dayOfWeek: number,
): PickedCoverageRule {
  // Candidate set: tenant-wide rules, plus the salon in view's own. Another salon's rule never acts.
  const candidates = rules.filter(
    (r) => r.salonId === null || (salonInView !== null && r.salonId === salonInView),
  );
  const rung = (matches: (r: CoverageRuleCandidate) => boolean): PickedCoverageRule | undefined => {
    const hit =
      candidates.find((r) => r.salonId !== null && matches(r)) ??
      candidates.find((r) => r.salonId === null && matches(r));
    return hit
      ? { minStaff: hit.minStaff, requiresNonSupervised: hit.requiresNonSupervised }
      : undefined;
  };

  if (templateId) {
    const exact = rung((r) => r.templateId === templateId && r.dayOfWeek === dayOfWeek);
    if (exact) return exact;
  }
  const allTemplatesDay = rung((r) => r.templateId === null && r.dayOfWeek === dayOfWeek);
  if (allTemplatesDay) return allTemplatesDay;
  if (templateId) {
    const templateAllDays = rung((r) => r.templateId === templateId && r.dayOfWeek === -1);
    if (templateAllDays) return templateAllDays;
  }
  const allTemplatesAllDays = rung((r) => r.templateId === null && r.dayOfWeek === -1);
  if (allTemplatesAllDays) return allTemplatesAllDays;
  return { ...DEFAULT_COVERAGE_RULE };
}

/**
 * Issue #589 (D-589-06) — the weekdays (0 = Montag .. 6 = Sonntag) a salon's stored opening hours mark
 * `closed: true`. Malformed input yields no closed day and never throws; this is the same reading as the
 * web's `closedWeekdays` (`apps/web/src/lib/shifts/closed-days.ts`).
 */
export function closedWeekdaysOf(openingHours: unknown): Set<number> {
  const closed = new Set<number>();
  if (!Array.isArray(openingHours)) return closed;
  for (const entry of openingHours) {
    if (typeof entry !== "object" || entry === null) continue;
    const { day, closed: isClosed } = entry as { day?: unknown; closed?: unknown };
    if (isClosed === true && typeof day === "number" && Number.isInteger(day)) closed.add(day);
  }
  return closed;
}

/**
 * Issue #589 (D-589-06, AC-589-7) — is a coverage day closed? With a salon in view
 * (`coverageSalonId`, validated by the caller) the answer is that salon's own opening hours, looked up
 * among the ACTIVE salons; with none in view a day is closed only when the caller's reach holds at least
 * one salon and EVERY salon of it closes that weekday — a day on which only one of two salons is closed
 * still needs staff in the other. A salon in view that is not among the active salons judges nothing
 * closed (fail-open towards showing a shortfall, never towards hiding one).
 */
export function isCoverageDayClosed(input: {
  coverageSalonId: string | null;
  activeSalons: readonly { id: string; openingHours: unknown }[];
  reachSalons: readonly { salonId: string; openingHours: unknown }[];
  /** 0 = Montag .. 6 = Sonntag */
  dayOfWeek: number;
}): boolean {
  if (input.coverageSalonId !== null) {
    const salon = input.activeSalons.find((s) => s.id === input.coverageSalonId);
    return salon ? closedWeekdaysOf(salon.openingHours).has(input.dayOfWeek) : false;
  }
  return (
    input.reachSalons.length > 0 &&
    input.reachSalons.every((s) => closedWeekdaysOf(s.openingHours).has(input.dayOfWeek))
  );
}
