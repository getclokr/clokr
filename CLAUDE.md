# Clokr – Project Rules

## Moved sections (path-scoped rules)

These sections moved verbatim to path-scoped rule files under `.claude/rules/`. Claude Code loads a rule file automatically when it works on a file matching that file's `paths:` globs; read the file directly when its topic matters before such a file is open. A citation such as `CLAUDE.md § Schedule Types` resolves through this list.

- § DSGVO Employee Deletion = Anonymization → `.claude/rules/dsgvo-anonymization.md`
- § Saldo Calculation & Monatsabschluss → `.claude/rules/saldo-and-reports.md`
- § Time Entry Rules → `.claude/rules/time-entries.md`
- § Vacation Carry-Over & Cross-Year Booking → `.claude/rules/leave-and-vacation.md`
- § Overtime Saldo Calculation (current) → `.claude/rules/saldo-and-reports.md`
- § Schedule Types → `.claude/rules/schedule-types.md`
- § UI Consistency Rules → `.claude/rules/web-ui.md`
- § Svelte 5 Gotchas → `.claude/rules/web-ui.md`
- § Svelte 5 Patterns → `.claude/rules/web-ui.md`
- § Multi-Tenancy Convention (salon context and salon filters, Issue #82 onward) → `.claude/rules/salon-filters.md`
- § Operator principal and tenant deactivation (Phase 88, Issue #88) → `.claude/rules/operator-and-tenants.md`
- § Web-Push on devices (Issue #608) → `.claude/rules/notifications-push-reminders-wlan.md`
- § Calendar feed „Mein Dienstplan“ (Issue #597) → `.claude/rules/notifications-push-reminders-wlan.md`
- § Shift reminders (Issue #609) → `.claude/rules/notifications-push-reminders-wlan.md`
- § WLAN pairing by QR code (Issue #610) → `.claude/rules/notifications-push-reminders-wlan.md`
- § Tenant-scoping gate (Issue #204) → `.claude/rules/api-gates.md`
- § Anti-vacuity gate (Issues #235/#240/#245) → `.claude/rules/api-gates.md`
- § T-100-09 route gate (Issue #259) → `.claude/rules/api-gates.md`
- § Role-check gate and neutrality recordings (Issue #75) → `.claude/rules/api-gates.md`
- § Ordered audit/notification reads in tests (Issue #561) → `.claude/rules/api-gates.md`
- § Role management UI and the admin area (Issue #83) → `.claude/rules/roles-admin-ui.md`

## Tech Stack

- **Monorepo**: pnpm workspaces (`apps/api`, `apps/web`, `packages/db`)
- **API**: Fastify + TypeScript, Zod validation, Prisma ORM (PostgreSQL)
- **Web**: SvelteKit + Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`)
- **DB**: PostgreSQL 18, Prisma schema at `packages/db/prisma/schema.prisma`
- **Docker**: `docker compose up --build -d` for full stack

## Commands

- `pnpm dev` — start all dev servers
- `pnpm --filter @clokr/api dev` — API only
- `pnpm --filter @clokr/web dev` — Web only
- `pnpm --filter @clokr/db exec prisma migrate deploy` — apply pending migrations (every env)
- `pnpm --filter @clokr/db exec prisma generate` — regenerate Prisma client (`migrate deploy` does NOT do this, unlike `migrate dev`)
- Schema changes go through **versioned migrations**, never `db push`.

### Creating a migration — do NOT use `prisma migrate dev`

**`migrate dev` is not the workflow on this project.** When it finds drift it resets the target
database — drops it, recreates it, replays every migration — and in a non-interactive shell (i.e.
any agent run) that happens **without a confirmation prompt**. It did exactly that on 2026-08-19 and
destroyed all local fixture/demo data. This dev database has long-standing pre-existing index drift,
so it is reset-prone on repeat, not just that once.

Create migrations the way phases 85-01, 91-01, 96-01 and 104's quick tasks did — generate the SQL
against a throwaway shadow DB, read it, then apply it:

```bash
# 1. throwaway shadow DB
psql ... -c 'DROP DATABASE IF EXISTS clokr_shadow;' -c 'CREATE DATABASE clokr_shadow;'
# 2. hand-create packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_<snake_name>/
# 3. generate the SQL — Prisma 7 takes the shadow URL from the ENV VAR, there is no CLI flag
#    (see packages/db/prisma.config.ts and the drift check in .github/workflows/ci.yml)
SHADOW_DATABASE_URL="postgresql://.../clokr_shadow" pnpm --filter @clokr/db exec prisma migrate diff \
  --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --script \
  > packages/db/prisma/migrations/<dir>/migration.sql
# 4. READ migration.sql. Anything beyond your intended change is drift leaking in — stop, don't hand-edit.
# 5. apply to dev AND clokr_test, then verify
pnpm --filter @clokr/db exec prisma migrate deploy
pnpm --filter @clokr/api run test:setup
pnpm --filter @clokr/db exec prisma migrate status   # must report no drift
# 6. drop clokr_shadow, run prisma generate
```

Flags that older Prisma docs use and that **fail** here: `--to-schema-datamodel` (removed, use
`--to-schema`), `--shadow-database-url` (never a CLI flag in Prisma 7 — use `SHADOW_DATABASE_URL`).

Full workflow incl. the SAFETY-CRITICAL one-time int/prod baseline runbook: `docs/migrations.md`.

- `docker compose up --build -d` — rebuild and restart all containers

## Path Aliases (SvelteKit)

- `$stores` → `src/lib/stores/`
- `$api` → `src/lib/api/`

## Testing & Test Database Isolation

- The `apps/api` integration suite runs against its own databases — the template `clokr_test` and
  the per-worker `clokr_test_1`…`clokr_test_<N>` cloned from it — never the dev database `clokr`.
- Provision with `pnpm --filter @clokr/api run test:setup`: it ensures the template, runs
  `prisma migrate deploy` against it, then drops and re-clones all N worker databases. Every run
  therefore starts from a clean database; leftover rows from a killed run cannot survive.
- Run the full suite with `pnpm --filter @clokr/api test` — unchanged. Single file: `test:setup`
  first, then `pnpm --filter @clokr/api exec vitest run <path>` (`exec vitest run` skips `pretest`;
  `pnpm test -- <file>` does not work).
- The worker count is pinned in `apps/api/src/utils/test-database.ts`
  (`TEST_DATABASE_WORKER_COUNT`) — one number for CI and local. Changing it requires re-running
  `test:setup`, because that is what provisions exactly that many databases.
- `apps/api/src/utils/test-database.ts` is the ONLY place the test-database name pattern, the
  marker and the worker count may be stated. Never restate them — not even here. This bullet used
  to quote the regex inline and went stale the moment Phase 132 widened it, which is the exact
  failure the rule exists to prevent. Read `TEST_DATABASE_NAME_PATTERN` in that module.
- **Per-working-directory namespaces (Phase 132).** The MAIN working tree uses an empty namespace,
  so its names stay `clokr_test` / `clokr_test_1`…`_N` — byte-identical to before, which is what CI
  relies on. A linked `git worktree` derives an 8-hex namespace and uses `clokr_test_<ns>` /
  `clokr_test_<ns>_<n>`, so two working directories can run the suite at the same time without
  colliding. The namespace is decided by `git rev-parse --path-format=absolute --git-dir
--git-common-dir`; `--path-format=absolute` is load-bearing, because from a subdirectory git
  returns one path absolute and the other relative, and comparing them raw would misread the main
  tree as a worktree and rename CI's databases. `CLOKR_TEST_NAMESPACE` overrides the derivation;
  absent `git`, the namespace falls back to empty, never to a guess. Orphaned namespaces:
  `reset-test-databases.ts --prune-orphans` (dry run by default, `--confirm` to act).
- A startup guard aborts before any test executes if a target is not a marked test database — it
  verifies the template AND every worker database by name and by marker POSSESSION, and each worker
  refuses to run if it cannot resolve its own database. Fix the target, never work around the guard.
- `apps/api/scripts/reset-test-databases.ts` is the only script that may `DROP DATABASE`; it
  requires marker possession AND a matching worker name, and an `apps/api/Dockerfile` build gate
  fails if it ever reaches the runtime image.
- `?schema=` is a Prisma-only connection-string parameter that the `pg` driver silently ignores —
  it must never reappear in `TEST_DATABASE_URL`.
- **Test users need a stored role assignment (Issue #539).** Permissions come only from stored rows, so a
  fixture user without one holds nothing. Give each user its system role explicitly with
  `grantSystemRole(prisma, { tenantId, userId, role })` from `apps/api/src/__tests__/setup.ts` (a stored
  TENANT row, idempotent; `seedTestData`/`seedTenantFixture` users already have one). A test that needs the
  unassigned state uses `removeFixtureRoleAssignments` or creates a user without calling the helper. The
  seeds use `ensureSystemRoleAssignment` (`packages/db/src/seed-role-assignments.ts`).
- Full details, provisioning rationale, and the clean-slate procedure: `docs/testing.md`.

## Language

- UI labels and user-facing text: **German**
- Code, comments, commit messages, docs: **English**
- API descriptions (Swagger): English
- User-facing texts address the reader with **du**; the binding vocabulary is `docs/glossar.md`, checked by
  `pnpm --filter @clokr/web lint:ui-terms` (Issue #574)

## Context Boundaries (ADR 0001, ADR 0002)

**Read `docs/adr/0002-vier-kontexte-und-unterbau.md` and `docs/adr/0001-drei-kontexte.md` (partially superseded by 0002) before adding a feature or moving code across these lines.**
Deviations from the target picture, with file references: `docs/adr/0001-abweichungen.md`.

Clokr has **four business contexts**, a shared substrate (**Unterbau**, the Shared Kernel) that belongs to none of them, and a rule-free **composition layer**:

- **Zeiterfassung** (`contexts/time-tracking/` + `services/clock/`) — clock in/out, correction, validity, ArbZG. Records what happened. Minute-level, one or more non-overlapping rows per employee and day (Issue #70, `docs/adr/0001-abweichungen.md` entry AA).
- **Abwesenheiten** (`contexts/absence/`) — request, approval, entitlement, carry-over. A workflow with status, not a recording. Date ranges in days.
- **Schichtplanung** (`contexts/scheduling/` + `services/phorest/`) — shifts, templates, coverage, availability, Phorest sync. Plans the future. Since Phase 107 it feeds Arbeitszeitkonto (SHIFT_BASED Soll) and Abwesenheiten (SHIFT_BASED leave-day count).
- **Arbeitszeitkonto** (`contexts/working-time-account/`) — Soll vs. Ist, saldo, Monatsabschluss. Reads from the others. Owns the once-per-day rule.
- **Unterbau** (Shared Kernel, `contexts/platform/`) — the 21 `platform` models of `MODEL_OWNER` in `apps/api/scripts/measure-foreign-context-access.ts` (Tenant, TenantConfig, Employee, User, WorkSchedule, OperatorAccount, OperatorAuditLog, SupportAccess, PushSubscription, …) and permissions. Salon (#64), RoleAssignment (#74) and Salonzuordnung (#67) land here; Beschäftigung (#66) is backlog and has no entity.
- **Composition layer** (`apps/api/src/composition/` + composition root `apps/api/src/app.ts`) — owns no model, carries no business rule, reads contexts only through their `index.ts`, and no context imports from `composition/`. A business rule found there moves into the owning context (ADR 0002, Entscheidung 9).

Rules — these are directives, not preferences:

- **Absence is NEVER a `TimeEntryType`.** A time entry has no "requested" status, and approved leave for next August is not a recorded period. `TimeEntryType` stays free of absence values.
- **`calcLeaveAbsenceMinutesTz()` (`apps/api/src/contexts/working-time-account/timezone.ts`) belongs to Arbeitszeitkonto and is NOT to be split.** It and the `sbClaimed` dedup set in `close-employee-month.ts` carry the invariant _a day reduces Soll exactly once_. Anyone wanting to split it must first prove the invariant is secured otherwise.
- **`LeaveRequest` = requested absence** (status, entitlement, approver): Urlaub, Krankheit, Sonderurlaub. **`Absence` = imposed absence** (occurs, is not requested): Berufsschule, Mutterschutz, Elternzeit (as built, only Berufsschule is written as an `Absence`; Mutterschutz and Elternzeit are requested as the `LeaveRequest` codes `MATERNITY`/`PARENTAL` of `REQUESTABLE_CODES` — Issue #713). `SICK` belongs to `LeaveRequest`.
- **No foreign keys between peer contexts; foreign keys onto the Unterbau are allowed** (ADR 0002, Entscheidung 4). Existing `onDelete` behaviour is untouched; the `onDelete: Restrict` compliance control on Employee→TimeEntry/LeaveRequest/Absence stays in the database. A new FK onto the Unterbau is named in its issue as a new Shared-Kernel dependency, revision-relevant relations use `onDelete: Restrict`, and the referenced Unterbau row must belong to the same tenant.
- **No direct table access across contexts.** Go through the owning context's public interface.
  **Mechanically enforced (Phase 101B, Issue #101):** `eslint.boundaries.mjs`'s `no-restricted-imports`
  blocks fail the build (CI and pre-commit) on a deep import into a foreign context's internals —
  the only legal way in is `contexts/<name>/index.ts`. Its five boundary areas (`BOUNDARY_CONTEXTS`)
  are the four contexts plus `platform`; `services/clock/` counts as Zeiterfassung and
  `services/phorest/` as Schichtplanung. The composition root (`app.ts`) and six
  individually reasoned, dated exceptions (`apps/api/scripts/context-boundary-import-exceptions.json`)
  are named in `docs/adr/0001-abweichungen.md` Eintrag H; a new one is a finding to report, not a
  step to take.
- **Never use a new display string as a control value.** No `x === "Ausstempeln fehlt"`, no lookup by `leaveType.name`. Existing occurrences are documented deviations, not precedent.
- **No generalization on spec.** No plugin system, no generic extension mechanism, no abstraction layer without a concrete second use case (ADR 0002, Entscheidung 2). The former fourth-context trigger is void because the fourth context exists; a generalization already scheduled with a concrete use case, such as the in-process dispatcher (#102), is legitimate.
- **Tactical DDD building blocks only in Arbeitszeitkonto.** Aggregate, Repository and Value Object only in `contexts/working-time-account/` (#107, #108) — not in the other contexts, the Unterbau or the composition layer. No CQRS (ADR 0002, Entscheidung 3).
- **One schema and one central migration directory are conforming.** Per-context schemas (#105) and migrations (#106) only on a trigger — migrations of different contexts collide in practice, or a database role must be granted per context. They bring signal and migration separation, not compile-time isolation, which comes from the facades (#100) and the lint (#101) (ADR 0002, Entscheidung 6).
- **Event handlers are invariant-carrying or reactive** (ADR 0002, Entscheidung 10). Invariant-carrying: synchronous, inside the sender's transaction, fail-closed — its failure aborts the sender's write. Reactive: after commit, may fail, never aborts the sender, failure logged. Default is reactive; invariant-carrying only when a named invariant requires it, and it then lives in the context owning that invariant (example: `recalcProvisionalLeaveForShiftChange(tx, …)`, Phase 107 D-15). No dispatcher exists yet — that is #102. No broker until a consumer outside the process exists or an event must survive a restart (Entscheidung 5).
- **Unterbau changes need the owner** (ADR 0002, Entscheidung 7). An Unterbau change (a) adds, changes or removes a field, relation, enum value or model owned by the Unterbau, or (b) changes the signature or semantics of an export of `contexts/platform/index.ts`. An **Erweiterung** (additive; no existing reader has to change) is approved by the issue reaching `Ready`; a **Semantikänderung** (meaning, unit, nullability, required-ness, fallback chain, `onDelete`, removal/rename, moving a value between Unterbau models) additionally needs an explicit owner decision comment on the issue before `Ready` and a Nachtrag in `docs/adr/0001-abweichungen.md` after shipping. Every Unterbau-change issue carries a section „Auswirkung auf die Kontexte“ naming Zeiterfassung, Abwesenheiten, Schichtplanung, Arbeitszeitkonto and the composition layer — each with an effect or an explicit "keine".
- **When unsure which context a new feature belongs to: ask.** Do not guess.

## Audit-Proof / Revisionssicherheit

Clokr MUST be audit-proof (revisionssicher). All data relevant to working time, leave, and payroll must be tamper-proof and traceable:

- **No hard deletes** of time entries, leave requests, or employee records — use soft delete (`deletedAt`) or status changes instead
- **Soft delete queries**: ALL queries on soft-deletable models (TimeEntry, LeaveRequest, Absence) MUST include `deletedAt: null` in the where clause
- **Audit trail**: Every create, update, and delete must be logged with userId, timestamp, IP, and before/after values (via `app.audit()`)
- **Immutability after lock**: Once a month is closed (`isLocked`), entries MUST NOT be editable or deletable — not even by admins. Always check `isLocked` before UPDATE/DELETE.
- **No silent overwrites**: Any correction to a locked/finalized entry must create a new correction entry with reference to the original, not modify it in place
- **Traceability**: It must always be possible to reconstruct who changed what, when, and why
- **CASCADE = Restrict**: Critical relations (Employee→TimeEntry/LeaveRequest/Absence) use `onDelete: Restrict` to prevent silent cascade deletion
- **`LEAVE_DAYS_ADJUSTED` audit action** (Phase 107, D-20): written whenever roster planning
  recomputes a `SHIFT_BASED` employee's approved, provisional leave-day count for a period that
  overlaps the changed roster week; carries `oldValue`/`newValue` (`{days, daysProvisional}`) and
  a `Roster-Planung` trigger note — same pattern as `LEAVE_CORRECTED` (Phase 94).
- **Überstundenausgleich** (Issue #468, D-02): `LeaveRequest.overtimeCompMinutes` stores the booked
  minutes at approval; storno and correction reverse exactly that stored value, never a
  recomputation (a legacy row with no stored value falls back to a logged recomputation).
- **§ 9-Korrektur** (Issue #468, A-3): a `/correct` never deletes a `Section9Credit` — a credit
  that no longer applies is marked `SUPERSEDED` and, if it partially survives, replaced by a new
  correction credit (`supersedesId`), both audited. The approval of a leave cancellation (`CANCELLATION_REQUESTED` → `CANCELLED`) and the #614
  employment-exit cancellation supersede every remaining credit of the cancelled request the same way, in the
  cancellation's own transaction (`supersedeSection9CreditsOfCancelledRequest()`, `contexts/absence/section9-supersede.ts`
  — the one place a credit becomes `SUPERSEDED`, shared with `/correct`; a `CONFIRMED` credit's ledger give-back is
  taken out again), so no day is credited twice (Issue #662; `scripts/audit-662-cancelled-leave-section9.ts` lists
  Bestand, read-only).

- **Correction of a closed month = account movement in the running month (Issue #599, ADR Eintrag AJ).**
  `MonthCorrectionRequest` (Arbeitszeitkonto, `/api/v1/month-corrections`) never touches the closed month, its entries or its
  snapshot. An approval (four eyes: neither the requester nor the person concerned) books the journal row `OvertimeTransaction`
  (CORRECTION) and `correctionMinutes` + `bookingDate` (tenant-local approval day) on the request in one transaction; the saldo
  core folds them in through `closeEmployeeMonth`'s `accountCorrections`, read only via `booked-month-corrections.ts`. Every
  production caller passes it (`month-correction-saldo-callers-599.test.ts`). No booking into a closed running month (409
  `MONTH_LOCKED`) or for a person without a saldo today (409 `CORRECTION_NO_SALDO`). Open months keep the Zeitnachtrag.

- **Operator audit is append-only (Phase 88, Issue #88, D-07a).** Every action of the operator
  principal is written to `OperatorAuditLog` through `recordOperatorAudit()`
  (`contexts/platform/operator-audit.ts`, the only file naming the delegate), never to the tenant
  `AuditLog`. The table is append-only twice over: the writer only creates rows, and a database
  trigger refuses UPDATE, TRUNCATE and every DELETE except the retention purge (the first DB trigger
  of the project; it guards against application mistakes, not against the table owner). Retention
  (`composition/data-retention.ts`): authentication events 12 months, lifecycle actions 10 years.
  Details and limits: `docs/adr/0001-abweichungen.md` Eintrag Y. `SupportAccess` (Issue #93) carries
  the project's second database trigger, with the same intent (see the support-access bullet in the
  operator section).

These rules apply to ALL code changes touching time entries, leave, overtime, and employee data. When in doubt, prefer creating an audit log entry over skipping it.

## Data Retention (Aufbewahrungsfristen)

Legal retention periods (Germany):

| Basis                             | Retention                              | Reference            |
| --------------------------------- | -------------------------------------- | -------------------- |
| Arbeitszeitnachweis               | 2 years                                | § 16 Abs. 2 ArbZG    |
| Lohnkonten                        | 6 years                                | § 41 EStG            |
| Buchungsbelege (payroll-relevant) | 10 years                               | § 147 AO / § 257 HGB |
| DSGVO                             | Delete after longest retention expires | Art. 17 DSGVO        |

**Default retention: 10 years** (configurable per tenant, minimum 2 years). Retention period starts at end of calendar year of record creation. Deletion is NOT rolling — it happens annually (Stichtag), e.g., on Jan 1st for records whose retention expired on Dec 31st.

## Releases & Deployment

**Read `docs/release-process.md` before cutting, tagging or deploying a release.** It is the
canonical order and it is NOT reconstructible from the workflows alone.

The three rules that get broken most often:

- **Bump the version BEFORE the tag.** The version is baked into the image from `package.json`
  (`apps/api/src/app.ts:59-65`); promotion is a digest-preserving re-tag with no rebuild, so tagging
  a pre-bump image makes `/api/v1/version` report the old version.
- **Never `kubectl set image` on int.** ArgoCD runs `selfHeal: true` and reverts it in seconds.
  Change `image.tag` in `k8s-homelab/argocd-apps/clokr-app.yaml` instead.
- **Write the German release notes BEFORE merging the release PR.** They live at
  `docs/release-notes/vX.Y.Z.md`, are baked into the API image (`apps/api/Dockerfile`) and shown
  in-app by the What's-New dialog; `release.yml`'s `publish-notes` job fills the GitHub Release
  body from that same file. Notes written after the merge can never be inside the image they
  describe — that is why the old "write them by hand afterwards" step no longer exists.

Environments: dev = local docker · int = k3s (ArgoCD) · prod = dmz-proxy (`/opt/awh-infra/.env`).
Refreshing int from prod data requires `apps/api/scripts/pseudonymize-dump.ts` — never restore a raw
prod dump to int. The refresh also neutralises every `OperatorAccount` (email, password hash, TOTP
secret — Phase 88, D-11), so no operator credential of prod survives on int.

## Simulation instance (Issue #715)

A separate, non-public server runs the current release with synthetic tenants, seeded bots and a nightly
read-only invariant checker (`apps/sim`, never in a release image). **Read `docs/simulation.md` before
touching it.** It holds no real personal data; the bots use only real interfaces (no database access);
a finding becomes a `simulation` issue with ids only.

## CVE / Security Vulnerability Handling

Trivy/Dependabot process (update direct/transitive/base-image, justify exceptions in `.trivyignore`, never lower severity, document in commit) → see `docs/cve-handling.md`.

## Public Holidays

- **The Bundesland lives on the salon (Phase 71b, issue #71).** `Salon.federalState` is required;
  `Tenant.federalState` is only the default a NEW salon inherits when none is given — no code reads
  it for statutory holidays. `PublicHoliday` rows are manual additions per salon (`salonId`
  required, unique `[salonId, date]`); statutory holidays are computed, never stored.
- **One resolution, in the Unterbau:** `holidaysAtWorkLocation()` / `holidaysForSalon()` in
  `apps/api/src/contexts/platform/facade/holiday-resolution.ts` are the ONLY place a holiday set is
  built. A holiday applies at the work location of that day (§ 2 EFZG): the salon of the employee's
  closed work entry on that day (with several entries the one with the earliest start — final, owner decision
  2026-10-16, Issue #70), else `salonForDay()`, else the tenant's default salon. Callers pass
  the `getWorkedEntriesInRange()` rows of their range — the Unterbau never reads `TimeEntry`. No
  active salon where one is needed → it throws (fail-closed).
- Outside `contexts/platform/` no production code computes holidays itself or reads `PublicHoliday`
  directly — `apps/api/src/__tests__/holiday-resolution-boundary.test.ts` fails on it, comments
  included.
- `Salon.federalState` is changeable only while no `TimeEntry` (soft-deleted ones included) and no
  salon assignment references the salon — else 409 `FEDERAL_STATE_IN_USE`. A move is a new salon.
- School holidays (`SchoolHolidayPeriod`, Berufsschule `federalStateOverride`) and the
  Christmas-Eve / New-Year's-Eve company rules stay tenant-wide.
- `GET /api/v1/holidays` never requires a salon (D-09, revised 2026-09-25): without `salonId` it
  returns the holidays of ALL active salons of the tenant, each item tagged with its `salonId`;
  with `salonId` only that salon (a foreign or unknown id gets the identical 404, T-100-09).
  Writes (`POST /api/v1/holidays`) still require `salonId` when the tenant has more than one active
  salon — 400 `SALON_REQUIRED` otherwise.

## ArbZG (Arbeitszeitgesetz) Rules

These rules MUST be followed when implementing or modifying ArbZG compliance checks:

- **§ 3 Daily max: 10h absolute limit** — this is the hard daily cap, never exceeded
- **§ 3 The 8h rule is a 24-week/6-month AVERAGE, NOT a daily limit!**
  - A 4-day week with 39h (= 9.75h/day) is perfectly legal
  - Only warn/error when the 24-week rolling average exceeds 8h per workday
  - Do NOT show warnings for individual days between 8h and 10h
- **§ 3 Weekly max: 48h** — hard weekly cap (Mo-Sa = 6 Werktage)
- **§ 4 Breaks**: >6h work = min 30min break; >9h work = min 45min break
- **§ 4 Satz 2**: a break segment shorter than 15 min is not a Ruhepause and does not count
  towards the 30/45 min (and never at the very start or end of the work period)
- **§ 4 Satz 3**: at most 6 h in a row without a Ruhepause of at least 15 min — also when the Satz 1
  sum is met (30 min at 14:00 after 08:00 is fine, 30 min at 14:30 is not)
- **§ 18 Abs. 2 ArbZG / § 11 JArbSchG**: for an employee under 18 on the work day § 11 JArbSchG
  replaces § 4 (> 4.5 h → 30 min, > 6 h → 60 min, segments of at least 15 min, at most 4.5 h in a
  row, no Ruhepause in the first or last hour); the age is decided per work date, not per today
- **§ 5 Rest period**: min 11h between end of work and start of next day
- **§ 8 BUrlG**: Leave and time tracking interaction rules:
  - **APPROVED leave**: Time entry creation is BLOCKED. Employee must request cancellation first.
  - **CANCELLATION_REQUESTED leave**: Time entries ARE allowed but created as `isInvalid: true`
    with reason "Urlaubsstornierung ausstehend". These entries don't count in saldo.
  - **When cancellation is approved** (→ CANCELLED): Invalid entries are automatically revalidated.
  - **When cancellation is rejected**: Entries stay invalid (manager can manually handle).
  - Cancellation always requires approval by a DIFFERENT manager (self-approval blocked).
  - Leave remains active (shown in calendar, counts for saldo) until cancellation is approved.

## Leave Cancellation Flow

1. Employee/Manager requests cancellation → status = `CANCELLATION_REQUESTED`
2. Leave remains active: shown in calendar (special styling), blocks regular time tracking
3. Time entries during this period: allowed but marked `isInvalid` (needs cancellation approval first)
4. Another manager approves cancellation → status = `CANCELLED`, time entries auto-revalidated
5. If cancellation rejected → status reverts to `APPROVED`, time entries stay invalid
   The statuses that count as active leave are defined once: `EFFECTIVE_LEAVE_STATUSES` (`apps/api/src/contexts/absence/effective-leave-statuses.ts`, exported via `contexts/absence/index.ts`, read through `getActiveLeaveOverlapping`) — saldo, Monatsabschluss, reports/DATEV, scheduling and calendars use it (Issue #446); `apps/web/src/lib/leave/effective-leave-statuses.ts` is a display mirror pinned to it by a test.

<!-- GSD:project-start source:PROJECT.md -->

## Project

**Clokr — Production Readiness**

Clokr is a German-language, audit-proof time tracking and leave management SaaS for small to mid-size companies. It handles time entries, breaks, overtime saldo, leave requests with BUrlG-compliant carry-over, ArbZG compliance checks, NFC terminal integration, and multi-tenant administration. The app is feature-complete for v1 — this milestone focuses on making it production-ready.

**Core Value:** The app must be reliable, secure, and legally compliant enough to go live with real customers — no silent failures, no untested edge cases, no broken mobile experience.

### Constraints

- **Legal**: Must comply with ArbZG, BUrlG, DSGVO, and German retention requirements (§147 AO: 10 years)
- **Tech stack**: Existing stack (Fastify + SvelteKit + Prisma + PostgreSQL) — no migrations
- **Language**: UI in German, code/docs in English
- **Audit-proof**: No hard deletes, all mutations logged, locked months immutable
- **Docker**: Development and deployment via docker compose

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 6.0.2 - All backend and frontend source code
- Svelte 5.55.0 - UI components with runes syntax (`$state`, `$derived`, `$effect`, `$props`)
- JavaScript/Node.js - Runtime, build scripts
- SQL - Executed via Prisma

## Runtime

- Node.js 24-alpine - Container runtime for both API and web
- pnpm 10.33.0 - Workspaces package manager
- pnpm 10.33.0
- Lockfile: `pnpm-lock.yaml` (present)
- Workspace structure: `pnpm-workspace.yaml`

## Frameworks

- Fastify 5.8.4 - HTTP server for API (`apps/api`)
- SvelteKit 2.55.0 - Web framework with SSR/SSG for `apps/web`
- @sveltejs/adapter-node 5.5.4 - Node.js adapter for SvelteKit
- Prisma 7.6.0 - ORM layer
- @prisma/client 7.6.0 - Runtime client
- @prisma/adapter-pg 7.6.0 - PostgreSQL adapter
- PostgreSQL 18-alpine - Primary database
- Vitest 4.1.10 - Unit/integration test runner
- @vitest/coverage-v8 4.1.1 - Code coverage
- @playwright/test 1.58.2 - End-to-end testing (apps/e2e)
- @axe-core/playwright 4.11.1 - Accessibility testing
- Turbo 2.8.20 - Monorepo task runner
- Vite 8.0.2 - Frontend build tool
- @sveltejs/vite-plugin-svelte 7.0.0 - Svelte compilation
- TypeScript compiler (tsc) - Type checking
- tsx 4.21.0 - TypeScript Node runner for dev
- ESLint 10.1.0 - Linting (ES and TypeScript)
- @typescript-eslint/eslint-plugin 8.57.2 - TS linting rules
- eslint-plugin-svelte 3.16.0 - Svelte linting
- svelte-eslint-parser 1.6.0 - Svelte parsing
- Prettier 3.8.1 - Code formatting
- prettier-plugin-svelte 3.5.1 - Svelte formatting
- husky 9.1.7 - Git hooks
- lint-staged 16.4.0 - Pre-commit linting

## Key Dependencies

- @fastify/jwt 10.0.0 - JWT handling for API
- bcryptjs 3.0.3 - Password hashing
- @fastify/helmet 13.0.2 - Security headers
- @fastify/cors 11.2.0 - CORS middleware
- @fastify/rate-limit 10.3.0 - Rate limiting (500 req/min default)
- @fastify/swagger 9.7.0 - OpenAPI/Swagger documentation
- @fastify/swagger-ui 5.2.5 - Swagger UI at `/docs`
- @fastify/multipart 9.4.0 - File upload handling
- minio 8.0.7 - S3-compatible object storage client
- sharp 0.34.5 - Image processing (avatars)
- pdfkit 0.18.0 - PDF generation
- nodemailer 8.0.4 - SMTP email sending
- zod 4.3.6 - Schema validation
- date-fns 4.1.0 - Date utilities (web)
- date-fns-tz 3.2.0 - Timezone support (API)
- node-cron 4.2.1 - Scheduled tasks (monthly close, data retention, sync)
- chart.js 4.5.1 - Chart rendering
- @tanstack/svelte-query 6.1.10 - Server state management
- tailwindcss 4.2.2 - CSS framework
- postcss 8.5.8 - CSS processing
- autoprefixer 10.4.27 - CSS vendor prefixes
- pino - JSON logging (included via fastify)
- pino-pretty 13.1.3 - Pretty console output (dev)
- pino-roll 4.0.0 - Log file rotation
- @elastic/ecs-pino-format 1.5.0 - Elastic Common Schema formatting
- pg 8.20.0 - PostgreSQL driver

## Configuration

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection (configured but not actively used in core)
- `JWT_SECRET`, `JWT_REFRESH_SECRET` - Auth tokens (min 32 chars)
- `ENCRYPTION_KEY` - Field-level encryption (min 32 chars)
- `CORS_ORIGIN` - Web app URL for CORS
- `APP_URL` - Frontend URL for email links
- `API_PORT`, `API_HOST` - API server binding (default 4000)
- `NODE_ENV` - development|production|test
- `SMTP_*` - Email server config (optional, can be set per-tenant in DB)
- `MINIO_*` - Object storage credentials
- `LOG_LEVEL` - Logging verbosity
- `LOG_FORMAT` - json|ecs|pretty
- `LOG_FILE` - Optional log file path with daily rotation
- `POOL_MIN`, `POOL_MAX` - Database connection pool
- `SEED_DEMO_DATA` - Bootstrap demo data on startup
- `tsconfig.json` - Present in all packages
- `vite.config.ts` - SvelteKit Vite config
- `.prettierrc` - 2-space indent, trailing commas, 100 char width
- `eslint.config.js` - Flat config with TypeScript, Svelte, Prettier

## Platform Requirements

- Node.js 24+ (uses ES modules)
- pnpm 10.33.0
- Docker & Docker Compose (for services: PostgreSQL, Redis, MinIO)
- Git with Husky hooks
- Docker/Kubernetes with Node.js 24-alpine base
- PostgreSQL 18
- Redis 7 (optional, configured but unused)
- MinIO (S3-compatible object storage)
- SMTP server (optional, configurable per tenant)
- PostgreSQL 18-alpine:5432
- Redis 7-alpine:6379
- MinIO:9000,9001 (S3 API + console)
- Optional backup service (pg_dump daily, 7-day retention)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- API route files: kebab-case, singular noun — `time-entries.ts`, `company-shutdowns.ts`, `audit-logs.ts`
- API utility files: kebab-case — `vacation-calc.ts`, `password-policy.ts`, `timezone.ts`
- API plugin files: kebab-case — `prisma.ts`, `audit.ts`, `auto-close-month.ts`
- Svelte pages: SvelteKit convention — `+page.svelte`, `+layout.svelte`
- Svelte components: PascalCase — `Toast.svelte`, `EmptyState.svelte`, `CommandPalette.svelte`, `Breadcrumb.svelte`
- Svelte stores: camelCase — `auth.ts`, `toast.ts`, `theme.ts`
- Test files: `{name}.test.ts` in `__tests__/` directories
- camelCase for all functions — `requireAuth`, `seedTestData`, `checkArbZG`, `calcBreakMinutes`
- Route registrations: `async function {domain}Routes(app: FastifyInstance)` — e.g., `employeeRoutes`, `timeEntryRoutes`, `leaveRoutes`
- Utility exports: named exports of pure functions — `getHolidays()`, `todayInTz()`, `validatePassword()`
- Helper functions in route files: module-scoped, private (not exported) — `calcBreakMinutes()`, `validateBreakSlots()`, `checkOverlap()`
- camelCase for all variables — `adminToken`, `empUser`, `vacationType`
- Constants: UPPER_SNAKE_CASE for domain constants — `TYPE_CODES`, `LEAVE_TYPE_DEFS`, `LEGACY_ALIASES`, `CACHE_TTL_MS`
- State variables in Svelte: `let varName = $state(initialValue)` — `let loading = $state(false)`, `let entries: TimeEntry[] = $state([])`
- PascalCase for all types and interfaces — `JwtPayload`, `ArbZGWarning`, `CalDay`, `AuthState`
- Prefix `Props` for Svelte component props interfaces
- Zod schemas: camelCase with `Schema` suffix — `createEmployeeSchema`, `idParamSchema`, `loginSchema`, `manualEntrySchema`

## Code Style

- Prettier (v3.8+) with `prettier-plugin-svelte`
- No explicit Prettier config file found (uses defaults: double quotes, trailing commas, semicolons)
- Pre-commit hook via Husky runs `lint-staged` which applies `eslint --fix` and `prettier --write`
- ESLint v10 with flat config at `/eslint.config.js`
- TypeScript ESLint recommended rules
- Svelte ESLint plugin (flat/recommended)
- Key rules:
- Strict mode enabled in both `apps/api/tsconfig.json` and `apps/web/tsconfig.json`
- Target: ES2022 (API), extended from SvelteKit (Web)
- `esModuleInterop: true`, `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`

## Language Conventions

- All user-facing strings, error messages, and labels are in German
- Examples: `"Mitarbeiter nicht gefunden"`, `"Ungültige Anmeldedaten"`, `"Konto temporär gesperrt"`
- Code comments are **English**, without exception (see the Language section above). German
  appears only inside user-facing string literals; German domain nouns (`Monatsabschluss`,
  `Zeitnachtrag`, `Revisionssicherheit`, `Betriebsurlaub`, `ArbZG`) stay untranslated when named
  inside English prose. Legacy files still contain German comment prose — that is drift to fix on
  sight in a file you are already editing, not a convention to follow (GitHub issue #131)
- All variable names, function names, type names in English
- Domain-specific German terms kept where they are proper nouns: `Monatsabschluss`, `Sonderurlaub`, `Betriebsurlaub`, `ArbZG`

## Import Organization

- `$lib` -> `src/lib`
- `$components` -> `src/lib/components`
- `$stores` -> `src/lib/stores`
- `$api` -> `src/lib/api`

## Error Handling

- Global error handler in `apps/api/src/app.ts` catches ZodErrors and converts them to `{ error: string, message: string, details: [] }` with HTTP 400
- **Validation and duplicate answers are German, centrally (Issue #573).** Zod's DEFAULT texts come only from
  `apps/api/src/utils/zod-german.ts` (`z.config({ customError })`, registered in `buildApp`; a schema's own message keeps
  precedence). A 400 carries `details[]` = `{ path, field, code, message }` and a `message` summary that names fields by
  German label (`FIELD_LABELS`) and NEVER by key; the keys go to `details[].path` and the info log. An unhandled Prisma
  `P2002` answers 409 `{ error, code: "DUPLICATE" }` with the text of `DUPLICATE_MESSAGES`
  (`apps/api/src/utils/duplicate-conflict.ts`, keyed by the unique index, never echoing a value), a `P2034` 409
  `WRITE_CONFLICT`. A new unique index needs its entry (`duplicate-conflict-573.test.ts` fails otherwise); a response
  with an English Zod default fails `api-error-messages-573.test.ts`. Never add a per-route Zod text mapping.
- All other errors return `{ error: string }` with appropriate status code
- German error messages for user-facing responses: `"Validierungsfehler"`, `"Interner Serverfehler"`
- Return early with `reply.code(XXX).send({ error: "German message" })` — no `throw`
- Common HTTP codes used:
- `ApiError` class in `apps/web/src/lib/api/client.ts` wraps fetch errors with `status`, `message`, `data`
- Automatic 401 handling: tries token refresh, redirects to `/login` on failure
- Toast notifications for user-visible errors via `toasts.error("message")`
- Client-side error logging via `apps/web/src/lib/utils/logger.ts` which sends errors to `/api/v1/logs/client`

## Logging

- Structured JSON logging in production, `pino-pretty` in development
- ECS (Elastic Common Schema) format available via `LOG_FORMAT=ecs`
- Optional file logging via `LOG_FILE` env var with daily rotation (`pino-roll`)
- Request context enrichment: `userId`, `tenantId`, `role` added via `onRequest` hook
- Request completion logged via `onResponse` hook with method, URL, status, response time
- `clientLogger` at `apps/web/src/lib/utils/logger.ts` batches and sends errors to `/api/v1/logs/client`
- `console.error` and `console.warn` allowed by ESLint config
- `console.log` produces lint warnings

## Comments

- Section separators: `// ── Section Name ──────────────────` used throughout route files and app.ts to visually separate logical blocks
- JSDoc-style comments for utility functions that have non-obvious behavior — see `apps/api/src/contexts/working-time-account/timezone.ts`
- Business-rule context comments are **English** (see § Language Conventions above). `// Einladung nur erstellen wenn kein Passwort gesetzt` in `apps/api/src/contexts/platform/api/employees.ts` is a legacy example of the OLD, no-longer-followed pattern, not a convention to imitate — it is drift to fix on sight in that file, not here (Issue #131)
- TODO comments for known future work: `// TODO(owner-gate): construct once the Phorest web-calendar URL format is pinned.`
- Used sparingly — mainly on exported utility functions and plugin interfaces
- Declare module augmentation blocks use JSDoc for plugin-decorated properties:

## Function/Route Design

- Each route file exports a single async function: `export async function fooRoutes(app: FastifyInstance)`
- Zod schemas defined at module top as `const` — `createSchema`, `updateSchema`, `idParamSchema`
- Route definition uses `app.method(path, { schema, preHandler, handler })` inline object syntax
- Validation: `schema.parse(req.body)` or `schema.parse(req.params)` inside handler (throws ZodError caught by global handler)
- Swagger tags use German domain names: `tags: ["Mitarbeiter"]`, `tags: ["Auth"]`
- Use `fastify-plugin` (`fp`) wrapper for plugins that decorate the app instance
- Declare module augmentation for type safety
- Example at `apps/api/src/contexts/platform/plugins/audit.ts`, `apps/api/src/contexts/platform/plugins/prisma.ts`

## Module Design

- Route files: single named export — `export async function fooRoutes(app: FastifyInstance)`
- Utility files: multiple named exports of pure functions
- Plugin files: single named export — `export const fooPlugin = fp(async (app) => { ... })`
- Store files: single named export — `export const authStore = createAuthStore()`
- `@clokr/db`: Prisma client + generated types — imported as `import { PrismaClient } from "@clokr/db"`
- `@clokr/types`: Shared TypeScript interfaces — imported as `import type { FederalState } from "@clokr/types"`

## Configuration Pattern

- Validated with Zod schema at startup in `apps/api/src/config.ts`
- Fails fast with detailed error output if validation fails
- Exported as typed `config` object: `export const config = parsed.data`
- Never accessed via `process.env` in route/plugin code — always through `config`

## Soft Delete Convention

- Models with `deletedAt` field (TimeEntry, LeaveRequest, Absence) use soft delete
- All queries on soft-deletable models MUST include `deletedAt: null` in the where clause
- Example: `where: { employeeId, deletedAt: null }`

## Multi-Tenancy Convention

- All data-access queries filter by `tenantId` from `req.user.tenantId`
- Employee lookups always scoped to tenant
- Tenant-specific config accessed via `TenantConfig` model
- Route files (`contexts/*/api/**`, `composition/dashboard.ts`, `composition/reports.ts`) build an
  `EmployeeScope` only via `employeeScopeFor(accessContextFromRequest(req), …)` from
  `contexts/platform` (#77), never as an object literal (`route-employee-scope-literals.test.ts`
  fails on one); jobs use `accessContextForJob(tenantId, job)`. Both, like `employeeScopeWhere()`,
  throw `AccessContextError` on an empty tenant (500 via `app.ts`; a foreign id stays 404). Keep
  `const tenantId = req.user.tenantId` for Prisma filters — the gate below reads only that (#226).

Salon context and salon-filter rules (Issues #82, #563, #84, #547, #85, #558, #647, #589, #542): see `.claude/rules/salon-filters.md`.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Pattern Overview

- Three-tier architecture: SvelteKit SPA (client-only rendering) -> Fastify REST API -> PostgreSQL via Prisma ORM
- Multi-tenant isolation via `tenantId` on every employee-scoped query
- Plugin-based API composition using Fastify's `register` + `decorate` pattern
- All data mutations produce audit log entries for compliance (Revisionssicherheit)
- Soft-delete on all core models (`deletedAt`) -- never hard-delete time/leave/absence data
- Background cron jobs run in-process via `node-cron` (no external job queue)

## Layers

- Purpose: REST API handling all business logic, authentication, validation, and data access
- Location: `apps/api/src/`
- Contains: Route handlers, Fastify plugins, middleware, utility functions, tests
- Depends on: `@clokr/db` (Prisma client), `@clokr/types` (shared types)
- Used by: Web frontend via HTTP proxy, NFC terminals, external API keys
- Purpose: SvelteKit SPA serving the UI; no server-side data fetching, all API calls from browser
- Location: `apps/web/src/`
- Contains: Svelte 5 components (runes), stores, API client, route pages
- Depends on: `@clokr/types` (shared types)
- Used by: End users (employees, managers, admins) via browser
- Purpose: Prisma schema, generated client, seed data
- Location: `packages/db/`
- Contains: `packages/db/prisma/schema.prisma`, generated Prisma client, seed script
- Depends on: PostgreSQL (via `@prisma/adapter-pg`)
- Used by: API server (imports `@clokr/db` for all DB access)
- Purpose: Shared TypeScript type definitions between API and web
- Location: `packages/types/src/index.ts`
- Contains: Role, Employee, TimeEntry, LeaveRequest, OvertimeAccount interfaces
- Used by: Both `@clokr/api` and `@clokr/web`
- Purpose: Model Context Protocol server for Claude Code dev tooling
- Location: `packages/mcp/src/index.ts`
- Contains: MCP tools for querying the Clokr API during development
- Used by: Claude Code during development only
- Purpose: Tauri desktop app for NFC card-based clock-in/out at physical terminals
- Location: `apps/nfc-client/`
- Contains: Tauri Rust shell + web frontend, communicates with API
- Used by: Physical NFC terminal hardware
- Purpose: Playwright end-to-end tests
- Location: `apps/e2e/`
- Contains: Playwright test specs, config

## Data Flow

- Client-side state uses Svelte writable stores (`$stores/auth.ts`, `$stores/toast.ts`, `$stores/theme.ts`)
- Page-level state uses Svelte 5 `$state` and `$derived` runes within each `+page.svelte`
- No global state management library; each page fetches its own data via `api.get()` in `onMount`
- Auth tokens persisted in `localStorage`

## Key Abstractions

- Purpose: Encapsulate cross-cutting concerns as decoratable services on the Fastify instance
- Examples: `apps/api/src/contexts/platform/plugins/prisma.ts`, `apps/api/src/contexts/platform/plugins/audit.ts`, `apps/api/src/contexts/platform/plugins/mailer.ts`, `apps/api/src/contexts/platform/plugins/notify.ts`, `apps/api/src/contexts/platform/plugins/storage.ts`, `apps/api/src/contexts/scheduling/plugins/scheduler.ts`
- Pattern: Each plugin uses `fastify-plugin` (`fp()`) to register, calls `app.decorate()` to add services, and augments the `FastifyInstance` type via `declare module "fastify"`. Accessed everywhere as `app.prisma`, `app.audit()`, `app.notify()`, `app.mailer`, `app.storage`.
- Purpose: Group related API endpoints by domain
- Examples: `apps/api/src/contexts/time-tracking/api/time-entries.ts`, `apps/api/src/contexts/platform/api/employees.ts`, `apps/api/src/contexts/absence/api/leave.ts`, `apps/api/src/contexts/platform/api/auth.ts`
- Pattern: Each exports an `async function xxxRoutes(app: FastifyInstance)` that registers GET/POST/PUT/DELETE handlers. Registered in `apps/api/src/app.ts` with URL prefix (e.g., `{ prefix: "/api/v1/time-entries" }`).
- Purpose: JWT/API-key authentication and permission-based authorization (Phase 75b, Issue #75)
- Location: `apps/api/src/middleware/auth.ts` (authentication only) + `apps/api/src/contexts/platform/request-permissions.ts` (authorization), reached through `contexts/platform/index.ts`
- Pattern: `requireAuth` verifies JWT or API key (`clk_` prefix). Access decisions use catalog permissions (`docs/permissions.md`): `requirePermission("<resource>:<action>:<reach>")` / `requireAnyPermission(...)` as `preHandler`, `hasPermission(req, key)` / `permissionReach(req, "<resource>:<action>")` inside a handler, `userIdsHoldingPermission(db, tenantId, key)` for notification recipients. `requireRole` no longer exists, and a role comparison in `apps/api/src` fails `lint:role-checks` (see "Role-check gate" below). A new route states its permission and gets a row in `docs/permissions.md`.
- Purpose: Cron-based background tasks running in the API process
- Plugins: `apps/api/src/contexts/time-tracking/plugins/attendance-checker.ts` (6 cron jobs), `apps/api/src/contexts/scheduling/plugins/scheduler.ts` (Phorest sync), `apps/api/src/contexts/working-time-account/plugins/auto-close-month.ts` (monthly close), `apps/api/src/contexts/platform/plugins/data-retention.ts` (annual archival)
- Pattern: Each plugin registers cron tasks via `node-cron`, starts in `onReady` hook, stops in `onClose` hook. Tasks are tenant-aware (loop over all tenants).
- Purpose: Typed HTTP client wrapping fetch with auth token injection and auto-refresh
- Location: `apps/web/src/lib/api/client.ts`
- Pattern: `api.get<T>()`, `api.post<T>()`, `api.put<T>()`, `api.patch<T>()`, `api.delete<T>()`. Auto-retries on 401 after token refresh. Throws `ApiError` with status code.
- Purpose: Separate authenticated app pages from public auth pages via layout groups
- `(app)` group: `apps/web/src/routes/(app)/` -- requires auth, has sidebar/nav layout
- `(auth)` group: `apps/web/src/routes/(auth)/` -- public pages (login, registration, password reset)

## Entry Points

- Location: `apps/api/src/index.ts`
- Triggers: `tsx watch src/index.ts` (dev) or `node dist/index.js` (prod)
- Responsibilities: Calls `buildApp()` from `apps/api/src/app.ts`, starts Fastify on configured port
- Location: `apps/api/src/app.ts`
- Triggers: Called by `index.ts` and by test setup
- Responsibilities: Creates Fastify instance, registers all plugins, middleware, and routes. Exports `buildApp()` for both production and test usage.
- Location: `apps/web/src/hooks.server.ts`
- Triggers: SvelteKit server startup
- Responsibilities: API proxy (forwards `/api/*` to Fastify backend), CSP headers, structured logging
- Location: `apps/web/src/routes/+page.svelte`
- Triggers: Navigation to `/`
- Responsibilities: Redirects to `/dashboard` (if authenticated) or `/login` (if not)
- Location: `apps/api/src/config.ts`
- Triggers: API startup
- Responsibilities: Validates all environment variables via Zod schema, exits with error if invalid

## Error Handling

- **Zod validation errors**: Global Fastify error handler in `apps/api/src/app.ts` catches `ZodError`, returns 400 with German field-level messages (`"Validierungsfehler"`)
- **Auth errors**: Middleware returns 401/403 directly via `reply.code()`
- **Business logic errors**: Route handlers return specific HTTP codes (404, 409, 422) with German error messages
- **Client errors**: `apps/web/src/lib/api/client.ts` throws `ApiError` with status and message, consumed by page-level `try/catch`
- **Client-side logging**: `apps/web/src/lib/utils/logger.ts` captures `window.onerror` and `unhandledrejection`, sends to `POST /api/v1/logs/client`
- **Server errors**: Fastify logger (Pino) with structured JSON output; supports pretty (dev), JSON, and ECS (Elastic) formats

## Cross-Cutting Concerns

- API: Pino via Fastify, configurable format (pretty/json/ecs), optional file output via `pino-roll`
- Web server: Structured JSON logging in `hooks.server.ts`
- Client: `clientLogger` in `apps/web/src/lib/utils/logger.ts` sends errors to API endpoint
- Request logging: `onResponse` hook logs method, URL, status, response time
- All API input validated via Zod schemas defined at the top of each route file
- Environment variables validated via Zod in `apps/api/src/config.ts`
- Frontend relies on API-side validation; forms submit and display API error messages
- JWT-based with access/refresh token pair
- API key support (`clk_` prefix) for programmatic access
- Terminal API keys for NFC devices (separate model)
- Session timeout with client-side inactivity detection
- Account lockout after configurable failed attempts
- Every employee belongs to a `Tenant` via `tenantId`
- JWT payload includes `tenantId`; all queries filter by it
- `TenantConfig` holds per-tenant settings (work hours, SMTP, compliance rules, etc.)
- Background jobs iterate over all tenants
- `app.audit()` plugin creates `AuditLog` entries with userId, action, entity, entityId, old/new values, IP, user agent
- Required for all create/update/delete operations on core models
- SYSTEM user ID used for automated actions (cron jobs)

<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## Delivery Process

**Read `docs/PROCESS.md` before triaging issues, planning a milestone, or wondering where a
piece of work should come from.** Short version:

- `Capture → Inbox → Triage → Ready → GSD → Ship → Release`
- Board: **Clokr Delivery** (https://github.com/users/sebastianzabel/projects/1), Status
  `Inbox / Backlog / Ready / In Progress / In Review / Done`, 2-week iterations. Work type is
  the `bug`/`feature`/`chore` **label**, not a board field.
- **GitHub Milestone = GSD Milestone. GitHub Issue = GSD Phase.** A plan is GSD-internal and
  has no GitHub counterpart.
- **Max. 5 issues per sprint.** New work in means old work out — back to Backlog, not
  alongside. Chores do not count.
- **`Ready` is a contract, not a mood:** acceptance criteria complete, Iteration
  - Milestone set. **Do not start a phase from an issue that is not Ready** — the acceptance
    criteria are the input to `/gsd-discuss-phase`.
- `main` is the only line. The 1.9.x patch line is retired; there are no release branches.

`.planning/` is gitignored, so an issue can never link to a planning artifact. The commit
scope (`fix(104-11): …`) is what ties issue and phase together in the history.

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

**The commands are `/gsd-<name>`, never `/gsd:<name>`.** Those are two different products. GSD's
development moved to `open-gsd/gsd-core` (npm `@opengsd/gsd-core`) in May 2026 over trust and
ownership concerns about the former upstream; the predecessor `get-shit-done-cc` is frozen at
1.42.3 (last published 2026-05-23) and is not to be installed. A stale local copy of it lived in
this repo's gitignored `.claude/` until 2026-09-22 and shadowed every command with a colon-named
twin — running `/gsd:update` would have reinstalled the abandoned package. It is gone; only the
global gsd-core install remains. If a colon-named command reappears, something reinstalled the
wrong package.

## Worktree Merge Safety

When GSD executor worktrees merge back into the main branch, **the merge can silently overwrite changes from a previous plan** if both plans modified the same file. This has caused data loss before (Phase 04-03 DATEV changes overwritten by Phase 05-03 worktree merge).

**Mandatory steps after every worktree merge:**

1. Run `git diff HEAD~1 HEAD -- <files-the-plan-touched>` immediately after the merge commit
2. Verify that the expected changes from the previous plan are still present in each shared file
3. If any changes are missing, create a restore commit immediately — do not continue with the next plan
4. Files most at risk: any file modified by more than one plan in the same phase (e.g. `reports.ts`, `schema.prisma`)

**When merging a PR to main:** always run `git diff <branch>..main` before the PR is considered complete to catch any regressions introduced by the merge commit itself (e.g. reviewer edits on GitHub that don't flow back to the local branch).

<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.

<!-- GSD:profile-end -->
