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
  { file: "lib/me/zeiten-kpis.ts", rule: "now-calendar-field", reason: migration(2) },
  { file: "routes/(app)/ich/konto/+page.svelte", rule: "now-calendar-field", reason: migration(2) },
  {
    file: "routes/(app)/team/time-entries/+page.svelte",
    rule: "device-calendar-field",
    reason: migration(2),
  },
  {
    file: "routes/(app)/team/time-entries/+page.svelte",
    rule: "format-device-day",
    reason: migration(2),
  },
  {
    file: "routes/(app)/team/time-entries/+page.svelte",
    rule: "now-calendar-field",
    reason: migration(2),
  },
  {
    file: "lib/components/admin/monatsabschluss/MonthStatusTable.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "lib/components/employees/CreatePersonDialog.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "lib/components/employees/SalonAssignmentsSection.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "lib/components/employees/detail/BerufsschuleSection.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "lib/components/employees/detail/PersonTab.svelte",
    rule: "device-calendar-field",
    reason: migration(3),
  },
  {
    file: "lib/components/employees/detail/VertragTab.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  { file: "lib/employees/create-person.ts", rule: "device-calendar-field", reason: migration(3) },
  { file: "lib/employees/employment-state.ts", rule: "browser-day-helper", reason: migration(3) },
  { file: "lib/employees/employment-state.ts", rule: "device-default-param", reason: migration(3) },
  { file: "lib/employees/employment-state.ts", rule: "now-calendar-field", reason: migration(3) },
  { file: "lib/employees/overrides-form.ts", rule: "device-default-param", reason: migration(3) },
  { file: "lib/employees/overrides-form.ts", rule: "now-calendar-field", reason: migration(3) },
  {
    file: "routes/(app)/admin/employees/+page.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "routes/(app)/admin/employees/[id]/+page.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "routes/(app)/admin/employees/[id]/+page.svelte",
    rule: "device-calendar-field",
    reason: migration(3),
  },
  {
    file: "routes/(app)/team/personen/+page.svelte",
    rule: "browser-day-helper",
    reason: migration(3),
  },
  {
    file: "lib/components/admin/SalonHolidays.svelte",
    rule: "device-calendar-field",
    reason: migration(4),
  },
  {
    file: "lib/components/admin/abwesenheiten/BetriebsurlaubPanel.svelte",
    rule: "device-calendar-field",
    reason: migration(4),
  },
  {
    file: "lib/components/leave/LeaveRequestForm.svelte",
    rule: "device-calendar-field",
    reason: migration(4),
  },
  {
    file: "lib/components/leave/LeaveRequestForm.svelte",
    rule: "format-device-day",
    reason: migration(4),
  },
  {
    file: "lib/components/leave/ParentalReductionDialog.svelte",
    rule: "utc-day-of-now",
    reason: migration(4),
  },
  {
    file: "lib/components/settings/MyWorkSettings.svelte",
    rule: "device-calendar-field",
    reason: migration(4),
  },
  { file: "routes/(app)/inbox/+page.svelte", rule: "device-calendar-field", reason: migration(4) },
  {
    file: "routes/(app)/leave/+page.svelte",
    rule: "day-helper-on-device-clock",
    reason: migration(4),
  },
  {
    file: "routes/(app)/team/leave/+page.svelte",
    rule: "day-helper-on-device-clock",
    reason: migration(4),
  },
  { file: "routes/(app)/team/leave/+page.svelte", rule: "utc-day-of-now", reason: migration(4) },
  { file: "lib/audit/list-url-state.ts", rule: "device-default-param", reason: migration(5) },
  { file: "lib/audit/list-url-state.ts", rule: "now-calendar-field", reason: migration(5) },
  {
    file: "lib/components/admin/dienstplan/WeekPatternsPanel.svelte",
    rule: "utc-day-of-now",
    reason: migration(5),
  },
  {
    file: "routes/(app)/admin/export/+page.svelte",
    rule: "now-calendar-field",
    reason: migration(5),
  },
  {
    file: "routes/(app)/admin/month-close/+page.svelte",
    rule: "now-calendar-field",
    reason: migration(5),
  },
  { file: "routes/(app)/admin/shifts/+page.svelte", rule: "utc-day-of-now", reason: migration(5) },
  { file: "routes/(app)/reports/+page.svelte", rule: "now-calendar-field", reason: migration(5) },
  {
    file: "routes/(app)/shifts/+page.svelte",
    rule: "day-helper-on-device-clock",
    reason: migration(5),
  },
  {
    file: "routes/(app)/shifts/planning/+page.svelte",
    rule: "day-helper-on-device-clock",
    reason: migration(5),
  },
  { file: "routes/(app)/verwalten/+page.svelte", rule: "format-device-day", reason: migration(5) },
  { file: "routes/(app)/verwalten/+page.svelte", rule: "now-calendar-field", reason: migration(5) },
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
