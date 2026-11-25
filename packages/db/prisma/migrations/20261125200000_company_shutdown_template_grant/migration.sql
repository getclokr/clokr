-- Issue #1079 - the global system-role template Salonmanager gains `company-shutdown:manage:ZUGEWIESEN`
-- (a Salonmanager manages the Betriebsurlaub of her own salons). Owner decision 25.11.2026 (A2, comment
-- on #1079), together with the relation change of the resource `company-shutdown` from MANDANT to
-- PERSON in the permission catalog (code, no data). An Unterbau semantic change (ADR
-- 0001-abweichungen, Nachtrag Issue #1079): the template widens for every existing account holding the
-- role, and a SALONS-scoped assignment holding the key - a customer copy included - starts to take
-- effect for its salons. A Betriebsurlaub for the whole Unternehmen and a Betriebsurlaub without
-- Urlaubsabzug (paid release, § 615 BGB) stay with whole-tenant reach, enforced by the route.
--
-- DATA ONLY: no table, column, index, type or constraint is created, altered or dropped
-- (`prisma migrate diff` against the migration history stays empty). It updates exactly ONE row, the
-- global Salonmanager template (fixed id, "tenantId" IS NULL). IDEMPOTENT and REPLAY-SAFE: the
-- distinctness guard on the stored array makes a replay a no-op, so it changes no row and no timestamp.
-- It assigns nothing to anyone - no "RoleAssignment" row, no "AuditLog" row. Customer copies of the
-- template are separate, tenant-owned rows and stay unchanged. Admin and Inhaber already hold the key.
--
-- Code identifies the row by id (apps/api/src/contexts/platform/system-roles.ts); the drift test
-- company-shutdown-template-migration-1079.test.ts proves the migrated row equals
-- SYSTEM_ROLE_PERMISSIONS.SALON_MANAGER, in catalog order. Changing the template again means a NEW
-- migration plus a code change there - never a hand-edit of this file or of earlier ones.

-- Salonmanager
UPDATE "AccessRole"
SET "permissions" = ARRAY[
      'employee:read:ZUGEWIESEN',
      'time-entry:read:ZUGEWIESEN',
      'time-entry:create:ZUGEWIESEN',
      'time-entry:update:ZUGEWIESEN',
      'time-entry:delete:ZUGEWIESEN',
      'time-entry:revalidate:ZUGEWIESEN',
      'retro-request:read:ZUGEWIESEN',
      'retro-request:create:ZUGEWIESEN',
      'retro-request:approve:ZUGEWIESEN',
      'leave-request:read:ZUGEWIESEN',
      'leave-request:create:ZUGEWIESEN',
      'leave-request:approve:ZUGEWIESEN',
      'leave-request:attest:ZUGEWIESEN',
      'leave-request:cancel:ZUGEWIESEN',
      'section9:read:ZUGEWIESEN',
      'section9:upload:ZUGEWIESEN',
      'section9:decide:ZUGEWIESEN',
      'leave-entitlement:read:ZUGEWIESEN',
      'leave-limit:manage:ZUGEWIESEN',
      'leave-plan:manage:ZUGEWIESEN',
      'company-shutdown:manage:ZUGEWIESEN',
      'vocational-school:read:ZUGEWIESEN',
      'month-correction:read:ZUGEWIESEN',
      'month-correction:create:ZUGEWIESEN',
      'month-correction:approve:ZUGEWIESEN',
      'shift:read:ZUGEWIESEN',
      'shift:plan:ZUGEWIESEN',
      'shift-pattern:read:ZUGEWIESEN',
      'availability:read:ZUGEWIESEN',
      'team-overview:read:ZUGEWIESEN'
    ]::text[],
    "updatedAt" = NOW()
WHERE "id" = '00000000-0000-4000-8000-00000000a005'
  AND "tenantId" IS NULL
  AND "permissions" IS DISTINCT FROM ARRAY[
      'employee:read:ZUGEWIESEN',
      'time-entry:read:ZUGEWIESEN',
      'time-entry:create:ZUGEWIESEN',
      'time-entry:update:ZUGEWIESEN',
      'time-entry:delete:ZUGEWIESEN',
      'time-entry:revalidate:ZUGEWIESEN',
      'retro-request:read:ZUGEWIESEN',
      'retro-request:create:ZUGEWIESEN',
      'retro-request:approve:ZUGEWIESEN',
      'leave-request:read:ZUGEWIESEN',
      'leave-request:create:ZUGEWIESEN',
      'leave-request:approve:ZUGEWIESEN',
      'leave-request:attest:ZUGEWIESEN',
      'leave-request:cancel:ZUGEWIESEN',
      'section9:read:ZUGEWIESEN',
      'section9:upload:ZUGEWIESEN',
      'section9:decide:ZUGEWIESEN',
      'leave-entitlement:read:ZUGEWIESEN',
      'leave-limit:manage:ZUGEWIESEN',
      'leave-plan:manage:ZUGEWIESEN',
      'company-shutdown:manage:ZUGEWIESEN',
      'vocational-school:read:ZUGEWIESEN',
      'month-correction:read:ZUGEWIESEN',
      'month-correction:create:ZUGEWIESEN',
      'month-correction:approve:ZUGEWIESEN',
      'shift:read:ZUGEWIESEN',
      'shift:plan:ZUGEWIESEN',
      'shift-pattern:read:ZUGEWIESEN',
      'availability:read:ZUGEWIESEN',
      'team-overview:read:ZUGEWIESEN'
    ]::text[];
