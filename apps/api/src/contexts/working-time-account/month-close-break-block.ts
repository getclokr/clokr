/**
 * Issue #522: whether a person's Monatsabschluss is certain to be refused for a break reason.
 *
 * The POST close gate refuses under the tenant flag `blockMonthCloseOnUnconfirmedBreak` while a day
 * of the person is in either break list (unconfirmed AUTO breaks, § 4 ArbZG / § 11 JArbSchG
 * findings). The lists are already empty for a closed month and (Phase 92) for a tenant that has
 * not opted in. The status route decides this from the FULL lists, before the day-detail redaction,
 * so a reader without day-level reach gets the same flag and the web never derives the rule itself.
 */
export function breakBlocksCloseFor(
  row: { unconfirmedBreakDays?: unknown[]; breakFindingDays?: unknown[] },
  tenantConfig: { blockMonthCloseOnUnconfirmedBreak?: boolean | null } | null | undefined,
): boolean {
  return (
    (tenantConfig?.blockMonthCloseOnUnconfirmedBreak ?? false) &&
    ((row.unconfirmedBreakDays?.length ?? 0) > 0 || (row.breakFindingDays?.length ?? 0) > 0)
  );
}
