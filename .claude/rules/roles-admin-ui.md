---
paths:
  - "apps/web/src/lib/roles/**"
  - "apps/web/src/lib/nav/**"
  - "apps/web/src/lib/components/admin/**"
  - "apps/web/src/routes/**/admin/**"
  - "apps/web/src/routes/**/verwalten/**"
  - "apps/api/src/contexts/platform/**"
  - "apps/api/src/__tests__/*role*"
  - "apps/api/src/__tests__/*permission*"
  - "packages/db/prisma/migrations/**"
  - "docs/permissions.md"
---

Moved verbatim from CLAUDE.md (§ Role management UI and the admin area (Issue #83)).

### Role management UI and the admin area (Issue #83)

- **Roles are assigned in one way (Issue #580).** The building block
  `lib/components/admin/roles/PersonRoleAssignments.svelte` (role + scope, several assignments) is used by
  `/admin/roles` „Zuweisungen“, the employee tab „Berechtigungen“ and the create dialog (draft mode). The
  wording lives only in `apps/web/src/lib/roles/assignment-label.ts` (guard
  `role-assignment-wording-one-place-580.test.ts`); role names come only from the stored roles (the
  administrator role reads „Admin“ everywhere). The create dialog sends no `role` (API default „Mitarbeiter“
  for the whole company; the API field stays for the CSV import and API clients); its drafts go through
  `POST /role-assignments` after the 201 (`lib/roles/assignment-drafts.ts`), a refusal keeps the person and
  opens `/admin/employees/<id>#berechtigungen`. Without `role-assignment:manage` nothing is requested (no read
  path exists without it). Escape closes only the top-most Modal.
- **Permission labels live once, on the server.** `contexts/platform/permission-labels.ts` holds the
  German heading per resource (the `docs/permissions.md` headings) and the German label per catalog
  key; `GET /api/v1/roles/permission-catalog` (`role:read`) serves them. `permission-labels.test.ts`
  pins the label set equal to the catalog; the web never names a permission
  (`permission-labels-one-place-83.test.ts`). A new catalog key needs a label in the same commit.
- **The four-eyes rule of #78 stays in the API.** The role editor (`/admin/roles`) reacts only to the
  409 code `FOUR_EYES_CONFIRMATION_REQUIRED` (create, update and copy) and resends with
  `confirm: true` after an explicit confirmation; every other rejection shows the server's message.
- **The web decides `/admin` access by permission, in one module.**
  `apps/web/src/lib/nav/admin-route-permissions.ts` maps every admin route to alternatives of all-of
  permission sets derived from the API guards its page calls; the admin layout guard, Sidebar, the
  mobile „Mehr“ sheet and the command palette read it. A new admin route needs an entry
  (`admin-route-permissions.test.ts` fails otherwise). Page-internal role checks that change content
  are #538; the fallback is gone since #539 Release A (owner decision, Unterbau Semantikänderung), the web session
  carries no role and the employee screen shows „Keine Rolle zugewiesen“ for a person without an assignment;
  the column and the enum are gone (Release B, #641).
- **System-role templates change only through a NEW data-only migration plus the constant (Issue
  #86).** Never edit the migration that created a template: add a migration (`UPDATE "AccessRole"`,
  `IS DISTINCT FROM` guard) and change `SYSTEM_ROLE_PERMISSIONS` in
  `contexts/platform/system-roles.ts` in the same commit; the DB row, the constant, the row in
  `docs/permissions.md` and the web persona fixture
  (`apps/web/src/lib/nav/__tests__/fixtures/system-role-permissions.json`) are pinned equal by drift
  tests and change together. The change applies to every existing account holding the role at once,
  so it is an Unterbau Semantikänderung (owner decision, ADR Nachtrag, runbook in `docs/migrations.md`).
  Since #86 the Personalabteilung template holds `report:read` and `salon:read` (owner decision
  16.10.2026) and never `report:export`, `employee:manage-access`, `employee:anonymize` or any
  time-entry/shift/team-overview key; the three `report:read` JSON responses are pinned day-free by
  `reports-hr-86.test.ts`, which fails on any per-day key a route grows later.
