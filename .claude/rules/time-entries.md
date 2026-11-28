---
paths:
  - "apps/api/src/contexts/time-tracking/**"
  - "apps/api/src/services/clock/**"
  - "apps/api/src/composition/**"
  - "apps/web/src/lib/breaks/**"
  - "apps/web/src/lib/dashboard/**"
  - "apps/web/src/lib/time-entries/**"
  - "apps/web/src/routes/**/time-entries/**"
  - "apps/web/src/routes/**/dashboard/**"
  - "apps/api/src/__tests__/*time-entr*"
  - "apps/api/src/__tests__/*break*"
  - "apps/api/src/__tests__/*travel*"
  - "apps/api/src/__tests__/*clock*"
  - "apps/api/scripts/**"
  - "packages/db/prisma/**"
---

Moved verbatim from CLAUDE.md (§ Time Entry Rules).

## Time Entry Rules

- **Several entries per day** per employee, never overlapping (Issue #70): each entry carries its own salon; multiple breaks are allowed within an entry
- Break model: `Break[]` records with startTime/endTime (legacy: `breakMinutes` integer)
- **The running break is a server state (Issue #596, #845).** `TimeEntry.breakStartedAt` marks the break of an OPEN entry and is set and cleared ONLY by `resolveBreakEvent()` (`services/clock/resolver.ts`, decision `decideBreak()` in `state-machine.ts`), reached through `POST /time-entries/:id/break` (`{ action: start|end }`, the guard of `POST /:id/breaks`); ending it writes an ordinary `Break` row, and the resolver's STOP closes a running break first, so a closed entry never carries one. Saldo, § 4 evaluation and reports never read the column. The day goal of the clock is `GET /dashboard` `today.sollMinutes` (today's Soll from the account core, `computeWeekProgress`), never a fixed 8 h.
- `openAdd()` on frontend: with salon options (`showSalonOptions`, multi-salon tenants) it opens a NEW entry whose start is preset to the day's latest end; without them it still opens the day's existing entry for editing. A calendar cell with one entry opens that entry, a cell with several switches to the list focused on the day
- API POST and PUT answer 409 when the interval overlaps another non-deleted entry of the employee (worded by the caller's reach, see "Several entries per day") or when a second OPEN entry would start the same day; a locked day or closed month stays 403
- **Every entry carries a required `salonId`** (FK onto `Salon`, `onDelete: Restrict`, Phase 68b / issue #68), decided by `resolveEntrySalon()` in `apps/api/src/contexts/time-tracking/entry-salon.ts` — the only place this rule lives: an explicit, active salon of the same tenant on manual entries, corrections, Zeitnachträge and the CSV import (400 `SALON_INACTIVE` when deactivated, 404 indistinguishable for a foreign or unknown id); otherwise `salonForDay()`, then the tenant's default salon, 409 `NO_ACTIVE_SALON` if none exists. Since Issue #87 the web clock-in (`POST /time-entries/clock-in`, optional `salonId`, never null) passes an explicit salon to `resolveEntrySalon()` (same 400/404 rules), while WIFI takes no salon input. **An NFC terminal key may be bound to one salon of its tenant (Issue #541)**: `TerminalApiKey.salonId` (nullable, FK onto the Unterbau `Salon`, `onDelete: Restrict`, an approved Shared-Kernel Erweiterung). The `/nfc-punch` adapter passes the bound salon as the explicit salon only while it is active, so the #70 resolver rules apply unchanged (a finished day in another salon starts a NEW entry, the same salon re-opens, an open entry is closed); an unbound key, a binding to a since-deactivated salon and WIFI take no salon input (today's rule, one warn log, never a refusal), and a deactivation race (resolver answers `SALON_INACTIVE`) retries ONCE without the salon so a punch is never lost (§ 16 Abs. 2 ArbZG). The rule lives only in `apps/api/src/contexts/time-tracking/terminal-salon.ts` (`terminalPunchSalon`, `resolveTerminalPunch`, `validateTerminalSalon`); the resolver never reads the binding and the terminal body carries no salon. The binding is set on `POST /terminals` and changed or removed by `PATCH /terminals/:id` (`terminal:manage`, audited with old/new `salonId`, foreign and unknown salon the identical 404, inactive salon 400 `SALON_INACTIVE`, a revoked key 409 `KEY_REVOKED`, an unchanged value 200 without audit, never gated by `HARDWARE_CLOCK`); deactivating a salon neither unbinds nor is blocked by a binding (`GET /terminals` shows `salonActive: false`). Proofs: `nfc-punch-salon-binding-541`, `nfc-punch-salon-race-541`, `terminals-salon-541`, `terminal-salon-migration-541`; ADR `docs/adr/0001-abweichungen.md` Eintrag AA, Nachtrag Phase 541. The preselection and whether a choice is offered come only from `clockSalonChoice()` (`apps/api/src/contexts/time-tracking/clock-salon-choice.ts`, served by `GET /time-entries/clock-salon`): a booked day names its salon (a finished day additionally offers the other active salons); at most one active salon, or exactly one current/future assignment salon (`currentAndFutureAssignmentSalonIds()`, Unterbau) equal to today's pattern salon, offers no choice; otherwise a choice preselected with `salonForDay()`. A deviation is never an error, and the #82 salon context never decides the clock salon. Re-clocking without a salon, or in the salon of the day's latest-ending entry, reopens that entry and never changes its salon; an explicitly different active salon starts a NEW entry (Issue #70) unless the day or month is locked (`MONTH_LOCKED`) or the instant lies inside or before another closed entry of the day (409 `ENTRY_OVERLAP`). `PUT` may change the salon (never on a locked entry, never re-derived from a changed date). The salon hangs on the entry, not the day.
- **Several entries per day (Issue #70, `docs/adr/0001-abweichungen.md` entry AA).** The database guarantees it:
  exclusion constraint `TimeEntry_no_overlap_closed` (closed, non-deleted entries of one employee never overlap;
  `btree_gist`, half-open `tstzrange`) and partial unique index `TimeEntry_employeeId_date_open_unique` (at most one
  open entry per employee and day). Both are hand-written because Prisma models neither; the CI drift check stays empty.
  `lockEmployeeForEntryWrite()` (`contexts/time-tracking/entry-write-lock.ts`) is the ONE Employee row lock and the FIRST
  statement of every transaction that creates or moves an interval (POST, PUT, revalidate, clock resolver, Nachtrag
  approval, CSV import), followed by the in-transaction overlap re-check. `overlapMessageForCaller()`
  (`entry-overlap-error.ts`) is the ONE wording rule for an overlap 409: the detailed text only for the person
  themself, a whole-tenant `time-entry:read` reader or a reader whose reach contains the conflicting entry, a neutral
  text for everyone else (a database refusal is always neutral). Database refusals are recognised structurally
  (`P2039` + `23P01`, `P2002` + index name), never by message; an inverted row (SQLSTATE `22000`) is deliberately not
  mapped to an overlap. `openEntryOf()` / `latestEndingClosed()` (`contexts/time-tracking/day-entries.ts`) are the ONE
  choice of "the entry of the day" a clock acts on (both skip a TRAVEL row, Issue #92, and a row coupled to a pending Zeitnachtrag, Issue #657 — such a row also
  shadows every row ending before it, so the clock starts a new entry); consolidation never merges across
  salons, never across a travel entry and never across a row coupled to a Zeitnachtrag (guard `retro_row`, Issue #657). Run `apps/api/scripts/audit-70-entry-overlaps.ts` (read-only) before deploying
  (`docs/migrations.md`, "Phase 70b"). Never re-create a one-entry-per-day rule — not as an index, a check or a
  comment. A Zeitnachtrag is per interval (Issue #657): `findOverlappingRetroRequest()`
  (`contexts/time-tracking/retro-request-overlap.ts`) is the ONE place that decides whether a new request overlaps a pending
  request of the same day (only PENDING ones count: a decided request is no open question, and a real collision with a recorded time is the entry overlap rule's job; half-open; a request without times covers the whole day; 409 `RETRO_REQUEST_OVERLAP`), run
  under `lockEmployeeForEntryWrite()` on both creation paths; the entry-first path keeps its entry re-check, the
  correction proposal (`POST /retro-entry-requests`) has none because it overlaps the entry it corrects.
- **Presence and working time come from one function (Issue #79).** `entryDurations()` and its
  fold step `addWorkingMinutes()` (`apps/api/src/contexts/time-tracking/entry-durations.ts`,
  exported via `contexts/time-tracking/index.ts`) are the ONLY place presence time (end − start)
  and working time (presence − the stored `breakMinutes`) are computed. Both are derived, never
  stored — no column, no migration, a locked month cannot drift. The values are exact minutes,
  unrounded and unclamped: a caller rounds or clamps around the call where it did before. The
  auto-break is never re-applied at read time — what the write path stored is what counts. An open
  entry is 0/0 in the kernel and `null` in `GET /time-entries` (`presenceMinutes`/`workingMinutes`
  per item; those are rounded per-entry display values that also cover invalid and non-WORK rows —
  never total them, period totals come from `/summary`). `GET /time-entries/summary` (`employeeId`, `from`, `to`, at most 366 days) sums
  presence, working time and breaks over the saldo's own entry set (T1: closed, valid, non-deleted
  WORK entries), so its `workingMinutes` equals the Ist the account counts from recorded entries
  (a scoped manager gets the sum over the entries in scope). It is NOT the account's full month
  Ist: the account additionally adds the Berufsschule credit (Azubi) and clamps entries to the
  hire/exit span, the summary does neither — never assert "same number" for those employees. `addWorkingMinutes`
  keeps the legacy association of the left folds (`(sum + presence) − break`) on purpose — never
  simplify it to `sum + workingMinutes`, that changes the last bit for millisecond-precision rows.
  `apps/api/src/__tests__/working-time-formula-one-place-79.test.ts` fails on an inline copy. The
  JArbSchG pre-write plan values (`plannedNetMin…`, `correctedNetWorkMin`) and shift netto
  (`scheduling/shift-netto.ts`) are deliberately different calculations and stay as they are.
- **A person's day status comes from one function (Issue #587).** `resolveDayStatus()`
  (`apps/api/src/contexts/time-tracking/presence.ts`, exported via `contexts/time-tracking/index.ts`) is the
  ONLY place `isObligatedWorkday`, `isDayDue` and `resolvePresenceState` are combined. `GET
/dashboard/team-week` and `GET /dashboard/today-attendance` both call it, with inputs built by the same
  module-private person-day helpers of `composition/dashboard.ts`: the leave of the day (PENDING included, a
  non-pending row wins), the Berufsschule displacement (rule owned by Abwesenheiten), the first in-scope shift
  (`isShiftInScope`), the contract valid on that day (not the newest one), the stand-ins for hidden time (#85)
  and the entry-only rule (#548); "today" is read from the clock once per request. The definition of a workday
  is unchanged and stays in `presence.ts`, next to the function (a module of its own would join the measured import cycle). `expectedStart` (shift start, tenant-local `HH:MM`) and
  `lateMinutes` (whole minutes since the shift start, only for a "missing" row of today with a shift) exist on
  the attendance row ONLY - the team-week shape is frozen by `dashboard-team-week-frozen-84` - and no start
  time is invented for a day without a shift, so a person with a fixed schedule and no shift reads "scheduled"
  today and "missing" only for past days. `day-status-one-function-587.test.ts` fails on any other caller of
  `resolvePresenceState` and on any `isDayDue`/`isObligatedWorkday` caller (its register holds one entry since #670, the frozen Monatsabschluss detector; #670
  moved `GET /dashboard/my-week` - its values kept through the mapping in `composition/my-week-status.ts` - and the
  `GET /dashboard/open-items` gap list onto the same function: a past day is named missing iff its status is „Fehlt“,
  except a day with only invalid entries, which `invalidEntries` already counts; the Monatsabschluss detector
  `find-missing-workdays.ts` is unchanged). The web words a status only through `$lib/dashboard/day-status-label.ts`, and a
  team-week cell links to `/team/time-entries?employeeId&date` for callers who may open that page. Details:
  `docs/adr/0001-abweichungen.md` Eintrag P, Nachtrag Phase 587.
- **Activity kind is an evaluation dimension, never working-time arithmetic (Issue #81).**
  `TimeEntry.activityKind` (`UNSPECIFIED` | `PRODUCTIVE` | `SETUP_CLEANING` | `TRAVEL`, default
  `UNSPECIFIED` for existing and new rows — no classification is invented; `TRAVEL` is entry-level only,
  never a share, see the #92 bullet) is the kind of the entry's remaining working time; `TimeEntryActivityShare` rows (one per kind, whole minutes ≥ 1, never `UNSPECIFIED`,
  never the entry's own kind, `onDelete: Cascade` like `Break`) allocate parts of it to another
  kind. `activityMinutes()` (`contexts/time-tracking/activity-minutes.ts`, via `index.ts`) is the
  ONLY per-kind derivation — it reads `entryDurations()`, nothing is stored;
  `validateActivityState()` (`activity-shares.ts`) is the ONLY place Σ shares ≤ working minutes is
  enforced (409 with `maxShareMinutes`, never clamped) — PUT, POST (automatic break planned once
  before the write), `POST /:id/breaks`, revalidate and the retro approval call it. Written only
  through `POST`/`PUT /time-entries` (no own route or permission); an activity-only PUT is not a
  correction (no `CORRECTION` source, no Begründung, still audited and lock-bound). Clock paths write
  no classification; a clock re-open or a consolidation first turns a classified remainder into an
  explicit share (`materializeRemainder()`), so later time stays `UNSPECIFIED`, and a merge that
  would soft-delete an allocated entry is skipped. `GET /time-entries/summary` returns
  `activityMinutes` (optional `salonId` narrows the whole body; foreign or unknown salon → the same 404) — minutes only, never amounts, rates or ratios. The working-time account, reports and the day
  kernel never read it (`activity-kind-saldo-isolation-81.test.ts`); saldo equality:
  `activity-kind-saldo-equality-81.test.ts`. UI and tenant switch (default off): #529.
- **Travel between two salons is a time entry (Issue #92).** Details: `docs/adr/0001-abweichungen.md` entry AB. A
  travel row is an ordinary closed WORK row of `activityKind = TRAVEL` — § 2 Abs. 1 ArbZG, BAG 12.12.2012 – 5 AZR
  355/12 (a trip between two work sites on instruction is working time; home to the first or from the last salon is
  not). `salonId` is the DEPARTURE salon, `travelToSalonId` the ARRIVAL salon (a new FK onto the Unterbau `Salon`,
  `onDelete: Restrict`, an approved Shared-Kernel Erweiterung). The kernels (`entryDurations()`, `evaluateDayBreaks()`,
  `evaluatePlacement()`), the saldo and T1/T2 are UNCHANGED and read no travel field: the trip simply is working time
  between two entries. `validateTravelEntry()` (`contexts/time-tracking/travel-entry.ts`) is the ONLY place of the
  write rule — both salons of the tenant (identical 404 for a foreign or unknown id), reach over every entry of the
  day, the trip lies between a non-travel entry in the departure salon and one in the arrival salon (pending Zeitnachtrag
  rows never anchor; so home and back are not recordable), no overlap with a recorded `DayBreak`; the kind is DERIVED
  from the destination, never sent by a client, immutable after create, and a trip carries no break and no share.
  `checkTravelNeighbours()` is the ONLY neighbour check and runs in every writer (POST in all branches, PUT, DELETE,
  break routes, revalidate, Zeitnachtrag approval, CSV import): no write may leave a trip without its two
  entries (409 `TRAVEL_NEEDS_NEIGHBOUR`). The CHECK `TimeEntry_travel_shape_check` (hand-written; Prisma models none)
  is the database backstop of the shape. `latestEndingClosed()` skips TRAVEL (defence in depth: the write rules make a
  trip the latest-ending row impossible), consolidation never merges into or across a trip, `resolveDayState()` in the
  web mirrors the skip. A trip is never recordable as a Zeitnachtrag (409 `TRAVEL_NOT_AS_RETRO_REQUEST`; #657 made the
  Zeitnachtrag per interval and kept this refusal), by CSV
  or by a clock event. Evaluation is separate and only through `activityMinutes.TRAVEL` of `GET /time-entries/summary`
  (module `ANALYTICS`, departure-salon attribution; recording is NEVER gated by a package and is exempt from the #529
  tenant switch); reports, PDFs and DATEV show a trip as ordinary working time. Recording a trip changes the day's
  snapshot, so an existing `DayBreakAck` for that day goes stale and must be re-acknowledged (#80 mechanism, no new
  rule). The list rows carry `travelToSalonName` next to `travelToSalonId` (display vs. control value). Guards:
  `travel-saldo-isolation-92.test.ts` (AST, sibling of the #81 guard: no saldo, kernel, composition or holiday file may
  name a travel field or `travel-entry`; the T1/T2 facade `facade/time-entries.ts` has exactly ONE allowed import,
  `checkTravelNeighbours` + `TravelRefusalError`, for the CSV import writer) and `travel-saldo-equality-92.test.ts`
  (a trip equals an ordinary entry of the same times on every figure surface). Since #660 `GET /day-breaks/checks`
  offers each cross-salon gap of a day with an UNCLEAR finding as a trip (`travelOffers`: the exact gap, departure =
  salon of the entry before, arrival = salon of the entry after), built only in
  `contexts/time-tracking/travel-offer.ts` from the kernel's own gaps and the write rule's own anchor check, never on a
  redacted or locked day, never on a gap touching a trip or a pending Zeitnachtrag row, on the person's own day only
  inside the retro window; who sees it is decided by `travelWriteCoversDay()`, the ONE reach rule
  `validateTravelEntry()` also calls, and the action is the unchanged `POST /time-entries`. The web re-loads the day
  check of that person and day right before writing and posts only if an offer with the identical interval and salon
  pair is still served (`postOfferIfStillServed()`, else a toast and a reload); the remaining race and any other
  refusal are the write rule's answer, which checks anchors, overlap and day breaks but does not bind the interval to
  the offered gap. UI only for tenants with salon choice (#64 gate). Never add a second travel validator, a second reach
  rule for the offer, a travel field to a figure file or a travel share.
- **Breaks are checked per day, across salons (Issue #80).** `evaluateDayBreaks()`
  (`apps/api/src/contexts/time-tracking/day-break-rule.ts`) is the ONLY place the day-level § 4
  rule and the § 3 day sum over several entries live — `checkArbZG`, the day-break routes
  (`api/day-breaks.ts`), the month-close detector (`cross-salon-days.ts`) and the next-day cron all
  call it, and `day-scope.ts` (`dayCoverage()`) is the only place "scope over every closed entry of a
  day" is decided. It sums all closed WORK entries of the day regardless of salon; a gap between
  entries in DIFFERENT salons never counts as a break (travel is working time; a recorded travel entry, #92, fills
  the gap as an ordinary work block), a same-salon gap
  of ANY length does (Issue #523: the former 120-min cap is gone, § 4 ArbZG has no maximum for a
  Ruhepause, BAG 25.02.2015 – 5 AZR 886/12 Rn. 21; amendment register
  `fixtures/day-break-equivalence-80-amendments.json`). A break lying in a gap is a `DayBreak` (employee + date, no salon, never on an
  entry, never in `TimeEntry.breakMinutes`, never reduces working time — the saldo is untouched, an
  AST guard fails if a saldo file references the detector or the models). On a cross-salon day only a
  current `DayBreakAck` waives (an entry-level WAIVED does not); an ack whose stored snapshot no
  longer matches the day is stale (a stale, malformed or revoked ack never lets a day pass). Only a
  manager with `time-entry:update:ZUGEWIESEN` scope over EVERY entry of the day may acknowledge, never
  their own day; § 3 over the day sum is shown, never acknowledgeable. Acknowledging dismisses the
  open `BREAK_CROSS_SALON_VIOLATION` notices of that employee day for every recipient (reactive,
  after commit); a revoke does not resurrect them, because the cron dedupes on ANY existing row,
  dismissed or not. `GET /api/v1/day-breaks/checks` is the one read endpoint of every UI place and
  redacts by reach (partial scope: one neutral hint only - no totals, no finding category, no
  sum-bearing text, built from a number-free whitelist object; Issue #85 D-07). The
  month close blocks only under `blockMonthCloseOnUnconfirmedBreak`, for every schedule type, and
  never edits the saldo. The 09:00 (tenant time zone) cron (Feature 10 of the attendance checker)
  notifies once per recipient, employee and day for yesterday and the two days before it (3-day
  catch-up), full text only for recipients whose own reach covers the whole day (every other recipient
  gets the same neutral text as the redacted day check, title and mail subject included; Issue #85
  D-07). For a day with one
  entry every result equals the pre-80 behaviour, proven by the frozen-copy
  equivalence test (`day-break-equivalence-80.test.ts`; its frozen fixture is never edited, and a deliberate
  behaviour change enters only through the amendment register
  `fixtures/day-break-equivalence-80-amendments.json` with rule, reason and issue — #523 is the first).
  Since D-22 the kernel additionally returns the day's breaks as intervals with their source
  (`entry-break`, `day-break`, `same-salon-gap`, `unplaced-entry-break` = legacy `breakMinutes`
  without position, never placed), the gaps and the work blocks between breaks; Phase 80 warnings
  read only the minute sums, and § 4 Satz 2/3 are evaluated on that view inside the same kernel
  (next bullet, #511), never as a second evaluation elsewhere. The month-close detector is
  `break-finding-days.ts` (renamed from `cross-salon-days.ts`; wire fields `breakFindingDays` /
  `requiresBreakFindingAck`) and the cron emits `BREAK_CROSS_SALON_VIOLATION` or
  `BREAK_PLACEMENT_VIOLATION` per day. Details and the Shared-Kernel dependency:
  `docs/adr/0001-abweichungen.md` Eintrag X.
- **Break placement is checked in the same kernel (Issue #511).** `evaluatePlacement()`
  (`contexts/time-tracking/day-break-placement.ts`, called by `evaluateDayBreaks`) is the ONLY place
  § 4 Satz 2/3 ArbZG and § 11 JArbSchG are evaluated; the thresholds live once in `break-regime.ts`
  (`BREAK_REGIMES`). The regime is an input of the kernel, never read inside it:
  `breakRegimeFor(isMinorAtDate(birthDate, workDate))` (`contexts/absence/minor-at-date.ts`,
  fail-open to § 4 ArbZG; an AZUBI without a birth date gets a note in the finding). A break
  segment counts only if it is at least 15:00 exactly, lies inside the work period and touches
  neither the first start nor the last end (minors: also not in the first or last hour); a segment
  that does not count is working time for the compliance figure only, the saldo and
  `entryDurations()` stay untouched. A work block above 6 h (minors 4.5 h) without a counting
  segment is a finding independent of Satz 1. Legacy `breakMinutes` without Break rows give the
  hint `BREAK_POSITION_UNKNOWN`, never a violation, never a marker, notice or month-close block. A
  cross-salon gap is evaluated worst case and best case: `certainty` `VIOLATION` or `UNCLEAR`
  („Klärung nötig: Fahrzeit oder Pause?“), resolved only by a recorded `DayBreak`, a recorded travel entry (#92: the
  gap is then work time, no gap is left to judge) or an acknowledgement. The acknowledgement covers every day with an ackable finding
  (`hasAckableFinding()`, single-salon days included), its snapshot carries a placement key, and the
  web computes no § 4 at all (`GET /day-breaks/checks`, `POST /day-breaks/preview`; source guard
  `apps/web/src/lib/breaks/__tests__/arbzg-threshold-guard.test.ts` with two tracked exceptions,
  #525). The automatic break is placed by `placeAutoBreak()` at the conformant position nearest to
  `defaultBreakStart` in the TENANT time zone (minors: at least the § 11 amount, from 4.5 h);
  `scripts/audit-511-break-placement.ts` is the read-only dry run; closed months are never
  re-evaluated. A same-salon gap of any length is a counting segment when it is at least 15 min and lies inside
  the work period, and it ends a work block (#523 removed the 120-min cap of Phase 80 and with it the
  separator-only path). Details: `docs/adr/0001-abweichungen.md` Eintrag X, Nachtrag Phase 511.
- **§ 8 JArbSchG replaces the § 3 ArbZG day and week findings for a person under 18 (Issue #524).** On a work
  day the person is under 18 on (`isMinorAtDate`, per CHANGED day like the § 11 break regime; no birth date =
  adult), `dayLimitWarnings()` / `checkArbZG()` emit `JARBSCHG_DAILY_MAX_EXCEEDED` (8:00, 8:30 with the Abs. 2a
  compensation) and `JARBSCHG_WEEKLY_MAX_EXCEEDED` (40:00 per ISO week incl. the Berufsschule credit and the
  holiday fallout of § 4 Abs. 4 S. 2) and NEVER `MAX_DAILY_EXCEEDED`, `MAX_WEEKLY_EXCEEDED` or
  `MAX_DAILY_AVG_EXCEEDED` for that day. A warning, never a refusal (D-03); the § 9 hard block stays. The
  arithmetic exists ONCE in `contexts/time-tracking/minor-working-time.ts` (pure leaf, shared with the roster
  `scheduling/minor-shift-limits.ts`); the recorded week is read by `minor-week-figures.ts`
  (`loadMinorRecordedWeek`), the holiday price is the Arbeitszeitkonto's `holidayContractSollMinutes`. Ask
  "is the day over its maximum?" with `isDailyMaxCode(code)`, never a code literal (web: `isDailyLimitWarning`).
  Both codes rest on the ISO week in `warningWindow()` (see the "Save responses" bullet). The day-only views
  (`/day-breaks/preview`, `/day-breaks/checks`) have no week and judge the 8:30 ceiling.
- **Save responses show ArbZG warnings only within the reader's reach (Issue #85, D-12).**
  `warningsVisibleToCaller()` (`contexts/time-tracking/warning-visibility.ts`) is the ONE place: `PUT`
  and `POST /time-entries`, the on-behalf clock-out and the retro approval pass their warnings
  through it. A warning stays only when every non-deleted entry of the person inside its own window
  (day, day-1..day+1 for rest, the ISO week - also for the two § 8 JArbSchG codes - and 168 days for the 24-week average) is in the caller's
  `time-entry:read` reach; all withheld warnings collapse into one neutral `FINDING_WITHHELD` item.
  The person themself and a whole-tenant caller are unchanged. Accepted residuals: that a finding
  exists (notices, save responses) and the notification family stored as `type` - never a minute or
  a threshold.
- **Day lists only within the reader's time-entry reach (Issue #86, D-02).** `dayDetailVisibility()`
  (`contexts/working-time-account/api/day-detail-visibility.ts`) is the ONE place that decides
  whether a caller sees a person's day lists: the own person with `time-entry:read:EIGENE`, anyone
  else only with `time-entry:read:ZUGEWIESEN` over the person at the route's Stichtag. Four
  Arbeitszeitkonto responses call it: `GET /overtime/month-saldo` (`days`), `close-month/status`
  (`missingDates`, `unconfirmedBreakDays`, `breakFindingDays`, `karenzOverrunDays`),
  `close-month/year-status` (`missing[].missingDates`) and `close-month/deferred?detailed=true`
  (`gapDates`). Outside the reach the arrays are empty and `dayDetailsWithheld` is `true`; counts
  (`missingDateCount`, `unconfirmedBreakDayCount`, `breakFindingDayCount`, `karenzOverrunDayCount`,
  `gapCount`), status values and every saldo figure stay equal to what a whole-tenant reader gets.
  The 409 `shiftPreview` of `PUT /settings/work/:employeeId` follows `shift:read` reach instead
  (`pendingShifts` stays). The web renders counts through `$lib/month-close/day-lists` and reads
  `dayDetailsWithheld`, never the empty array, as "withheld". Never decide this anywhere else; the
  409 of `POST /overtime/close-month` is a known unredacted residual (ADR Eintrag Q, Nachtrag
  Phase 86b). Proof: `hr-no-day-level-data-86.test.ts`.
- **Appointment hint „Termin ohne erfasste Zeit“ (Issue #604).** A prompt, never a booking: it names a past
  day on which time was probably not recorded and never writes an entry, never prefills the form and never
  touches a saldo. The rule (`evaluateAppointmentHints`, threshold `APPOINTMENT_HINT_MIN_GAP_MINUTES` = 15,
  strictly greater) and its loader live ONLY in `contexts/time-tracking/appointment-hints.ts` and are NOT
  re-exported from `contexts/time-tracking/index.ts` (a module reading three other context indexes would join
  the measured import cycle, cap 22). Appointments come only from Schichtplanung's `getAppointmentDayEnds()`
  (the latest end per person and day, nothing else; `phorestAppointment` is a `convertedModels` entry, so a
  direct read elsewhere fails `measure-foreign-context-access`). The window is the write guard's own
  self-entry window (`computeRetroLimitStr`, inclusive) through tenant-local yesterday. Recorded = every
  non-deleted WORK entry of the day, valid or invalid; a day with an open entry gets no hint (AFTER_CLOCK_OUT
  compares the latest local end of the closed entries, NO_ENTRY needs no entry at all). Excluded days: effective
  leave (half days included), a pending Zeitnachtrag, a closed month, outside the employment, anonymised and
  `isTimeTrackingExempt` persons. `TenantConfig.appointmentTimeHintsEnabled` (default false, an Unterbau
  Erweiterung) gates every computation: off answers `{ enabled: false, hints: [] }` before any appointment,
  entry or leave read. „Stimmt so“ is `AppointmentHintDismissal` per person, tenant-local day and kind (FKs onto
  Tenant and Employee, `onDelete: Restrict`), written only by the person themself through `POST
  /appointment-hints/dismissals`, audited as `APPOINTMENT_HINT_DISMISSED` in the same transaction, permanent
  (no revoke, no update route), removed by `hardDeleteTimeDataForEmployee`. `GET /appointment-hints/team`
  follows the #86 Stammsalon rule per hint day (`resolveStammsalonScopedEmployeeIds`) inside the
  `time-entry:read:ZUGEWIESEN` reach and takes no person or salon parameter, so a person outside the reach is
  simply absent. Responses carry only day, kind, appointment end and clock-out (plus id and name in the team
  answer). The web only displays (`$lib/time-entries/appointment-hints`, the kind `zeitpruefen`); the link
  „Nachtragen“ carries no time. Proofs: `appointment-hints-rule-604`, `appointment-hints-604`,
  `appointment-hints-dismiss-604`, `appointment-hints-reach-604`.
