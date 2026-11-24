---
paths:
  - "apps/api/src/contexts/platform/**"
  - "apps/api/src/composition/operator-*"
  - "apps/api/src/middleware/**"
  - "apps/api/src/**/plugins/**"
  - "apps/api/src/app.ts"
  - "apps/api/src/config.ts"
  - "apps/web/src/routes/**/betreiber/**"
  - "apps/web/src/lib/operator/**"
  - "apps/web/src/lib/stores/**"
  - "apps/web/src/hooks.server.ts"
  - "apps/api/src/__tests__/*operator*"
  - "apps/api/src/__tests__/*support-access*"
  - "apps/api/src/__tests__/*tenant-packages*"
  - "apps/api/scripts/**"
  - "packages/db/prisma/**"
---

Moved verbatim from CLAUDE.md (§ Operator principal and tenant deactivation (Phase 88, Issue #88)).

### Operator principal and tenant deactivation (Phase 88, Issue #88)

The operator is the account ABOVE the tenant (tenant create, rename, deactivate, reactivate). Rules,
as built (`docs/adr/0001-abweichungen.md` Eintrag Y):

- **A separate principal, never a role.** `OperatorAccount` is no `User` and no `Role` value. Its sign-in
  with a mandatory TOTP lives in `contexts/platform/operator-credentials.ts` and
  `contexts/platform/api/operator/auth.ts`; accounts are created only with
  `apps/api/scripts/operator-account.ts`. There is no registration route.
- **Own optional secret.** `OPERATOR_JWT_SECRET` (`config.ts`) is distinct from `JWT_SECRET` and
  optional: unset, no operator route is registered and the surface is absent (404), proven by
  `operator-surface-off-88.test.ts`. Never default it, never fall back to `JWT_SECRET`.
- **Two guards that refuse each other.** `requireOperator` accepts only operator tokens,
  `requireAuth` only tenant tokens; presenting the wrong kind answers 403 and writes an
  `OperatorAuditLog` row (`operator-auth-88.test.ts`, `tenant-principal-guard-88.test.ts`).
- **An MFA reset or a deactivation ends every issued operator token at once (Issue #557).**
  `OperatorAccount.tokenVersion` is incremented in the same transaction as the `OPERATOR_MFA_RESET` /
  `OPERATOR_DEACTIVATED` audit row (`newValue.sessionsRevoked`) and is carried by every operator token as
  the claim `ver`. `requireOperator` (every request, never cached) and `/verify` (the pending challenge)
  compare it only through `operatorTokenIsCurrent()` in `contexts/platform/operator-auth.ts`; a token
  without an integer `ver` is refused with 401.
- **Operator code is blind to tenant data.** Files under `contexts/platform/api/operator/` never read
  `req.user`, never build an access context (`employeeScopeFor`, `accessContextFromRequest`), never call
  `app.audit()` and never read `user`, `employee` or `auditLog`; every route carries a rate limit. A
  source scan in `operator-auth-88.test.ts` fails on a violation. Operator responses carry tenant
  metadata and, since Phase 89, salon master data including the Phorest branch id — never employee
  data and never counts (no time-entry, assignment or employee numbers, Issue #89 D-14a), with two
  documented exceptions. **The SECOND documented exception (Issue #93):** person data under an active
  support access — the operator reads a curated, read-only slice of ONE tenant's person data, only
  through `composition/operator-support-ports.ts`, never in the route files themselves (see the
  support-access bullet below); D-14a still binds every other operator response.
  **The first documented exception (Issue #90):**
  `GET /api/v1/operator/dashboard` is the only operator response that carries numbers — per tenant
  the active and total salons, the active employees (not anonymized, not exited before today, UTC)
  and the UTC day of the newest login of any user of the tenant, plus totals and the inactive flag.
  They are computed only by `operatorTenantMetrics()` in
  `contexts/platform/facade/operator-metrics.ts` (Unterbau, deliberately NOT re-exported from
  `index.ts`); aggregates only, never a person, a person's id, a time entry or a saldo, and the
  operator route files themselves still never read the person models. The inactivity threshold
  lives once in `OPERATOR_INACTIVITY_DAYS` (30) and is served as `inactivityDays`; a tenant is
  inactive only when it is not deactivated and has no login or none within that window. Every
  successful call writes `DASHBOARD_VIEWED` (retention class AUTH_EVENT, 12 months) in the same
  transaction. D-14a still binds every other operator response, and the dashboard is no precedent
  for a new number. Known limit: the facade reads no `TimeEntry`, so a tenant that only clocks at
  terminals shows as inactive. Details: `docs/adr/0001-abweichungen.md` Eintrag Y, Nachtrag
  Issue #90. The ONE FILE that writes operator-actor rows into a
  tenant `AuditLog` is `contexts/platform/operator-tenant-audit.ts` (first-admin creation, salon and
  coupling changes; actor `{ type: "OPERATOR", operatorId, tenantId }`; guard
  `operator-tenant-audit-89.test.ts` fails on any other file spelling that actor shape). Rows
  written since Phase 89 carry `actor.tenantId`, and the tenant `GET /audit-logs` shows them
  labelled „Betreiber“ — the salon and coupling rows as well as the first-admin creation rows of a
  tenant the operator created. Operator rows written before Phase 89 carry no stamp and stay
  invisible to the tenant (append-only, not backfilled).
- **Support access (Issue #93, Phase 93b).** A time-boxed, read-only, logged operator view of one
  tenant's person data; ADR `docs/adr/0001-abweichungen.md` Eintrag Y, Nachtrag Issue #93.
  - **Grant.** `SupportAccess` (Unterbau, an Erweiterung; `Tenant` and `OperatorAccount` FKs
    `onDelete: Restrict`) carries a reason of 10–500 trimmed characters and a duration of 1 / 4 / 8 / 24 h
    (default 1 h, never a free end time). `assertActiveSupportAccess()` in
    `contexts/platform/support-access.ts` is the ONE decider of "active": `endedAt` null AND
    `expiresAt > now` on the application clock, derived on every request, no cron; tenant and operator
    must match and a deactivated tenant is refused (409 `TENANT_DEACTIVATED`). One active grant per
    operator and tenant — a second request is 409 `SUPPORT_ACCESS_ALREADY_ACTIVE`, there is no silent
    extension; after an end or an expiry a NEW request with a new reason is needed. Creation takes the
    Tenant row `FOR NO KEY UPDATE` in READ COMMITTED (the race proof observes the block).
  - **Reads.** Seven operator routes: lifecycle under `/api/v1/operator/tenants/:id/support-access`
    (request, own history, end) and four curated GET reads under `…/support/…` (employees, one
    employee's month, contracts, the tenant audit log) with `Cache-Control: no-store`; no write method
    exists under `/support/`. Every read re-checks the grant INSIDE its audit transaction under the
    grant row's `FOR SHARE` lock (`runSupportRead`, `lockGrant`), so an end waits for in-flight read
    audits and no read audit follows a committed end. The data comes only from the ports of
    `composition/operator-support-ports.ts` and three allow-list facade reads (time-entries, day
    breaks, leave requests); excluded everywhere: free-text notes, reasons, documents, attests and
    day-break acknowledgements. `support-access-boundary-93.test.ts` pins grant-first, audit-first,
    GET-only and tenant-scoped ports by a source scan.
  - **Double protocol, audit first.** Every read writes `SUPPORT_DATA_READ` to the `OperatorAuditLog`
    (with IP) AND to the tenant `AuditLog` (actor-stamped, no IP) in ONE transaction BEFORE the read:
    no log, no data; a read that fails afterwards leaves an "attempted read" row. A refusal is 403
    `SUPPORT_ACCESS_REQUIRED` plus a `SUPPORT_ACCESS_REFUSED` row; start and end write
    `SUPPORT_ACCESS_STARTED` / `SUPPORT_ACCESS_ENDED` to both logs.
  - **Audit-log read is redacted by TYPE (D-17).** `redactSupportAuditValue()`
    (`contexts/platform/support-audit-redaction.ts`) keeps numbers, booleans, null, numeric strings,
    ISO dates/timestamps, UUIDs and UPPER_SNAKE control values and the structure; every other string
    becomes "[ausgeblendet]". Never a key-name deny-list — the next new free-text field would pass it.
    Window mandatory, at most 92 UTC calendar days, 50 rows per page.
  - **Tenant side.** `GET /api/v1/support-accesses` and `/:id` (`audit-log:read`) and
    `POST /api/v1/support-accesses/:id/end` (`tenant-settings:update`), both whole-tenant; the tenant
    sees the operator's `displayName` (never e-mail or IP), the reason, the window, the status and every
    read. A tenant end writes the `OperatorAuditLog` row with `operatorId` null and the tenant user in
    `newValue`. The operator's own end stays possible for a deactivated tenant (it only narrows the access). The web
    page „Support-Zugriffe“ under `/admin` lists, details and ends. At start every whole-tenant holder
    of `tenant-settings:update` gets an in-app notice (mail policy `never`; the link only for holders of
    `audit-log:read`, never a dead link), dismissed on end.
  - **Immutability and retention.** The second DB trigger of the project (after the `OperatorAuditLog`
    one): a `SupportAccess` row is never deleted and never edited, except the single NULL → value
    transition of `endedAt`/`endedBy`/`endedByUserId`; DELETE only under the flagged retention purge
    (`purgeExpiredSupportAccess`, 120 months, floored in the trigger), TRUNCATE refused. Test cleanup
    disables the trigger only inside `cleanupTestData`, never in app code. Limits (a DB table owner
    can drop the trigger; the reason is operator-authored free text; a grant outlives the 15-minute
    operator token): ADR Nachtrag Issue #93.
- **The operator console (Phase 89, Issue #89).** The UI lives at `/betreiber` in the same web app
  as the route group `(operator)`, with its own `sessionStorage` session (`$stores/operator-auth`,
  keys `clokr.operator.accessToken` / `.expiresAt`) and its own client `lib/operator/client.ts`
  without a refresh: a 401/403 sends the browser to `/betreiber/anmelden` with a `safeNext()` next
  path. The isolation scan `operator-isolation-89.test.ts` fails when an operator file imports the
  tenant session, client, logger or salon context. `hooks.server.ts` sets `frame-ancestors 'none'`
  and `X-Frame-Options: DENY` on `/betreiber`; the client logger drops its queue there, so operator
  errors never reach the tenant log endpoint. Nothing in the tenant app links to `/betreiber`, and
  the console pins theme salz on `<html>` (the mode follows the device) without writing the device's stored
  preferences (it restores them on leaving). Since Issue #90 the start page shows an „Übersicht“
  and the tenant list the columns Salons, Mitarbeitende and Letzte Aktivität with an „Inaktiv“
  badge, loaded with one `GET /operator/dashboard` next to the tenant list request. Logout clears the tab's session but cannot revoke the
  15-minute token server-side (accepted, T-89-14). The salon routes
  (`contexts/platform/api/operator/salons.ts`) call only the Unterbau salon facade and the coupling
  port of `composition/operator-salon-ports.ts` (Schichtplanung `facade/couplings.ts`); every
  change writes the `OperatorAuditLog` rows AND the tenant `AuditLog` rows in one transaction; a
  salon is never deleted (deactivate/activate only); the Bundesland is required on create; the
  coupling is Phorest or none. The `.card-animate` transform traps fixed dialogs inside an animated
  `Section` (#570) — the tenant page's „Mandant“ section therefore has no `animate`. Follow-ups:
  #567 (tenant-create SLUG/EMAIL conflict classification), #566 (packages per tenant).
- **Tenants are deactivated, never deleted.** `ACTIVE_TENANT_WHERE` (`contexts/platform/tenant-status.ts`)
  is the one spelling of "active tenant" in a query. A deactivated tenant is refused on every credential
  path (login after the password matched, OTP, refresh, password reset, invitation accept) and on every
  request of an already issued access token, API key or device key. The per-process state cache holds
  at most 10 s and is invalidated by `app.invalidateTenantState()` on every (de)activation. There is
  no tenant delete path and the business data is untouched.
- **Booked packages per tenant (Phase 566, Issue #566).** `Tenant.bookedModules` (`TenantModule`:
  `CHAIN`, `INTEGRATIONS`, `HARDWARE_CLOCK`, `ANALYTICS`) and `Tenant.salonQuota` (≥ 1, DB CHECK
  `Tenant_salonQuota_positive`) are written only by the operator (`PUT /api/v1/operator/tenants/:id/packages`;
  `TENANT_PACKAGES_CHANGED` in `OperatorAuditLog` plus the tenant `AuditLog` row `TenantPackages`, one
  transaction, nothing written for an unchanged body). They are decided only in
  `contexts/platform/tenant-packages.ts`: the effective salon limit is the quota with `CHAIN`, else 1; a
  create or activation takes the Tenant row `FOR NO KEY UPDATE` BEFORE it counts (lock order Tenant → Salon),
  and the operator write takes the same lock; a refusal is 409 `SALON_QUOTA_REACHED` / `MODULE_NOT_BOOKED`
  (`{ error, code }`, mapped once in `app.ts` through `PackageRefusalError`). The Grundversion (everything the
  law requires, system roles, roster, reports, one active salon) is never gated. Modules gate only setting up
  something NEW — nine sites: `createSalon` (active) and `activateSalon` (every caller: tenant, operator,
  provisioning), `createSalonCoupling` and the create branch of `setSalonCoupling` (replacing and removing
  stay free) plus the create branch of `PUT /integrations/phorest/config`, `POST /api-keys`,
  `POST /terminals`, `POST /admin/presence-sources`; and the `activityMinutes` of `GET /time-entries/summary`
  (`null` + `activityMinutesUnavailableReason: "MODULE_NOT_BOOKED"`; recording an activity stays free).
  Never retroactive: cancelling a module or lowering the quota deactivates, revokes and locks nothing, and
  reads, reports, PDFs, DATEV and exports keep working (`tenant-packages-never-retroactive-566.test.ts`).
  `packages-legal-core-isolation-566.test.ts` (AST) proves the legally required paths read no package and
  pins every gate before its create. `isMultiSalonTenant()` / `showSalonOptions()` never read packages. The
  web only displays: `GET /me/context` `packages` (`bookedModules`, `salonLimit`), `moduleBooked()` in
  `$stores/salon-context` (unknown state hides nothing) and `ModuleHint` at exactly six set-up spots under
  `/admin` (the fifth, Issue #563: the salon create action on `/admin/salons` when `CHAIN` is not booked and
  the active salons reach the salon limit; the sixth, Issue #624: the „Neue Rolle“ action of `/admin/roles`
  when `CHAIN` is not booked; never in clock, calendar or dashboard; existing items stay manageable). Test fixtures book
  everything (`FIXTURE_PACKAGES`, so recorded neutrality cells stay unchanged); package tests build their
  tenant with `seedGrundversionTenant`. Existing tenants keep what they use (migration
  `*_tenant_packages`, Bestandsschutz); run the read-only dry run `scripts/audit-566-package-backfill.ts`
  on int and prod BEFORE the deploy (`docs/migrations.md`, „Phase 566“). Since Issue #624 extended roles belong
  to `CHAIN`, for NEW creations only: `POST /roles`, `POST /roles/:id/copy` and `POST /role-assignments` with
  scope SALONS or PERSONS, and a `PATCH /role-assignments/:id` that switches an assignment to a reach type it did not have, answer 409 `MODULE_NOT_BOOKED` (the gate runs first, before the name check and the
  #78 four-eyes check; TENANT-scope assignments, PATCH and DELETE stay free; `resolveAccessReach` and
  `request-permissions.ts` never read packages, pinned by `packages-legal-core-isolation-566.test.ts`;
  behaviour in `role-chain-package-624.test.ts`). ADR: `docs/adr/0001-abweichungen.md` Eintrag Z.
- **Jobs: writing jobs skip, retention never skips.** Cron jobs that write (month close, attendance
  checks, Phorest sync, reminders) skip a deactivated tenant; the data-retention purge deliberately
  runs for it, because retention is a legal duty that does not end with the contract. The source-scan
  guard `cron-deactivated-tenants-88.test.ts` fails on a job without the filter.
- **Provisioning and employee creation each live in one place.** `tenant-provisioning.ts`
  (`provisionTenantWithAdmin`; tenant, config, first admin, invitation) and `employee-creation.ts`
  (also the invitation rule) — the employee route and the operator flow call the same code
  (`employee-creation-parity-88.test.ts`). Seeds carry a pinned copy of the provisioning rule because
  `packages/db` cannot import `apps/api` (`tenant-provisioning-88.test.ts` compares them). The
  default leave types of a new tenant are seeded through the composition seam
  `composition/tenant-onboarding.ts` and `ensureDefaultLeaveTypes()` of the absence context — the
  Unterbau never imports a business context.
- **A nullish tenant never reaches a Prisma call.** Prisma DROPS a filter whose value is `undefined`,
  so `where: { tenantId: undefined }` reads every tenant. `lint:tenant-scoping` fails on an optional
  tenant value in any Prisma call under `apps/api/src` (`lint-tenant-scoping-nullish-tenant.ts`); the
  fail-closed form is `?? ""`. The runtime twin is `operator-tenant-boundary-sweep-88.test.ts`.
  **A tenant token without a tenant is refused in one place (Issue #551).** Since #551 `requireAuth`
  refuses a verified tenant token (JWT or API key) whose `tenantId` is blank, whitespace-only, absent
  or not a string with 403 `{ error, code: "TENANT_REQUIRED" }`, before any permission check and before
  any query; no credential path issues such a token (login after the password matched, verify-otp,
  resend-otp, refresh before the rotation, change-password); `effectiveGrants` grants a blank tenant
  nothing (no legacy-role fallback). The rule lives only in `isBlankTenantId()`
  (`contexts/platform/tenant-status.ts`, defined in the zero-import leaf `access-context-error.ts`).
  `scripts/audit-551-users-without-employee.ts` lists the affected users (read-only).
  **An account without any permission is refused at sign-in in one place (Issue #539).** `POST
/auth/login` (after the password matched, before any OTP row or mail; audited as `LOGIN_REFUSED`
  with reason `NO_ROLE_ASSIGNED`), `verify-otp` and `refresh` (before the rotation, the stored token
  stays untouched) answer 403 `NO_ROLE_ASSIGNED_ERROR` (`{ error, code: "NO_ROLE_ASSIGNED" }`,
  defined in `contexts/platform/request-permissions.ts`, applied in `api/auth.ts`) when
  `effectivePermissionKeysForUser()` is empty; a wrong password keeps its 401. The code is the control
  value, the German text only display (the web shows the server's message and branches on neither).
