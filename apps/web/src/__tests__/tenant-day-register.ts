// Issue #1072 - the register of the tenant-day guard (`tenant-day-guard-1072.test.ts`).
//
// An entry says: this file may keep reading the device or UTC day through this rule. Every entry
// needs a reason a reviewer can check, and an entry that no longer matches its file fails the guard
// (a stale exception is a hole the guard would otherwise silently keep open). The register only
// ever shrinks: a new place that needs "today" derives it through `$lib/utils/tenant-day`.
//
// The operator console is the one lasting exception. During the migration of Issue #1072 the list
// carried a temporary entry per file that had not moved yet; none is left, and the guard fails on
// any reason that names a migration, so the register only holds reasoned, lasting exceptions.

export type TenantDayRule =
  | "format-device-day"
  | "utc-day-of-now"
  | "device-calendar-field"
  | "browser-day-helper"
  | "device-default-param"
  | "day-helper-on-device-clock"
  | "now-calendar-field";

export interface TenantDayException {
  /** Relative to `apps/web/src`, forward slashes. */
  file: string;
  rule: TenantDayRule;
  reason: string;
}

const OPERATOR_REASON =
  "Operator console (Phase 88/93): the operator principal holds no tenant session and never reads GET /settings/work; the value is only the starting filter the operator changes, and the API validates every month and window.";

export const TENANT_DAY_EXCEPTIONS: ReadonlyArray<TenantDayException> = [
  { file: "lib/operator/support-month.ts", rule: "device-default-param", reason: OPERATOR_REASON },
  { file: "lib/operator/support-month.ts", rule: "now-calendar-field", reason: OPERATOR_REASON },
  { file: "lib/operator/support-audit.ts", rule: "device-default-param", reason: OPERATOR_REASON },
  { file: "lib/operator/support-audit.ts", rule: "now-calendar-field", reason: OPERATOR_REASON },
];
