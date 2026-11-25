/**
 * Issue #606 — "Wer sieht meine Zeiten?": which stored roles can read one person's time entries.
 *
 * A sibling of `role-assignments.ts` (the holder lookup `userIdsHoldingPermission` and the
 * per-assignment evaluation `grantingAssignmentReaches` live there; this file asks them and
 * re-implements neither) and of `scope-filter.ts` (`timeEntryCoverage`, the D-09 TimeEntry rule
 * asked of a person). Read-only, evaluated live, never audited. Every exported function takes `db`
 * first and a REQUIRED `tenantId` (lint-facade-signatures F1/F3). NOT re-exported from
 * `contexts/platform/index.ts`: only the platform's own `api/me.ts` reads it, so no export of the
 * Unterbau changes (ADR 0002, Entscheidung 7).
 */
import type { Prisma } from "@clokr/db";
import type {
  TimeEntryReaderCoverage,
  TimeEntryReaderGroup,
  TimeEntryReaderPurpose,
} from "@clokr/types";
import type { PermissionKey } from "../permission-catalog";
import { roleGrants } from "../access-role";
import { NOT_ANONYMIZED_EMPLOYEE_WHERE } from "../employee-anonymization-filter";
import { timeEntryCoverage } from "../scope-filter";
import { currentAndFutureAssignmentSalonIds, homeSalonAt } from "./salon-assignments";
import { grantingAssignmentReaches, userIdsHoldingPermission } from "./role-assignments";
import { byCodeUnit } from "../../../utils/code-unit-order";

/**
 * Presentation only, decides no access: the permissions of a role that name WHY it reads time
 * entries (Issue #606, D-04). `hours` (Stundenkonto): the role corrects entries or reads the
 * overtime account; `payroll` (Lohnabrechnung): the role exports reports, Stammsalon reach only
 * (a report never follows an entry-only `workSalon` cover). `protection` (Arbeitsschutz) always
 * applies, because every reader sees the break and maximum-hours findings.
 */
const READER_HOURS_KEYS: readonly PermissionKey[] = [
  "time-entry:update:ZUGEWIESEN",
  "overtime:read:ZUGEWIESEN",
];
const READER_PAYROLL_KEY: PermissionKey = "report:export:ZUGEWIESEN";

function timeEntryReaderPurposes(
  accessRole: { readonly tenantId: string | null; readonly permissions: readonly string[] },
  coverage: TimeEntryReaderCoverage,
): TimeEntryReaderPurpose[] {
  const purposes: TimeEntryReaderPurpose[] = [];
  if (READER_HOURS_KEYS.some((key) => roleGrants(accessRole, key))) purposes.push("hours");
  if (coverage !== "workSalon" && roleGrants(accessRole, READER_PAYROLL_KEY)) {
    purposes.push("payroll");
  }
  purposes.push("protection");
  return purposes;
}

/** One granting assignment of a holder that can read the person's time entries. Platform-internal. */
export interface TimeEntryReaderAssignment {
  readonly holderUserId: string;
  readonly accessRoleId: string;
  readonly roleName: string;
  readonly coverage: TimeEntryReaderCoverage;
  readonly purposes: TimeEntryReaderPurpose[];
}

/**
 * Issue #606: every granting assignment of every holder of `time-entry:read:ZUGEWIESEN` that can
 * read at least one time entry of `employeeId` - now or once the person records one - through the
 * real read rule. Holders come from `userIdsHoldingPermission` (the one holder lookup; departed
 * ones are already dropped), minus the person's own user, narrowed to active users of a
 * non-anonymised employee of this tenant. Each granting assignment's own reach comes from
 * `grantingAssignmentReaches` (the path `resolveAccessReach` unions) and is judged by
 * `timeEntryCoverage` (scope-filter.ts, the D-09 TimeEntry rule); an assignment that covers nothing
 * is not listed. Carries holder ids, so it stays platform-internal (the pins use them); the route
 * answers {@link timeEntryReaderGroups}, which has none.
 */
export async function timeEntryReaderAssignments(
  db: Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
  userId: string,
  today: Date,
): Promise<TimeEntryReaderAssignment[]> {
  const holderIds = (
    await userIdsHoldingPermission(db, tenantId, "time-entry:read:ZUGEWIESEN")
  ).filter((id) => id !== userId);
  if (holderIds.length === 0) return [];

  const activeHolders = await db.user.findMany({
    where: {
      id: { in: holderIds },
      isActive: true,
      employee: { tenantId, ...NOT_ANONYMIZED_EMPLOYEE_WHERE },
    },
    select: { id: true },
  });
  if (activeHolders.length === 0) return [];

  const home = await homeSalonAt(db, tenantId, employeeId, today);
  const assignmentSalonIds = await currentAndFutureAssignmentSalonIds(
    db,
    tenantId,
    employeeId,
    today,
  );

  const coverageByReach = new Map<string, TimeEntryReaderCoverage | null>();
  const rows: TimeEntryReaderAssignment[] = [];
  for (const holder of activeHolders.map((h) => h.id).sort(byCodeUnit)) {
    for (const { accessRole, reach } of await grantingAssignmentReaches(
      db,
      tenantId,
      holder,
      "time-entry:read:ZUGEWIESEN",
    )) {
      const reachKey = JSON.stringify(reach);
      let coverage = coverageByReach.get(reachKey);
      if (coverage === undefined) {
        coverage = await timeEntryCoverage(
          db,
          tenantId,
          reach,
          employeeId,
          home?.salonId ?? null,
          assignmentSalonIds,
        );
        coverageByReach.set(reachKey, coverage);
      }
      if (coverage === null) continue;
      rows.push({
        holderUserId: holder,
        accessRoleId: accessRole.id,
        roleName: accessRole.name,
        coverage,
        purposes: timeEntryReaderPurposes(accessRole, coverage),
      });
    }
  }
  return rows;
}

const COVERAGE_ORDER: readonly TimeEntryReaderCoverage[] = [
  "wholeTenant",
  "homeSalon",
  "workSalon",
  "person",
];

/**
 * Issue #606: {@link timeEntryReaderAssignments} as the categories the person sees: role name,
 * coverage and purposes - no holder, no id, no head count. Deduplicated by (role, coverage), sorted
 * by coverage (company first) then role name.
 */
export async function timeEntryReaderGroups(
  db: Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
  userId: string,
  today: Date,
): Promise<TimeEntryReaderGroup[]> {
  const rows = await timeEntryReaderAssignments(db, tenantId, employeeId, userId, today);
  const groups = new Map<string, TimeEntryReaderGroup>();
  for (const row of rows) {
    const key = `${row.accessRoleId}:${row.coverage}`;
    if (!groups.has(key)) {
      groups.set(key, { roleName: row.roleName, coverage: row.coverage, purposes: row.purposes });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      COVERAGE_ORDER.indexOf(a.coverage) - COVERAGE_ORDER.indexOf(b.coverage) ||
      a.roleName.localeCompare(b.roleName, "de"),
  );
}

/**
 * Issue #606 (D-05): does the tenant have at least one active API key? An API key resolves to the
 * Admin or Manager system role and reads every time entry of the tenant, so the profile names
 * "Angebundene Programme" when one exists (no key name, no count). Active = not revoked and not
 * expired, the very rule of `requireAuth` (`middleware/auth.ts`).
 */
export async function tenantHasActiveApiKey(
  db: Prisma.TransactionClient,
  tenantId: string,
  now: Date,
): Promise<boolean> {
  const active = await db.apiKey.count({
    where: {
      tenantId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
  });
  return active > 0;
}
