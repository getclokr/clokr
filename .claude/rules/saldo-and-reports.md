---
paths:
  - "apps/api/src/contexts/working-time-account/**"
  - "apps/api/src/composition/**"
  - "apps/api/src/contexts/absence/**"
  - "apps/api/src/contexts/platform/employed-in-period*.ts"
  - "apps/web/src/lib/reports/**"
  - "apps/web/src/lib/saldo/**"
  - "apps/web/src/lib/month-close/**"
  - "apps/web/src/lib/dashboard/**"
  - "apps/web/src/routes/**/reports/**"
  - "apps/web/src/routes/**/month-close/**"
  - "apps/web/src/routes/**/dashboard/**"
  - "apps/api/src/__tests__/*report*"
  - "apps/api/src/__tests__/*saldo*"
  - "apps/api/src/__tests__/*month*"
  - "apps/api/src/__tests__/*overtime*"
  - "apps/api/scripts/**"
  - "docs/saldo-anzeige.md"
---

Moved verbatim from CLAUDE.md (§ Saldo Calculation & Monatsabschluss; § Overtime Saldo Calculation (current)).

## Saldo Calculation & Monatsabschluss

Current: recalculated from hire date on every request (does not scale). Target architecture (SaldoSnapshot per month, Jahresübertrag, correction flow) — see GitHub issue #6.

