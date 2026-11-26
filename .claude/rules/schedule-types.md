---
paths:
  - "apps/api/src/contexts/platform/**"
  - "apps/api/src/contexts/working-time-account/**"
  - "apps/api/src/contexts/absence/**"
  - "apps/api/src/contexts/scheduling/**"
  - "apps/web/src/routes/**/admin/**"
  - "apps/web/src/routes/**/verwalten/**"
  - "apps/web/src/lib/utils/work-schedule*"
  - "apps/api/src/__tests__/*schedule*"
  - "apps/api/scripts/**"
  - "packages/db/prisma/**"
---

Moved verbatim from CLAUDE.md (§ Schedule Types).

## Schedule Types

- `FIXED_WEEKLY` — fixed weekly hours with per-day allocation (e.g., 40h, Mo-Fr 8h)
- `MONTHLY_HOURS` — monthly hour budget for Minijobber/flexible workers
  - `monthlyHours` is an OWED monthly Soll (Issue #433, owner decision 2026-10-03), not a budget
    ceiling — null/0 is pure time tracking without Soll comparison AND never accumulates a saldo
    (Issue #494, owner decision 2026-10-06): `isTrackOnlySchedule()` in
    `apps/api/src/contexts/working-time-account/track-only-schedule.ts` is the ONE place the rule
    lives — a `MONTHLY_HOURS` contract with `monthlyHours` null/≤0 behaves exactly like
    `overtimeMode = TRACK_ONLY` regardless of the stored mode (live saldo 0, Monatsabschluss
    carry-over 0, an unclosed such month adds 0 to the live total). Its `monthlyHours` parameter
    is required so no caller can forget it; no reader re-derives it. Close/cron/recalc decide by
    the contract valid in the month, the live display by today's contract. Stored `overtimeMode`
    values are never rewritten and closed months keep their carry-over
    (`scripts/audit-494-track-only-carry.ts` lists them read-only); the admin form only DISPLAYS
    the lock („Überstunden-Modus" → „Nur erfassen").
  - No daily targets, no daily +/- display in calendar
  - Effective leave (all types incl. SICK), imposed absences, and statutory/manual holidays on a
    contractual workday reduce the owed Soll by `monthlyHours × 60 ÷ (contractual workdays of the
FULL calendar month)` (Ø-Methode; a half day reduces by half; one `Math.round()` per computed
    range; a holiday on a non-workday reduces nothing). The contractual workday set is `workDays` →
    `TenantConfig.defaultWorkDays` → Mo–Fr, read ONLY by the private `monthlyHoursWorkDays()` in
    `apps/api/src/contexts/working-time-account/timezone.ts` — never `{day}Hours`.
  - Every display of a MONTHLY_HOURS month Soll (month view, dashboard, reports/PDF, web calendar
    header) is computed by `monthlyHoursMonthSollMinutes()` in `close-employee-month.ts` — the one
    place this rule lives; no caller derives its own formula.
  - A VOCATIONAL_SCHOOL (Berufsschule) day is credited to worked minutes only, never also a Soll
    reduction (one day reduces Soll exactly once).
  - `TenantConfig.monthlyHoursHolidayDeduction` is retired — no code reads or writes it; the column
    was dropped by the migration `*_drop_monthly_hours_holiday_deduction` (GitHub #470).
  - Closed months are never recalculated — `scripts/dry-run-433-monthly-hours-soll.ts` lists the
    affected stored months read-only; any correction is a deliberate correction booking.
- `WorkSchedule.validFrom` MUST be the 1st of a calendar month for every contract CHANGE (PUT `/api/v1/settings/work/:employeeId` and tenant-config bulk apply). Non-1st dates are rejected with HTTP 400 + German message `"Vertragswechsel sind nur zum Monats-1. erlaubt."` (see `apps/api/src/contexts/platform/month-first-date.ts` for the canonical constant `MONTH_FIRST_ERROR`). The initial schedule on employee creation (POST `/api/v1/employees`) is exempt — `validFrom = hireDate` may be any day, because contract START is not a contract CHANGE. Existing non-1st rows (pre-Phase-60) are preserved for audit-trail purposes; surface them via `pnpm --filter @clokr/api exec tsx scripts/audit-workschedule-non-month1.ts`. See GitHub issue #220.
- **`{day}Hours` is authoritative data only for `FIXED_SCHEDULE`.** For `FLEXTIME`, `MONTHLY_HOURS`
  and `SHIFT_BASED` the seven `{day}Hours` columns are a legacy 1/0 flag rather than hours;
  `workDays` is what carries the contractual information for those types. Measured against a
  pseudonymized production copy on `main`'s schema (2026-08-30, Phase 95b / GitHub issue #95):

  | Schedule type    | rows | `{day}Hours` content             | flagged by `audit-workdays-vs-day-hours.ts` |
  | ---------------- | ---- | -------------------------------- | ------------------------------------------- |
  | `FIXED_SCHEDULE` | 6    | real values (4.00 / 8.00 / 9.50) | 0                                           |
  | `FLEXTIME`       | 1    | uniformly 1.00                   | 1                                           |
  | `MONTHLY_HOURS`  | 4    | uniformly 0.00                   | 0 (by design — see the audit-script bullet) |
  | `SHIFT_BASED`    | 15   | uniformly 8.00 or 1.00           | 4 (expected)                                |

- `WorkSchedule.workDays` is normalised **on write** to the set of weekday indices (0=Sun..6=Sat)
  where the corresponding `{day}Hours` value is > 0, on every create/update path (POST
  `/api/v1/employees`, PUT `/api/v1/settings/work/:employeeId` regular + cancelOrphanShifts
  branches, PUT `/api/v1/settings/work` applyToExisting bulk-apply) via `normalizeWorkDays()` in
  `apps/api/src/contexts/platform/calculate-work-days.ts`. **That is a write-path normalisation, not a statement
  about what stored rows mean.** Because its input hours are placeholders for every type except
  `FIXED_SCHEDULE`, the equality "`workDays` = days with `{day}Hours > 0`" describes reality for
  `FIXED_SCHEDULE` only. Since Phase 107 (D-02) no form write path routes `SHIFT_BASED` `workDays`
  through it at all. The audit that established the normalisation was Phase 61; its artefacts were
  archived with the milestone and are not in the repo.

- **FIXED_SCHEDULE: `weeklyHours` = Σ `{day}Hours` on every write (Issue #848).**
  `contexts/platform/fixed-schedule-hours.ts` is the ONE place: `POST /employees` (which takes no
  day hours) derives them from `weeklyHours` over the resolved `workDays` (hundredths, remainder on
  the last workday of the week; no `weeklyHours` = 8 h per workday, the old default), and so does
  the CSV import (over the column-default Mo–Fr);
  `PUT /settings/work/:employeeId` (an omitted `weeklyHours` takes the day sum) and the bulk apply
  (preview and apply) refuse a mismatch with 400 `WEEKLY_HOURS_MISMATCH` before any write. A
  write-path guard only — no reader changes, other types are never compared, and divergent rows
  are listed by `scripts/audit-848-weekly-vs-day-hours.ts` (read-only, ids only), never corrected.
- **FLEXTIME holidays take the Ø-day (Issue #1133).** A statutory or manual holiday reduces a
  `FLEXTIME` month Soll by `calcLeaveAbsenceMinutesTz()` for that day — the `avgWorkMinutesCore`
  Ø-day (`weeklyHours ÷ contract workdays`) on a contract workday, nothing on any other day — the
  same value as a leave day, in the one holiday loop of `closeEmployeeMonth`. `{day}Hours` is
  never read as hours for `FLEXTIME`. Months closed before the fix keep their figures;
  `scripts/audit-1133-flextime-holiday-soll.ts` lists them read-only, corrections only via #599.
- **Divergent legacy rows MUST NOT be "corrected" (Phase 95b, D-01).** Surface them with
  `pnpm --filter @clokr/api exec tsx scripts/audit-workdays-vs-day-hours.ts` — then leave them
  alone. `workDays` is the source of truth for leave consumption (`calculateWorkDays`) and pro-rata
  (`countWorkDaysPerWeek`), so aligning it to the placeholder hours replaces the RIGHT value with
  the WRONG one: the `MONTHLY_HOURS` rows (all day-hours 0.00) would end up with an EMPTY
  `workDays` and lose their Mo–Fr set, and the `FLEXTIME` row's deliberate 4-day week would become
  a 5-day week mid-year, changing retroactively what an already-taken leave day consumed. Phase 95b
  therefore changed not one data row — no migration, no backfill. This is not only
  Revisionssicherheit: the correction would be factually wrong.

- **The audit script checks ONE direction only, deliberately.** It reports a row when a day has
  `{day}Hours > 0` but is missing from `workDays`; it never reports the reverse (a day in
  `workDays` whose `{day}Hours` is 0), and it skips rows whose day-hours are all zero. A naive
  two-directional SQL query reports 9 rows where the script reports 5 — the 4 extra are exactly the
  `MONTHLY_HOURS` placeholder rows whose "correction" is the harmful one. `SHIFT_BASED` hits are
  labelled EXPECTED in the script's output for the same reason.

- **`SHIFT_BASED` (Phase 107, D-30).** For this type the contractual quantity is a COUNT, stored in
  `WorkSchedule.contractWorkDaysPerWeek Int?` (D-01) — not a weekday set. The concrete weekdays a
  `SHIFT_BASED` employee actually works come from the roster (`Shift`), never from `workDays`. The
  `{day}Hours` columns are placeholders and are NOT authoritative (`getScheduledHours()` in
  `apps/api/src/contexts/absence/api/leave.ts`, Phase 100 / OTC-04; `apps/api/src/contexts/working-time-account/shift-based-saldo.ts:53-57`).
  Since Phase 107 (D-02) no form write path touches `workDays` for `SHIFT_BASED` any more, so no NEW
  divergence can be created; existing divergent rows are preserved and are EXPECTED findings of
  `audit-workdays-vs-day-hours.ts`, not bugs — do NOT "fix" them on sight (Phase 95b, D-01).
- `contractWorkDaysPerWeekFrom()` in `apps/api/src/contexts/absence/leave-days.ts` is the ONLY place the
  `SHIFT_BASED` contractual-count fallback chain lives (`contractWorkDaysPerWeek` →
  `workDays.length` → `TenantConfig.defaultWorkDays.length` → `5`, Phase 107 D-04); `resolveContractWorkDaysPerWeek()`
  fetches the schedule and tenant config, then delegates to it (Phase 429) — it mirrors
  `resolveWorkDays()`'s shape but answers a different question ("how many days" vs. "which days").
  No other reader may rebuild this chain inline.
- `WorkSchedule.contractWorkDaysPerWeek Int?` — the `SHIFT_BASED` employee's contractual weekly
  workday count; `null` for every other schedule type (Phase 107, D-01).
- `WorkSchedule.usualWorkDays Int[] @default([])` (Phase 436, D-01; required for SHIFT_BASED
  writes since Issue #481) — the "übliche Arbeitstage" Angabe of a `SHIFT_BASED` contract ROW.
  Every write that creates or changes a `SHIFT_BASED` contract must name at least
  `contractWorkDaysPerWeek` days (`validateUsualWorkDays()` in
  `apps/api/src/contexts/platform/usual-work-days.ts`, German 400; owner decision 04.10.2026,
  Unterbau-Semantikänderung, ADR 0001-abweichungen Nachtrag Phase 481). Stored rows are never
  backfilled or guessed — an empty stored Angabe still means "keine Angabe" and is filled only
  through the audited `PATCH /api/v1/settings/work/:employeeId/usual-work-days` (same row, no new
  contract row, no repricing, no saldo or entitlement recompute). Non-empty is rejected with a
  German 400 for every other schedule type. It is authoritative ONLY for an angebrochene
  (fragment) leave week — a whole week always costs the contract days regardless of the Angabe. It
  is read ONLY through `usualWorkDaysFrom()` in `apps/api/src/contexts/absence/leave-days.ts` and
  is never derived from `workDays`, which remains the placeholder described above for
  `SHIFT_BASED`.
- `resolveLeaveDays()` (Phase 436, D-04/D-09) prices a `SHIFT_BASED` VACATION request as its
  marginal cost on its ISO weeks against the employee's earlier-created counted vacation requests
  (PENDING/APPROVED/CANCELLATION_REQUESTED, ordered by `createdAt` then id) — a second request in
  the same week costs only what it ADDS, not a second full price. Every caller passes a required
  `LeaveDaysPricing` argument and supplies `excludeRequestId` whenever it holds a request id (so a
  request is never priced against its own stored dates); approved requests are never re-priced
  implicitly — the Bestand surfaces only via the dry-run of
  `scripts/recalculate-shift-based-leave-days.ts` (no `--confirm`, writes nothing). That script
  skips requests ending before the employee's first non-deleted time entry (imported
  pre-tracking data) and, with `--before <YYYY-MM-DD>`, before that date; skipped requests are
  listed with their reason (Issue #481, D-09).
  Since Issue #481 every ISO week is priced with the contract valid IN IT, not the newest row: one
  `loadVacationContractSegments()` call per pricing (#450 segment semantics); the segment-aware
  kernels `countShiftBasedLeaveDaysBySegments` / `leaveDaysPerWeekBySegments` /
  `marginalShiftBasedLeaveDaysBySegments` in `vacation-calc.ts` (the scalar functions are
  one-segment delegates; the saldo's own `leaveDaysPerWeek` call is unchanged). A week whose
  REQUESTED dates fall into two segments is split and each part priced as a fragment (D-01/D-07);
  consecutive segments with identical count and Angabe are one pricing segment (PD-01). Other
  schedule types count each date with that date's workday set via `workDaysSetFrom()` in
  `leave-days.ts`, the only place that chain lives; the cross-year and report helpers follow
  through `prefixLeaveDays`.
- `LeaveRequest.daysProvisional Boolean?` — server-derived, set only at approval time; `true` when
  any day of a `SHIFT_BASED` leave request's period had no roster at calculation time (Phase 107,
  D-10/D-11). Never set by a client.
- **Bulk apply of the default working time is preview + confirm (Issue #568, § 3 NachwG).**
  `PUT /api/v1/settings/work` with `applyToExisting` never decides a contract change by itself.
  `POST /api/v1/settings/work/apply-defaults/preview` (read-only) computes the candidate set
  server-side; the apply needs `applyEmployeeIds` inside that set, the preview's `previewFingerprint`
  (409 `BULK_APPLY_PREVIEW_STALE` otherwise, nothing written) and an `effectiveFrom` that is a
  month-first and never before the tenant-local today (earliest: the next month-first, or today on the
  1st; at most 12 months ahead; 400 otherwise) — a working-time change must be communicated at the
  latest on the day it takes effect, so it is never retroactive. Only `FIXED_SCHEDULE` contracts and
  employees without a contract are candidates; a contract that differs from the stored defaults
  (`INDIVIDUAL`: hours, threshold, payout flag or the `workDays` set — a legacy row whose `workDays`
  diverge from its day-hours is never silently "corrected") is excluded unless the admin ticks it.
  A contract's `validFrom` is compared with `effectiveFrom` by its tenant-LOCAL calendar day (it is
  an instant), never by its UTC day. The config save, the new rows, one `CREATE WorkSchedule` audit
  per employee and one ids-only `BULK_APPLY` audit row run in ONE transaction serialised by a
  `FOR NO KEY UPDATE` lock on the Tenant row AND on the selected Employee rows (ordered by id; the
  per-employee `PUT /settings/work/:employeeId` takes the same Employee row lock and answers 409
  `CONTRACT_CHANGED_CONCURRENTLY` when the row at `validFrom` changed under it); the #450 vacation
  recompute and the saldo recalculation stay reactive after commit. The rule lives ONLY in `contexts/platform/bulk-apply-defaults.ts`; the
  web dialog (`BulkApplyDialog.svelte`) only chooses inside the preview and computes no date. Past
  applies are listed read-only by `scripts/audit-568-bulk-apply-history.ts`. Per-employee changes
  (`PUT /settings/work/:employeeId`) keep their rules (retroactive corrections stay possible there).
