// Issue #1072 - the register of the tenant-day guard (`tenant-day-guard-1072.test.ts`).
//
// An entry says: this file may keep reading the device or UTC day through this rule. Every entry
// needs a reason a reviewer can check, and an entry that no longer matches its file fails the guard
// (a stale exception is a hole the guard would otherwise silently keep open). The register only
// ever shrinks: a new place that needs "today" derives it through `$lib/utils/tenant-day`.
//
// The operator console is the one lasting exception. While Issue #1072 is being migrated the list
// additionally carries a temporary entry per file that has not moved yet (falling-only, like the
// repo's ratchets): the task that fixes a file removes its entries, and the last task leaves only
// the operator console.

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

/** Temporary: the file moves onto the tenant day in Task `task` of the 1072 quick plan. */
function migration(task: number): string {
  return `Issue #1072 migration: moves onto the tenant day in Task ${task} of the 1072 quick plan`;
}

export const TENANT_DAY_EXCEPTIONS: ReadonlyArray<TenantDayException> = [
  { file: "lib/operator/support-month.ts", rule: "device-default-param", reason: OPERATOR_REASON },
  { file: "lib/operator/support-month.ts", rule: "now-calendar-field", reason: OPERATOR_REASON },
  { file: "lib/operator/support-audit.ts", rule: "device-default-param", reason: OPERATOR_REASON },
  { file: "lib/operator/support-audit.ts", rule: "now-calendar-field", reason: OPERATOR_REASON },
  // Temporary migration entries, removed by the task that fixes the file.
  {
    file: "lib/components/availability/AvailabilityEditModal.svelte",
    rule: "utc-day-of-now",
    reason: migration(6),
  },
  {
    file: "lib/components/availability/AvailabilityOneOffList.svelte",
    rule: "utc-day-of-now",
    reason: migration(6),
  },
  {
    file: "lib/components/availability/AvailabilityWeekGrid.svelte",
    rule: "utc-day-of-now",
    reason: migration(6),
  },
  { file: "lib/settings/phorest.ts", rule: "device-default-param", reason: migration(6) },
  { file: "lib/settings/phorest.ts", rule: "utc-day-of-now", reason: migration(6) },
  {
    file: "routes/(app)/admin/availability/[employeeId]/+page.svelte",
    rule: "utc-day-of-now",
    reason: migration(6),
  },
  { file: "routes/(app)/availability/+page.svelte", rule: "utc-day-of-now", reason: migration(6) },
];
