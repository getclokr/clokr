---
paths:
  - "apps/api/src/composition/**"
  - "apps/api/src/contexts/**/api/**"
  - "apps/api/src/contexts/scheduling/**"
  - "apps/api/src/contexts/platform/**"
  - "apps/web/src/lib/salons/**"
  - "apps/web/src/lib/dashboard/**"
  - "apps/web/src/lib/shifts/**"
  - "apps/web/src/lib/reports/**"
  - "apps/web/src/lib/leave/**"
  - "apps/web/src/lib/me/**"
  - "apps/web/src/lib/components/team/**"
  - "apps/web/src/lib/stores/**"
  - "apps/web/src/routes/**"
  - "apps/api/src/__tests__/*salon*"
---

Moved verbatim from CLAUDE.md (§ Multi-Tenancy Convention — the salon bullets from Issue #82 onward; the four generic bullets stay in CLAUDE.md).

## Multi-Tenancy Convention

- **The salon context in the web is presentation, never an access boundary (Issue #82, DSGVO
  Art. 32).** `GET /api/v1/me/context` (`requireAuth`, own data, API key → 400) returns the tenant,
  `isMultiSalon` (`isMultiSalonTenant()`, #64), `homeSalonId` and the ACTIVE salons the caller
  reaches — `id` and `name` only. `contextSalonIds()` (`contexts/platform/facade/role-assignments.ts`,
  not re-exported from `index.ts`) is the ONLY place "salons the caller can reach" is computed: the
  managed part from the same building blocks (stored role assignments only, #539) as `resolveAccessReach`, pinned equal over every ZUGEWIESEN key by
  `context-salon-ids-82.test.ts`, plus the salons of the caller's own current or future salon
  assignments. In the web, `$stores/salon-context` holds the selection: `showSalonOptions()` is the
  ONLY place of the #64 rule (options only with more than one active salon in the tenant AND more
  than one reachable), one reachable salon is preselected without a choice, several default to
  "Alle Salons". The stored value (`localStorage` `clokr.salonContext.<tenantId>.<userId>`, removed on
  logout) is re-validated against the fresh list on every load (forced on mount, throttled after
  in-app navigation), and `selectedSalonId()` is the value a view passes as `salonId` (`null` = every
  reachable salon). No endpoint reads a salon context from a header, cookie or session; an endpoint
  that takes `salonId` validates it itself — proof: `salon-context-manipulation-82.test.ts`. The
  tenant-side salon admin (`/admin/salons`, Issue #563) calls `salonContext.load(…, { force: true })`
  after every successful create, edit, deactivate and activate.
- **Opening hours live only on the salon (Issue #563).** `Salon.openingHours` is the only source.
  the tenant-level column `TenantConfig.storeHours` was dropped by the migration `*_drop_store_hours`
  (#638; `RETIRED_TENANT_CONFIG_COLUMNS` in `contexts/platform/api/settings.ts` is empty) and the mirror
  `syncSoleActiveSalonOpeningHours()` is gone. `admin/system` keeps only `shiftStoreHoursMode` (a tenant
  policy, minimal payload `{ shiftStoreHoursMode }`). `/admin/salons` (list and detail, create at
  `/admin/salons/neu` with an explicit Bundesland) uses the tenant API `/api/v1/salons` and the facade
  shared with the operator console — quota (#566), `FEDERAL_STATE_IN_USE`, never delete and the
  identical 404 are unchanged; it is visible with `salon:read` and changes need `salon:manage`. The
  `/shifts` week view dims closed days from `salonOpeningHours` of `GET /shifts/week` (the salons in the
  caller's `shift:read` reach) through `closedDaysFor()` — the one salon in view or the chosen one, a hint
  otherwise, never a merged value. The guard is `store-hours-readers.test.ts` (api, db and web, exactly
  one allowed occurrence). Details: `docs/adr/0001-abweichungen.md` Eintrag L, Nachtrag Phase 563.
- **The dashboard Team block follows the salon context (Issue #84).** The web decides whether to
  filter only through `teamSalonFilter()` (`apps/web/src/lib/dashboard/team-view.ts`): it is guarded
  by `showSalonOptions`, because the store preselects a sole reachable salon and that preselection
  must not turn into a filter (D-11). `GET /dashboard/team-trend`, `/team-week` and
  `/team-upcoming-leave` validate `salonId` in the module-private `resolveTeamSalonFilter()`
  (`composition/dashboard.ts`): the salon must be active, belong to the tenant and lie inside the
  caller's team-overview reach; every rejection is the same 404 body, before any read — the filter
  narrows, it never widens. Attribution under a filter: working time follows the ENTRY's salon
  (closed, valid WORK entries through the tenant-local yesterday, summed with `addWorkingMinutes`),
  absences follow the Stammsalon per calendar day (`homeSalonsForDays()`, Unterbau, D-13). Soll and
  saldo are contract figures and are NEVER split by salon: under a filter they are `null` with
  `sollUnavailableReason` `SALON_FILTER`, and Soll is shown at all only with `overtime:read`
  covering every shown person (`NO_PERMISSION` otherwise, D-17). Unfiltered figures equal
  `/reports/monthly` (`computeMonthReportFigures`, including the snapshot and the Berufsschule
  credit, which no salon receives). Presence status and holidays use ALL of a person's entries, so a
  day worked in another salon is never a false „Fehlt“ (D-15); `workedElsewhere` and `salonId` appear
  in the team-week response only under a filter. The reports follow the salon context since #542 (see the
  bullet below).
  **Scoped callers follow the per-entry rule (Issue #85, D-04/D-06),** which replaces the Phase 84
  "the filter only removes rows" reading for them: on `/team-week`, `/today-attendance` and
  `/team-trend` the population is the Stammsalon persons UNION the persons with an in-scope entry
  (`scopedTimeEntryIds` + `getRecordedWorkEntriesByIds`), contract, leave, absences and holidays
  are read for the Stammsalon persons only, shifts are read for every listed person and shown only
  if `isShiftInScope` admits them (Phase 91b D-11: the shift's own salon or a person in reach,
  never the Stammsalon, so a Springer listed by an in-scope entry sees the reach's own shifts), a
  day whose only shift is out of scope reads exactly like a day without a shift (no `shift`, no
  SHIFT_BASED workday, no due time, no marker), a row listed only by an entry is never „Fehlt“
  (its absence reasons are held by the Stammsalon; an in-scope shift not yet due makes it
  „Geplant“, Issue #548), and hours come only from in-scope entries.
  Time the caller cannot see is a neutral `workedElsewhere` and never a live clock-in. The account
  Ist is used only for a person-month whose every entry is in scope; otherwise the in-scope sum is
  shown and `workedBasis` is `SCOPE_ENTRIES` (Soll then `null`, `sollUnavailableReason`
  `SCOPE_ENTRIES`). Whole-tenant callers run the unchanged statements. The web reads the new values
  in `team-view.ts` only.
- **The employee list follows the master-data rule (Issue #547).** `GET /employees` narrows a scoped
  `employee:read` reach with `resolvePersonScopedEmployeeIds` (the single view's rule) plus the
  caller's own row, and returns `overtimeAccount.balanceHours` only under an `overtime:read` reach
  that covers the person, else `null`. A Salonmanager therefore sees neither a foreign salon's
  people nor their saldo in the list.
- **The Salonansicht (Issue #85, D-08/D-09/D-13).** `GET /time-entries?salonId&from&to` (at most 31
  days, `time-entry:read:ZUGEWIESEN` only) returns every in-scope entry recorded in that salon for
  all persons, Springer included, with no sums. `resolveSalonInReach()`
  (`contexts/platform/facade/salons.ts`) is the ONE validator of a chosen salon - the dashboard's
  team endpoints and the salon view both call it, every rejection is the same 404 body before any
  read, and nothing else may rebuild that check. In the web `/team/time-entries` decides the salon
  only through `teamSalonViewSalon()` (`apps/web/src/lib/dashboard/team-view.ts`), never through the
  raw selection getter; a break-notification link to a person outside the narrowed list opens the
  Salonansicht of the linked month (D-14). A role without saldo rights sees the person view without
  the saldo cards, Ist only (a 403/404 on the saldo reads is a calm state, not an error).
- **The header salon selection applies to the team and planning pages (Issue #558).** `GET
/employees`, `GET /leave/requests`, `/leave/calendar`, `/leave/ical/team`, `/leave/section9` and
  `GET /shifts/week` take an optional `salonId`, checked by `resolveSalonInReach()` against the reach
  of the endpoint's OWN permission before any read (one 404 body for an inactive, foreign, unknown or
  unreachable salon); `GET /shifts/planning-overview` validates it the same way since #558. The
  principle: `salonOnlyReach()` (`contexts/platform/access-context.ts`) is the ONE constructor of a
  salon-only reach, and a filter is the endpoint's own scope resolver evaluated for that reach,
  intersected with the caller's real reach — it only narrows, never widens, and it is presentation,
  never a boundary. People follow the master-data rule (the caller's own row only when it belongs to
  the salon), shifts their own salon, leave/absences/§ 9 cases the Stammsalon on at least one day of
  the row through `filterLeaveRowsToHomeSalon()` (`contexts/absence/salon-leave-attribution.ts`, the
  ONE place; the dashboard's upcoming leave calls it too). Under a `/shifts/week` filter
  `contractSollMinutesByEmp` is `null` with `sollUnavailableReason: "SALON_FILTER"` (Soll is never split
  by salon). In the web a page decides only through `salonPageFilter()` and labels through
  `SalonScopeLabel` (`$lib/salons/page-scope.ts`, `lib/components/team/SalonScopeLabel.svelte`);
  `/team/time-entries` narrows only its person selector (the month stays complete); `/shifts` creates a
  new shift in the selected salon while generate/copy-week act on the whole reach (the dialogs say so).
  Not filtered, each pinned with its reason in `salon-filter-exempt-pages-558.test.ts`: `/inbox`,
  `/shifts/conflicts` (#645 — the filter is not its fix), month close, audit log, configuration pages
  and their pickers, `/admin/salons`, personal pages; on `/reports` the DATEV card, the per-person documents,
  the Urlaubsübersicht and the Verfall-Warnungen (block table in the same test). `GET /leave/section9` has been
  reach-scoped since #644 (PR #646) and the salon filter intersects with that reach; coverage rules per
  salon: next bullet (#647).
- **Coverage rules can name a salon (Issue #647).** `CoverageRule.salonId` is a nullable FK onto `Salon`
  (`onDelete: Restrict`, a Shared-Kernel dependency named on #647); NULL = tenant-wide, which every pre-#647
  rule is (no backfill). `contexts/scheduling/coverage-rule.ts` is the ONE place of the evaluation:
  `coverageSalonInView()` picks the salon whose rules act on `GET /shifts/week` (the validated `salonId` filter,
  else the caller's single person-free `shift:read` reach salon (D-03a), else the tenant's only active salon,
  else none) and `pickCoverageRule()` chooses the day's rule (candidates = that salon's rules plus the
  tenant-wide ones; the specificity ladder is unchanged; within a rung a salon rule beats a tenant-wide one).
  `POST`/`PUT /shifts/coverage-rules` validate a named salon only through `resolveSalonInReach` (one 404), a
  rule of a later deactivated salon stays and is marked (`PUT` re-checks only a changed salon), and `PUT`
  checks a changed `templateId` against the tenant. #647 added no key to the `/week` response (#589 later added `contractWorkDaysByEmp` and per-day `closed` / `contractEmployeeIds`); `/admin/shifts` offers
  the salon only under `showSalonOptions()` and stays exempt from the header filter. Details: ADR
  `docs/adr/0001-abweichungen.md`, section P, Nachtrag Phase 647.
- **A Betriebsurlaub can name salons (Issue #1079).** `CompanyShutdownSalon` (join table, FK onto `Salon`
  `onDelete: Restrict`, a Shared-Kernel dependency named on #1079) lists the salons of a Betriebsurlaub; NO rows = the
  whole Unternehmen (every pre-#1079 row, no backfill). Who is affected on a day is the Stammsalon of that tenant-local day
  (`homeSalonsForDays`, HOME rows only - never `salonForDay`, a Springer homed in an open salon is not booked), and the ONE place
  that rule lives is the pure `contexts/absence/company-shutdown/affected-days.ts` (`shutdownAffectedRuns`,
  `shutdownBookingSegments`, `shutdownScopesConflict`): the #1069 booking (`booking.ts`), the leave planner read and the Bestand script
  all read it - never a second derivation. Without salons it yields exactly the #1069 month segments. Two active Betriebsurlaube
  conflict (409 `COMPANY_SHUTDOWN_OVERLAP`) only when they share a day AND their scopes meet. The routes admit by the reach of
  `company-shutdown:manage`: no salon needs whole-tenant reach (403 `COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN`), every named salon goes
  through `resolveSalonInReach` (one 404 body), an existing row is manageable only when the reach covers all its salons; „Kein
  Urlaubsabzug“ (create, switch to it, and every later write: edit, delete, exceptions) needs whole-tenant reach (403
  `COMPANY_SHUTDOWN_RELEASE_FORBIDDEN`, `canManage` false for a scoped caller, owner decision 25.11.2026).
  A later Stammsalon change re-books the moved person through the reactive decoration `app.companyShutdownHomeSalon` (open months only,
  cancel first, then book). `GET /company-shutdowns/scope` is the source of the web's scope control. Details and the Semantikänderung
  (relation `company-shutdown` Mandant -> Person, Salonmanager template): `docs/adr/0001-abweichungen.md`, Eintrag AM.
- **The roster lists every person and counts contract presence (Issue #589, owner decision 19.10.2026).**
  `GET /shifts/week` lists every plannable person EMPLOYED in the displayed week (the #613 `reportPopulationWhere`
  with the week's instants, whatever the Arbeitszeitmodell); the web keeps those with a contract or a shift as rows
  (`rosterRows()` in `apps/web/src/lib/shifts/roster-rows.ts`). **Every model can receive a shift:** `POST` and `PUT
  /shifts` need a contract (a `WorkSchedule` row, any type) valid on the shift date, else 422 `SHIFT_NO_CONTRACT`
  (`assertEmployeeHasContractOn`; the Phase 47.1 code `SHIFT_INVALID_EMPLOYEE_TYPE` no longer exists, bulk,
  generate-week, copy-week and the Phorest sync never had that gate). **Soll and saldo from shifts stay SHIFT_BASED-only**
  (`contractSollMinutesByEmp` unchanged, nothing under `working-time-account/` moved; a shift never changes a
  non-SHIFT_BASED Soll). **Coverage counts contract presence:** a person counts on a day when listed and employed, the
  contract valid that day is FIXED_SCHEDULE or FLEXTIME, the weekday is in `workDaysSetFrom()` (the ONE workday chain,
  exported through `contexts/absence/index.ts`), the day is no work-location holiday, the person has NO shift that day
  in ANY salon (a shift replaces the presence, so nobody counts twice), availability is available/preferred, the caller
  can read the person's leave and absences (a scoped caller never counts a person whose leave is hidden) and, under a
  salon filter, the Stammsalon on that day (`homeSalonsForDays`) is the chosen salon; MONTHLY_HOURS and SHIFT_BASED
  count only through a shift. Three response fields: per day `coverage[].contractEmployeeIds` (who is counted by
  contract; always a subset of `employees`) and `coverage[].closed`, plus top-level `contractWorkDaysByEmp` (the ISO
  contract workdays of fixed/flex persons, source of a tooltip hint on a shift outside them - never a conflict, never a
  block). **A closed day reads no shortfall:** `closedWeekdaysOf()` / `isCoverageDayClosed()`
  (`contexts/scheduling/coverage-rule.ts`) judge a day closed by the salon in view's opening hours, or - with none in view -
  only when EVERY salon of the caller's reach closes it; `coverageStatus` is then "ok" and `minStaff` keeps the rule
  value. PHOREST-origin shifts of any person stay owned by the sync (`services/phorest/` has no contract-type filter) and
  render like any shift. The own plan (Ich › Dienstplan) names a shift's salon from the salon context and separates
  „Frei“ from „Noch nicht geplant“ (`apps/web/src/lib/me/agenda.ts`). Proofs: `shifts-week-roster-589.test.ts`, the web
  `roster-rows-589` and `agenda-851` tests.
- **The reports follow the salon context (Issue #542).** `GET /reports/monthly`,
  `GET /dashboard/today-attendance`, `GET /dashboard/overtime-overview` and
  `GET /reports/monthly-export/pdf` take an optional `salonId`, validated by `resolveSalonInReach()` against the reach of
  the route's OWN permission(s) (the overview: both `team-overview:read` and `overtime:read`) before any read; every
  rejection is the one 404 body `SALON_VIEW_NOT_FOUND` (`composition/salon-view.ts`), a malformed id is 400. The filter
  only narrows, never widens. `salonViewMemberIds()` (`composition/salon-view.ts`) is the ONE membership rule of a salon
  view (an entry in the salon, or the Stammsalon on a day of the window) for the monthly report, the attendance list
  and the team week; no second one may be added. The monthly report under a filter shows Ist from closed valid WORK
  entries of the salon through tenant-local yesterday and sick/§ 9 days by Stammsalon per day, and withholds Soll,
  saldo, Überstunden, balance adjustment and the priced leave counts (`null`, with `workedBasis`,
  `sollUnavailableReason`, `leaveDaysUnavailableReason`; the keys exist only under a filter). The Saldenübersicht and the
  Monatsexport only narrow WHICH persons appear, by Stammsalon on the endpoint's own Stichtag passed as a CALENDAR day
  (#493; the Monatsexport judges a leaver on the exit day), each person with the whole saldo („Personensaldo, nicht nach
  Salon aufgeteilt“); a person without a Stammsalon on that day appears only unfiltered (no "last Stammsalon"
  fallback). `/reports/monthly` keeps this salon viewpoint (an entry in the salon or the Stammsalon on a day, Soll
  withheld), while the period report lists the Stammsalon persons at the period Stichtag with whole values (owner decision
  19.10.2026, #714); `salonHelperIds` is the entry branch of `salonViewMemberIds`, not a second rule.
  Every Stammsalon reach resolution in `composition/` receives a tenant-local CALENDAR day, never an instant (Issue #679):
  month-bound reads judge a person who left inside the month on the exit day, everyone else on the month's last day, through
  `composition/reach-day.ts` (`resolveMonthReachIds`/`isMonthReachMatch`); `scope-filter.ts` stays unchanged.
  Soll and saldo are NEVER split by salon and DATEV is NEVER filtered (§ 41 EStG). Tests:
  `reports-salon-filter-542`, `dashboard-salon-filter-542`, `monthly-export-salon-filter-542`,
  `report-salon-filter-source-542` (AST: validation before any read, one membership rule, DATEV unfiltered) and the
  exempt-block table in `salon-filter-exempt-pages-558.test.ts`. Known limit: a scoped caller's own reach in the monthly
  report and export is still judged at the month end instant (leaver case, #679).
