---
paths:
  - "apps/api/src/contexts/absence/**"
  - "apps/api/src/contexts/scheduling/**"
  - "apps/web/src/lib/leave/**"
  - "apps/web/src/routes/**/leave/**"
  - "apps/web/src/routes/**/vacation/**"
  - "apps/api/src/__tests__/*leave*"
  - "apps/api/src/__tests__/*vacation*"
  - "apps/api/scripts/**"
  - "packages/db/prisma/**"
  - "docs/burlg-carryover.md"
---

Moved verbatim from CLAUDE.md (§ Vacation Carry-Over & Cross-Year Booking).

## Vacation Carry-Over & Cross-Year Booking

BUrlG §3/§7, EuGH carry-over rules, cross-year splitting, dynamic recalc, FIFO priority, carry-over validation with documented reasons → see `docs/burlg-carryover.md` (and GitHub issue #58).

- **Resturlaub (remaining, expired, at-risk) comes from one function (Issue #451, D-07).**
  `vacationBalanceForRow`/`getVacationBalance` (`contexts/absence/facade/vacation-balance.ts`) is
  the only place that computes it; every reader (Dashboard, Urlaubsübersicht, the Monatsexport's „Urlaubsjahr“ section, the
  carry-over expiry cron, `GET /leave/entitlements`, the admin Urlaubsverwaltung) reads this
  facade instead of re-deriving the arithmetic.
  The deactivate preview (Issue #615) reads it through `exitVacationBalance`: a hypothetical exit day goes through the
  #447 sync's own read-only planner, so there is no second § 5 computation.
- **The regular yearly base value comes from one function (Issue #482).**
  `resolveVacationBaseDays()` (`contexts/absence/leave-days.ts`) is the only place the chain
  lives — `Employee.annualVacationDays`, then for an AZUBI
  `TenantConfig.defaultApprenticeVacationDays`, then `TenantConfig.defaultVacationDays`, then 30;
  the statutory floor is applied afterwards by the regular-entitlement formula. A settings or
  classification change writes no row by itself; new years, the #445 zero heal and the audited
  #447/#450 recomputes read the current value. No reader rebuilds the chain.
- **A changed hire date moves the entitlement rows in one place (Issue #961).**
  `syncVacationEntitlementsForHireDateChange()` (`contexts/absence/hire-date-entitlements.ts`), invariant-carrying in
  the `PATCH /employees/:id` transaction: leave (pending or effective) before a LATER hire date is a 409
  `LEAVE_BEFORE_HIRE_DATE`; rows of years before the new hire year are set to 0 (never deleted, also past-year and
  human rows), the affected years are recomputed through `resolveRegularVacationDays`, an earlier hire date creates
  the missing rows employee creation would have created, and the carry-over chain is recomputed — all audited with the
  reason „Eintrittsdatum geändert“. Details `docs/burlg-carryover.md`; Bestand `scripts/audit-961-entitlements-before-hire.ts`.
- **Parallel leave per salon is counted in one place (Issue #836).** `parallelLeaveLoad()` (the pure
  kernel) and `evaluateLeaveLimits()` (the checker) in `contexts/absence/leave-limits/` — deliberately NOT
  re-exported from `contexts/absence/index.ts` (import-cycle cap 22), callers in Abwesenheiten import the
  module by relative path — are the only place "how many persons of a group are on leave in a salon on a day"
  is computed. A person counts once per salon, group and day: the Stammsalon of that day, only the person's own
  workdays, only the allow-list `LEAVE_LIMIT_COUNTED_CODES` (never derived by excluding sick codes), PENDING
  included. A `LeaveLimitRule` (all salons or one salon, group `ALL` / `CLASSIFICATION` / `ACCESS_ROLE`, a blackout
  is `ALL` with `maxPersons` 0) gives a warning on request creation (`leaveLimitWarnings`, fail-open), and an
  approval or a `/correct` over a limit is a 409 `LEAVE_LIMIT_EXCEPTION_REQUIRED` until the approver sends
  `limitException: { reason }` (10-500 characters, audited with rule ids and counts, never another person's id;
  fail-closed). Names of other persons appear only within the reader's `leave-request:read:ZUGEWIESEN` reach
  (`redact.ts`), everyone else gets `hiddenCount`; the load read is `GET /leave/limits/load`. Never
  retroactive: leave approved before a rule is only marked (`approvedBeforeRule`). A second count anywhere
  turns `leave-limits-one-place-836.test.ts` red. Details and the documented limits (no classification/role
  history, `reviewedAt` as the approval stamp, concurrent approvals): `docs/adr/0001-abweichungen.md`, Eintrag AG.
- **The leave planner lives in one place (Issue #835).** `contexts/absence/leave-plan/` (deliberately NOT re-exported from
  `contexts/absence/index.ts`, import-cycle cap 22; routes `api/leave-plans.ts`, `/api/v1/leave/plans`) is a non-binding yearly
  plan per salon and year: `LeavePlan` (`OPEN` / `TAKEN_OVER`, never deleted) and `LeavePlanWish` (always `VACATION`, soft
  removal, no free text). **A wish counts nowhere** - no saldo, report, DATEV, roster, pricing, month close, leave limit or
  composition file may name `LeavePlan` / `LeavePlanWish` (`leave-plan-isolation-835.test.ts`, AST with a walked-set floor).
  The rules, each in one place: the day figure comes only from `leaveLimitLoadView` with wishes passed as `candidates`
  (#836 kernel, never a second count); a wish's price only from `resolveLeaveDays` with `extraSiblings` (parity with filing the
  requests one by one, `leave-plan-takeover-parity-835`); **the takeover creates and approves requests only through
  `createLeaveRequestCore` (`leave-request-create.ts`) and `approveLeaveRequestCore` (`leave-decision.ts`)** - the same cores
  behind `POST /leave/requests` and `PATCH /leave/requests/:id/review`, never a second validator, a direct `leaveRequest` write
  or a copy of their checks; the taker's own wish and wishes outside the taker's approve reach stay `PENDING` (four-eyes); the
  employment window and the Stammsalon are re-checked at takeover (`LEAVE_PLAN_WISH_NOT_EMPLOYED`, `LEAVE_PLAN_WISH_NOT_IN_SALON`)
  and the #836 limit pre-check runs only for wishes approved at once; a request is linked to a wish only if the wish still has
  the stored dates (`FOR UPDATE` link hook; a wish moved mid-run re-runs the whole per-wish pipeline); a wish is taken over
  only under the taker's `leave-request:create` reach over the person (`LEAVE_PLAN_WISH_NO_CREATE_REACH` otherwise -
  `leave-plan:manage` never goes around the create rule); every takeover write on a wish (link, refusal, `takenOverAt`) is
  audited, codes only; a request that ends `PENDING` notifies its approvers like any request, never silently. The two refusals
  `LEAVE_PLAN_WISH_NOT_EMPLOYED` / `LEAVE_PLAN_WISH_NOT_IN_SALON` are terminal and never block the close; an `APPROVAL_…`
  refusal blocks it only while the request is `PENDING` and the taker may approve it (else the refusal is cleared and the
  request stays for a regular approver); the plan closes only when nothing else is open, so a plan never gets stuck OPEN.
  **One takeover run per plan at a time** (advisory lock held for the run on one connection, `utils/with-advisory-lock.ts`
  pattern; a second run is 409 `LEAVE_PLAN_TAKEOVER_RUNNING`), and the decision core writes a decision only on a `PENDING`
  row, so no request is approved and deducted twice - for the regular review route too. A refusal reason of another person's
  wish is shown only within the reader's `leave-request:read` reach. **The
  database is the last wall:** one OPEN plan per salon and year (`LeavePlan_open_unique`, partial unique), no two active
  wishes of a person overlap (`LeavePlanWish_no_overlap_active`, exclusion constraint) - both recognised structurally
  (`P2002` + index name, `P2039` + `23P01`), never by message. **Permission:** `leave-plan:manage:ZUGEWIESEN` (open, set the
  deadline, edit other persons' wishes in reach, take over; Admin, Inhaber and Salonmanager templates, owner decision
  06.11.2026); own wishes need only `leave-request:create:EIGENE`; readers are `leave-request:read` in reach OR the person's own
  Stammsalon, every other cause is the one identical 404. **The deadline** (`TenantConfig.leavePlanDeadlineLocksWishes`,
  default off) locks only a person's OWN edits after the tenant-local deadline day, never a manager in reach; a taken-over plan
  is read-only (409 `LEAVE_PLAN_CLOSED`). **Notification:** the type `LEAVE_PLAN_OPENED` has its push text ("Die
  Urlaubsplanung ist eröffnet.") and e-mail policy in the registries (#608). **Takeover cost:** the decision core's
  `deferOvertimeRecompute` skips only the live-saldo recompute and the takeover refreshes the stored overtime balance once per
  approved person whose wish starts on or before the end of the tenant-local current month - SHIFT_BASED reads the
  running month's approved leave (reactive; measured 253 -> 93 SQL statements and 3.8 s -> 1.5 s per 40 wishes, about
  4 s per 100); batching with a cursor (D-835-36) was deliberately not built. Wishes are hard-deleted only by the employee
  hard-delete path (`hardDeleteLeavePlanWishesForEmployee` before `hardDeleteLeaveRequestsForEmployee`, `Restrict` FKs). ADR
  `docs/adr/0001-abweichungen.md`, Eintrag AH.

- **A Betriebsurlaub for single salons (Issue #1079)** books through the one #1069 module; who is affected is decided by
  `contexts/absence/company-shutdown/affected-days.ts` only - see § Multi-Tenancy Convention, „A Betriebsurlaub can name salons“.
- **The leave area has one timeline and one approval place (Issue #840).** `AbsenceTimeline` is the only
  person-by-day absence grid (`leave-one-timeline-840.test.ts`) and `apps/web/src/lib/leave/leave-colors.ts` the only
  leave colour source (`leave-colors-one-place-840.test.ts`). `GET /leave/calendar` decides the detail level per person
  through the #836 visibility rule (`maskCalendarRows`): a foreign row outside the reader's reach has no id, status,
  halfDay, type or § 9, a foreign PENDING row is dropped except under `scope=team` (Issue #1038, owner decision 19.11.2026),
  where it arrives as a masked range flagged `requested: true` (name and period only) and the range answer adds `persons`, every
  person homed in one of the caller's Stammsalons and employed in the window (`homeSalonPersonsDuring`, the #613 rule), so a
  colleague without an absence still has a row, adjacent masked ranges of a person are merged within the same flag (`mergeDayRanges`);
  `from`/`to` (at most 366 days) answers `{ entries, salons }`, and `scope=own|team` serve Mein Bereich and mask every
  foreign row whatever the caller's reach (`GET /leave/plans/:id?view=own` does the same for the planner read and gives a
  foreign wish the period only). Masked ranges are clipped to the requested window before the merge, and a caller with an
  empty `leave-request:read` reach who sends no `scope` is answered as `scope=team`. Leave
  decisions, § 9 cases included, wait only in `/inbox`; old leave URLs are mapped only by `lib/leave/area-tabs.ts`.
  ADR `docs/adr/0001-abweichungen.md`, Eintrag AI.
