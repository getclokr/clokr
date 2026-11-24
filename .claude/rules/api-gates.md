---
paths:
  - "apps/api/**"
  - "scripts/**"
  - ".husky/**"
  - ".github/**"
---

Moved verbatim from CLAUDE.md (§ Tenant-scoping gate (Issue #204); § Anti-vacuity gate (Issues #235/#240/#245); § T-100-09 route gate (Issue #259); § Role-check gate and neutrality recordings (Issue #75); § Ordered audit/notification reads in tests (Issue #561)).

### Tenant-scoping gate (Issue #204)

A new route or service handler that reads a client-supplied identifier into a tenant-scoped
Prisma model without constraining it to `req.user.tenantId` fails CI, not just review:

| Source                                                   | What it governs                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/api/scripts/lint-tenant-scoping.ts`                | The gate itself — scope, methods, and the three ways a call counts as scoped                            |
| `apps/api/scripts/lint-tenant-scoping-exceptions.json`   | Every deliberate exception, each with a mandatory reason                                                |
| `apps/api/scripts/lint-tenant-scoping-nullish-tenant.ts` | The nullish-tenant rule (Phase 88): an optional tenant value reaching a Prisma call fails the same gate |
| `apps/api/scripts/README.md` § Lint gates                | How to add a justified exception, and when NOT to                                                       |

Since Phase 89 the gate also accepts two strict inline forms: an `OR` only when every branch is
itself scoped, and a Json-path stamp `{ path: [..., "tenantId"], equals: <principal tenant> }` with
no other key (`apps/api/scripts/README.md` § `lint-tenant-scoping.ts`).

Each exception carries `validatedBy`, a text anchor quoting its tenant check (Issue #620; it replaced
the never-verified line number `validatedAt`). The gate resolves it on every run - it must still
occur in the file, mention the tenant and lie near a listed call - so a moved or reworded check
turns the run red while pure line shifts do not.

Verify with `pnpm --filter @clokr/api run lint:tenant-scoping`. A hit on a clean tree is a
finding to report (Issue #204), not an exception to add.

### Anti-vacuity gate (Issues #235/#240/#245)

A file that walks the source tree and asserts on the result without proving the walked set was
non-empty fails CI and `.husky/pre-commit`, not just review — a moved or emptied directory must
turn the gate red, never let it report success having checked nothing:

| Source                                                | What it governs                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/api/scripts/lint-guard-vacuity.ts`              | The gate itself — the AST classifier, `--check`/`--scope`/`--rows`                       |
| `apps/api/scripts/lint-guard-vacuity-exceptions.json` | Every deliberate exception, each with a mandatory reason                                 |
| `apps/api/scripts/README.md` § Lint gates             | How to add a justified exception, and when NOT to                                        |
| `docs/adr/0001-abweichungen.md` Eintrag I             | The as-built outcome, the exception register, and what this gate structurally cannot see |

Verify with `pnpm --filter @clokr/api exec tsx scripts/lint-guard-vacuity.ts --check 0`. A hit on a
clean tree is a finding to report, not an exception to add.

### T-100-09 route gate (Issue #259)

A tenant-scoped route with a path parameter that answers a foreign tenant's real entity
differently from an id that exists nowhere (a distinguishable status or body — a tenant-membership
oracle) fails CI, not just review — the tenant-scoping gate above only checks that the Prisma call
is scoped, not that the REJECTION is indistinguishable:

| Source                                                | What it governs                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api/scripts/lint-t100-09-routes.ts`             | The completeness gate — every path-parameter route must have exactly one register entry       |
| `apps/api/scripts/lint-t100-09-routes.json`           | The register: `probe` / `nicht anwendbar` / `bekannt-abweichend`, each with a measured reason |
| `apps/api/src/__tests__/t100-09-oracle-probe.test.ts` | The behavioral half — every `probe` route hit twice, status+body byte-compared                |
| `apps/api/scripts/README.md` § Lint gates             | The three categories, the two named out-of-scope boundaries, and how to add a justified entry |

Verify with `pnpm --filter @clokr/api run lint:t100-09-routes --check` (completeness) and
`pnpm --filter @clokr/api exec vitest run src/__tests__/t100-09-oracle-probe.test.ts` (behavior). A
hit on a clean tree is a finding to report, not an exception to add.

### Role-check gate and neutrality recordings (Issue #75)

Since Phase 75b the API decides access by permission, never by role. Since #539 (Release A) a
permission comes ONLY from stored role assignments: there is no legacy-role fallback, so a user
without a stored assignment holds nothing, and an active account whose effective permission set is
empty is refused at sign-in with 403 `NO_ROLE_ASSIGNED` (login, verify-otp and refresh). No token
carries a `role` claim any more (an old token that still has one is ignored — proven by
`token-claims-539.test.ts`), the login body has no `user.role`, and `actorRole` is no longer written
to new leave audit rows. Since Release B (#641) the column `User.role` and the Prisma enum `Role` no
longer exist (migration `*_drop_user_role`; the rollback to an image below v1.18.0 is data-preserving and rehearsed —
recreate type and column with the default, delete the `_prisma_migrations` row, see
`docs/migrations.md` „Phase 641“, step 5; a `pg_dump` restore is only the fallback): the role lives only in stored role assignments. The requested role
of `POST /employees` and the CSV import (the web form sends no role since #580; the API contract stays
`"ADMIN" | "MANAGER" | "EMPLOYEE"`) is the type `SystemRoleName` of
`apps/api/src/contexts/platform/system-role-assignment.ts` and only ever becomes a stored TENANT
assignment; the employee responses serve the DERIVED `user.role` (`deriveFormRole()`, `null` without an
assignment, shown as „Keine Rolle zugewiesen“). Nothing is written back to a column any more, so a role
change writes its `RoleAssignment` audit rows without `compatRole` and no UPDATE row on `User`; audit
rows written before Release B keep theirs (append-only). `legacy-role-reads-539.test.ts` keeps its
reader allowlist asserted EMPTY. A role comparison, a `requireRole(` call or a Prisma `where` on a role
value in non-test `apps/api/src` fails CI and `.husky/pre-commit` — in every file, with one named
exemption for the assignment logic (`contexts/platform/system-role-assignment.ts` may compare identifiers
typed `SystemRoleName`; it is no reader of a legacy column) and no exceptions file; a comparison of a
request payload's role lives in a helper of that file and is classified in `docs/permissions.md`
(„Nicht gezählte Treffer“):

| Source                                                                                                | What it governs                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/scripts/lint-role-checks.ts`                                                                | The gate itself — AST scan over every non-test API file, one named exemption (`SystemRoleName` in `system-role-assignment.ts`), no exceptions file                           |
| `docs/permissions.md`                                                                                 | Every guard, handler check and recipient lookup with its permission; `permission-site-mapping.test.ts` compares counts and permissions per file |
| `apps/api/src/__tests__/permission-neutrality-matrix.test.ts` + `neutrality/recorded/matrix.json`     | Every route × eight actors, recorded on the code BEFORE the switch                                                                              |
| `notification-recipients-neutrality.test.ts` / `activity-auth-neutrality.test.ts` + `recorded/*.json` | The 17 recipient lookups; activity feed and login role, same rule                                                                               |
| `docs/adr/0001-abweichungen.md` Eintrag N                                                             | What changed, the transition rules, and what was measured                                                                                       |

Verify with `pnpm --filter @clokr/api run lint:role-checks` and (after `test:setup`)
`pnpm --filter @clokr/api exec vitest run src/__tests__/permission-neutrality-matrix.test.ts`.
**Never re-record a neutrality file to make it green** — the recorders refuse once `requireRole`
is gone, and a red VERIFY is a finding (an access change), not a stale fixture. A new route gets
`requirePermission` and a row in `docs/permissions.md`; a new role check is never the answer.

### Ordered audit/notification reads in tests (Issue #561)

A test never picks an `AuditLog` or `Notification` row with `findFirst` (ordered or not), nor
indexes an unordered `findMany` by position — one action can write several rows in the same
millisecond, the test flakes in the parallel run (#555), and even an ordered `findFirst` silently
ignores a second write. Use `soleAuditRow[OrNull]()` / `soleNotification[OrNull]()` (throws unless
exactly one row matches), `auditRowsFor()` / `auditRowChangingField()` from
`apps/api/src/__tests__/setup.ts`, or a `findMany` with explicit length / all-row assertions; when a
test means one of several rows, narrow the `where` (action, recipient, field). `lint:unordered-test-reads`
(`apps/api/scripts/lint-unordered-test-reads.ts`, CI and pre-commit, no exceptions file) fails on it;
a hit is converted, never excepted.