- **Report Soll/Ist/Überstunden has one source (Issue #451, D-03).** `GET /reports/monthly` (the JSON,
  the Stundennachweis PDF and the Monatsexport PDF) reads `computeMonthReportFigures()`
  (`contexts/working-time-account/month-saldo.ts`) exclusively — the composition layer computes no
  Soll of its own. Leave-day counts printed in reports/DATEV go only through `leaveDaysByCodeWithin`
  (`contexts/absence/leave-days.ts`) — the same priced, §9-netted day-counting kernel the absence
  context's own vacation calculation uses, never a separate calendar walk. The paid release days of a
  Betriebsurlaub (Issue #1082) are counted only by `paidReleaseDaysByEmployee`
  (`contexts/absence/leave-days.ts`, priced by `resolveLeaveDays`, never a walk in `composition/`) and reach
  DATEV and the Monatsexport only through `datevPersonFigures`.
- **A closed month is found and named by one rule (Issue #595).** Every MONTHLY `SaldoSnapshot` read
  for a month uses `periodStartWindow()` (two storage conventions exist on production — TZ-converted and
  legacy UTC-naive); several active rows of one month resolve through `monthlySnapshotOrder()`. The month a
  row belongs to is named only by `snapshotMonthOf()` (`contexts/working-time-account/snapshot-period.ts`) —
  the web never reads `periodStart` (`snapshot-period-source-595.test.ts`), the API never derives a month from
  it elsewhere (`snapshot-month-naming-guard-595.test.ts`). A legacy row is READ as closed with its stored
  figures, never rewritten; `scripts/audit-595-legacy-period-start.ts` lists such rows per stage (read-only).
  The bulk lock reads of the facade (`getClosedMonthsForDates`, `getClosedMonthsInRange`) and `sumCarryOverByMonth` use the same window and one row per person and month (Issue #664). The demo seed writes only zero pre-tracking snapshots; the previous demo month is closed by
  `apps/api/scripts/demo-close-previous-month.ts` (the real closer), see `packages/db/README.md`.
- **Team saldo figures and the forecast wording each come from one web module (Issue #588).**
  `apps/web/src/lib/reports/team-saldo.ts` is the ONLY place the team median, the Top 5 plus/minus and the outlier
  rule live: a person counts only if employed today with a live saldo, a contract that is not track-only (#494) and
  recorded time since hire; the others are listed as „ohne Erfassung“ / „nur Zeiterfassung“ / „Saldo nicht
  verfügbar“, never dropped silently, and exited persons keep their own section (#613). `/reports` and the card
  „Salden“ (`TeamSaldoCard`; off the start page since #846 D-04, its new place under Berichte is #895) read it behind
  the same two gates as `GET /dashboard/overtime-overview` (`team-overview:read` AND `overtime:read`). `apps/web/src/lib/saldo/forecast-label.ts` is the ONLY place the forecast wording is chosen, from
  `unconfirmedMonths` and `hasClosedMonth` (computed in `computeOvertimeBalanceBreakdown`, which computes no figure
  differently; additive on the `/dashboard/overtime-overview` rows, `GET /dashboard`, `GET /overtime/:employeeId` and
  the visible branches of `GET /leave/overtime-balance`): „Laufender Monat“ only for exactly one unclosed month. Every
  team saldo renders ±H:MM through `fmtBalance`, one column per value. `team-saldo-one-place-588.test.ts` fails on a
  second median, a row-saldo average, the running-month wording outside the helper, or a forecast call site without
  the value. Details: `docs/saldo-anzeige.md`, `docs/adr/0001-abweichungen.md` Eintrag Q, Nachtrag Phase 588.
- **The open-month chain lives in one function (Issue #681).** The Gesamtsaldo of an open month (the
  cumulative series of `computeMonthSaldo`, hence `closingBalanceMinutes`, the Monatsexport and
  `GET /overtime/month-saldo`) starts at `openMonthCarryInMinutes()` (`contexts/working-time-account/overtime-balance.ts`):
  the last close before the month plus every unclosed month since then (track-only resets, #494), from the
  same chain the live saldo runs, so both agree at the same Stichtag; a month that is track-only on its own
  contract shows 0. No reader adds a carry of its own; closed months are only read. Many persons at once (Issue #696): `openMonthCarryInMinutesForMany` and
  `computeMonthReportFiguresForMany` run the SAME chain and month core, only their inputs come from
  `contexts/working-time-account/overtime-balance.ts` (`ChainSource`: `querySource` for one person, `loadChainSources`
  with every collection read once for many) - a bulk answer is never a second computation, and
  `open-month-carry-bulk-696.test.ts` pins it equal to the per-person function. A `@db.Date` bound inside a
  `ChainSource` filter is cast to its UTC date part (`dayOf`), exactly as Prisma casts it. Known gap: without any
  closed month the live saldo ignores the OpeningBalance (#682).
- **Sick days are counted in one place (Issue #84, D-14).** `sickLeaveDayCounts()`
  (`contexts/absence/sick-leave-days.ts`, exported via `contexts/absence/index.ts`) is the ONLY
  place the sick-day figure is derived: calendar days including weekends, clipped to the range, a
  half day counts 0.5, the attest split, the § 9 shift, sick leave type codes and
  `EFFECTIVE_LEAVE_STATUSES` only, with an optional per-day `countsDay` predicate (the dashboard
  uses it to attribute a day to a salon). `/reports/monthly` (the JSON, the Stundennachweis and the Monatsexport) and the dashboard
  team trend both call it — it used to live in `composition/reports.ts`, a business rule in the
  composition layer. `Absence` rows (imposed absences) never count as sick days.
  Since #713 the kernel also returns `sickDaysByCode` (`SICK`, `SICK_CHILD`), summed on the same line as the
  day count, so every rule above holds for both codes and SICK + SICK_CHILD = the sick days; the period
  report's per-person table and its two lines by kind read it. Overlapping rows of the two codes stay counted
  twice (DATEV and the Monatsexport keep their own workday counts with SICK-first dedup).
  The `/leave` KPI reads `GET /leave/sick-days` (own data, calendar days from this same kernel, Issue
  #595); a request's stored `days` is a workday price and is shown as „Arbeitstage“ for sick types through
  `leaveDaysLabel()` (`apps/web/src/lib/leave/leave-days-label.ts`). DATEV Lohnart counts stay workdays.
- **Who appears in a period report, a status or an overview comes from one rule (Issue #613).**
  `reportPopulationWhere(start, end)` (`contexts/platform/employed-in-period.ts`, exported via
  `contexts/platform/index.ts`) is the ONLY place the population is spelled: employed in the period
  (`hireDate <= end` and `exitDate` null or `>= start`, both bounds inclusive) and never anonymised.
  The bounds are INSTANTS (`Employee.hireDate`/`exitDate` are `@db.Timestamptz`) - pass
  `monthRangeUtc` / `weekRangeUtc` / `dayRangeUtc`, never `monthDateRange`; `isEmployedInPeriod()` is
  its in-memory twin (a team-week day, an overview row). It is read by `/reports/monthly` and the
  Stundennachweis, the leave overview (JSON; one population, one order: last name, first name,
  id), the Monatsabschluss status and year status, the
  Saldo-Übersicht (facade W9 with a required period), today's attendance, the team week, the team
  trend and the overtime trend. The team week and today's attendance additionally list only persons holding a
  contract valid by the period end (`hasWorkScheduleInPeriodWhere`, same module, Issue #576; its two callers are pinned by
  `contract-population-readers-576.test.ts`) - an account without any WorkSchedule row is no team member, while the
  period reports keep it. DATEV and the Monatsexport read the employment core `employedInPeriodWhere` WITHOUT the
  anonymisation clause (§ 41 EStG: the Lohnkonto of a month of employment stays complete). The
  carry-over warning list and its cron keep their BUrlG `exitDate: null` rule and only exclude
  anonymised persons. `user.isActive` is a LOGIN state and never selects persons:
  `apps/api/src/__tests__/report-population-guard-613.test.ts` fails on it in `composition/` and
  `contexts/working-time-account/` and on a registered reader that stops calling the rule; its only
  exceptions are the auto-close cron and the deferred close (owner decision 16.10.2026, follow-up
  #668, measured read-only by `scripts/audit-613-month-close-population.ts`) and two
  notification-recipient lookups. The Saldo-Übersicht keeps an exited person (section „Ausgetreten,
  offener Endsaldo“, newest 50 exits plus a total count) until the exit month is closed - decided
  once by `finalSaldoOpen()` in Arbeitszeitkonto from the latest closed snapshot, with the person's
  reach judged at the exit day. The Monatsabschluss status computes missing days only inside the
  employment window the close writer uses (`statusEmploymentWindow()`, bound by parity tests).
- **Two report documents; the Monatsexport is the human-readable twin of DATEV (Issue #617).** `GET
/reports/monthly-export/pdf` (`report:export:ZUGEWIESEN`, one PDF for all persons of a month): its
  persons come only through `selectMonthlyExportPersons` (`composition/reports.ts`) on the shared DATEV
  loader (`loadDatevMonth`, the employment core `employedInPeriodWhere`, § 41 EStG) — the ONE place the
  optional `salonId` of #542 narrows the persons (by Stammsalon on each person's own Stichtag, see the #542 bullet
  below); DATEV itself is never narrowed; absence counts and „DATEV-Std.“ come only from
  `datevPersonFigures` (Arbeitstage and Normalstunden, the DATEV values, since #1082 also the paid release days of a
  Betriebsurlaub, the optional DATEV row of `TenantConfig.datevFreistellungNr` and the column „Freistellung“); Soll, Ist, Saldo, Status and the
  Gesamtsaldo (`closingBalanceMinutes`) come only from `computeMonthReportFigures`; the section
  „Urlaubsjahr“ comes only from the vacation facade at the Stichtag (`asOf` = last day of the exported
  month, or tenant-local yesterday in the running month, so a re-export prints the same figures;
  `availableDays`, `takenDays`, `approvedUpcomingDays`, `pendingCreatedByAsOfDays`); the document has no
  day rows. `GET /reports/monthly/pdf` (the Stundennachweis, one person) is the ONLY document with a day
  list — entries in start-time order plus absence periods and holidays, labels via `DISPLAY_NAME`, never
  `leaveType.name`. The Firmen-PDF, the Urlaubsliste, the Urlaubs-PDF and the Urlaubsübersicht-PDF no
  longer exist and must not come back as a second document. PDF numbers are written only through
  `composition/pdf-format.ts` (H:MM from minutes, decimal comma, Tag/Tage) and footers only through
  `writeFooter`; `pdf-output-guard-617.test.ts` (no `.toFixed`, no locale formatter, brand colour) and
  `monthly-export-617.test.ts` (every figure pinned to DATEV and `/reports/monthly`) name the proofs.
  The Urlaubsübersicht (`GET /reports/leave-overview`) lists VACATION entitlements only, an allow-list by
  leave type code in the code, never a deny-list of sick types. Sick days in the Monatsexport are
  lawful because its purpose is payroll preparation with DATEV's audience and permission (ADR
  `docs/adr/0001-abweichungen.md`, Eintrag Q, Nachtrag Issue #617).
- **The period report sums, never recomputes (Issue #612).** `GET /reports/period`
  (`composition/reports-period.ts`, `report:read:ZUGEWIESEN`) is the ONE period route of the reports page. Per month it
  runs the `/reports/monthly` assembly through the exported helpers of `composition/reports.ts` (population #613,
  Stammsalon reach judged on a calendar day via `reach-day.ts` #679, `computeMonthReportFigures`,
  `computeEmployeeSummary`); a row and the KPIs are sums of those months, the months run strictly one after the
  other, at most 12, none in the future (400). Since #985 an open month contributes the account's to-date figures
  (`MonthReportFigures.toDate`; the running month through tenant-local yesterday) and the opening is the carry into the
  first month — a closed first month's `MonthReportFigures.carryInMinutes` (stored `carryOver − balanceMinutes`, absent
  for a track-only close by `isTrackOnlySchedule()`, which then keeps the previous month's `closingBalanceMinutes`), an
  open one the previous month's `closingBalanceMinutes` — so Beginn + Σ Saldo Zeitraum = Ende (proof
  `reports-period-identity-985`); `/reports/monthly` keeps the whole-month Soll. Closing = the last
  month's, which since #681/#682 equals the live saldo at the same Stichtag; the confirmed/open split of the closing is given
  only where it is exact (last month closed, or open right after a closed one), else `null`. Soll and saldo appear only where `overtime:read` covers the person in every shown month
  (`NO_PERMISSION` otherwise, Ist stays). **Under a salon filter the answer has ONE circle (Issue #714, owner decision
  19.10.2026):** the persons homed in the salon at the period Stichtag (`resolvePeriodReachIds` in `reach-day.ts`: the exit
  day for an exit inside the period, else the period's last day; one 404 validated before any read), each with the whole
  figures of the unfiltered path (Soll and saldo withheld only for `NO_PERMISSION`, never split by salon; the envelope
  carries `personBasis: "HOME_SALON_AT_PERIOD_END"`). The salon viewpoint is separate and never a saldo: `salonWorkedMinutes`
  (closed valid WORK entries of the salon through tenant-local yesterday, month, row and KPI) and `helpers` (persons outside
  the circle with entries in the salon, found by `salonHelperIds`, names and hours only, no drill-down).
  `withoutHomeSalonCount` names the remainder (persons of the caller's reach whose Stammsalon at their Stichtag is null or an
  inactive salon); for whole-tenant callers Σ over the active salons + that remainder = the unfiltered answer (a scoped caller
  with a mid-period mover can differ). The vacation tables list the same persons as the rows, the CSV lists the rows. Vacation = the `/leave-overview` assembly at each touched
  year's Stichtag (the last period day in the year, at most tenant-local yesterday), filtered by Stammsalon at the
  period end, plus the Verfall facts. `GET /reports/period/csv` (`composition/period-csv.ts`, `report:export`) serves
  the same assembly as a file and writes one `EXPORT` audit row before the bytes. Every row carries `absence`, the
  person's counts per leave-type code (ten codes: Kalendertage for SICK/SICK_CHILD, Berufsschultage from
  `vocationalSchoolDayCount()` — the #448 definition — and Arbeitstage from the priced kinds of
  `computeEmployeeSummary`); „Abwesenheiten nach Art“ is built from those rows (separate SICK and SICK_CHILD lines, no
  Berufsschule line); `GET /reports/period/csv?table=absences` serves the table with all columns, audited as
  `PERIOD_ABSENCES_CSV` (#713). `/reports/monthly` is not edited
  (`reports.ts` differs from main by `export` keywords and two additive return fields of
  `computeEmployeeSummary`, #713). The web reads and writes the URL
  (`/reports?from&to&tab[&salonId][&person]`, the contract #591 links into) only through
  `$lib/reports/period-state.ts` and sums nothing itself. Never add a second period computation, a period field to
  `/reports/monthly` or a Soll/saldo the account did not state. Proofs: `reports-period-612`, `-sums-612` (row = Σ months
  = `/monthly` = Monatsexport = live saldo), `-vacation-612`, `-salon-612`, `-home-salon-714` (3 salons, a Springer, a person without Stammsalon: Σ parity, no
  Scheinminus), `-reach-612`, `-csv-612`, `period-csv-612`, `-absences-713` (per person SICK + SICK_CHILD = `sickDays`, Σ persons = „nach Art“ = `kpis.sickDays`, filtered and unfiltered, reach),
  `-perf-612` (a 60 s regression ceiling; the measured cost is ~13 ms per person-month, the bulk-read fix is #688),
  `reports-hr-86` (day-free key paths), the web `reports-period-page-612` and the e2e `reports-period.spec.ts`.
  `docs/adr/0001-abweichungen.md`, Eintrag Q, Nachtrag Phase 612, Nachtrag Phase 714 and Nachtrag Phase 713.
- **`@db.Date` columns get calendar-day bounds, never a month/week instant (Issue #493).**
  `monthRangeUtc()` / `weekRangeUtc()` return tenant-local boundaries as UTC instants (local 1 Oct
  00:00 = `2026-09-30T22:00Z`); a Prisma filter or a JS clip on a `@db.Date` column
  (`TimeEntry.date`, `LeaveRequest`/`Absence` `startDate`/`endDate`, `Section9Credit` dates,
  `Shift.date`, `PublicHoliday.date`) against them takes in the previous local day. Month/week reads
  of those columns use `monthDateRange()` / `weekDateRange()`
  (`contexts/working-time-account/timezone.ts`, via its `index.ts`), or `monthDayBounds()` where
  only the instants are at hand — as a NEW variable, never by reassigning the instants. The instants
  stay for `@db.Timestamptz` columns (`Employee.hireDate/exitDate`, `WorkSchedule.validFrom`), the
  `SaldoSnapshot.periodStart` key (changing it orphans every closed month) and Stichtag lookups. The
  saldo/close paths still pass instants to the leave fetch on purpose — `closeEmployeeMonth` clips
  the rows, and changing the fetch could move a stored SHIFT_BASED saldo; leave them. Outputs
  produced before the fix: `apps/api/scripts/audit-493-month-boundary-leak.ts`.
- **Berufsschule has priority, in one place (Issue #1080).** In `closeEmployeeMonth` no row other
  than a VOCATIONAL_SCHOOL absence credits or claims a Berufsschultag: approved leave of every type
  (#448, D-03) and every other `Absence` code (OTHER, MATERNITY, PARENTAL and later ones such as
  COMPANY_SHUTDOWN) give way to it, so the day's Soll relief is the Berufsschule credit alone and a
  day reduces the Soll exactly once. The rule is decided only by `bsDayPriority()` in
  `contexts/working-time-account/close-employee-month.ts`; every saldo path (manual close, cron,
  recalc, live saldo, open month, reports, dashboard) goes through this core. Pinned by
  `close-employee-month-bs-absence-1080.test.ts` (equivalence oracle per code and schedule type,
  AST one-place guard) and the golden cells `az-*-38-5-bs_absence`. Closed months keep their stored
  figures; `scripts/audit-1080-bs-day-absence-double-soll.ts` lists the affected months read-only
  (ids and minutes), and a correction runs only through the month correction of #599. The roster
  Planungs-Soll in `scheduling/api/shifts.ts` is not this core (follow-up).

## Overtime Saldo Calculation (current)

`Saldo = Worked − Expected` over (hire-date or month-start) → yesterday. The live saldo never includes today, not even a clocked-out today: a clock-out for a lunch break closes the entry exactly like the end of the day, so a closed entry does not mean the day is settled (Issue #438). Leave/holidays/absences reduce expected, clamped to effective range. The chain starts where every close path and the month series start it — `getCarryOverBase()` (`contexts/working-time-account/carry-over-base.ts`): the last closed month's stored carryOver, and only without any closed month the active `OpeningBalance` (Issue #682; before, the live saldo ignored it until the first close). Never re-read the OpeningBalance when a closed month exists — the first close already put it into its carryOver. "Bestätigt" (`confirmedMinutes`) stays the stored closed carry, so an OpeningBalance without a close is part of the forecast. Persons whose live saldo moved: `scripts/audit-682-opening-balance-live-gap.ts` (read-only, ids and minutes). Recalculated per GET /overtime/:employeeId. Will be replaced by snapshot-based calc (see Saldo Calculation & Monatsabschluss above).
