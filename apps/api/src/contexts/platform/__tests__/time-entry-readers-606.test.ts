/**
 * Issue #606 — the list "Wer sieht meine Zeiten?" is pinned against the REAL read rule:
 *
 * - Pin 1: the listed holders equal what `resolveScopedHolderIds` keeps with `timeEntryCoverage`.
 * - Pin 2: a listed holder's reach really puts the person's entry in scope (`isTimeEntryInScope`),
 *   and no eligible, unlisted holder reaches any of the person's entries (`scopedTimeEntryIds`).
 * - Pin 4: every system role that exports reports or reads the team overview also reads time entries,
 *   so the known limit of D-02 (a custom role holding only those keys is not listed) concerns custom
 *   roles only. Pin 3 (HTTP) lives in `__tests__/me-time-entry-readers-606.test.ts`.
 *
 * No person names in fixtures (CLAUDE.md PII rule).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { TimeEntryReaderCoverage } from "@clokr/types";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  numericEmployeeNumber,
} from "../../../__tests__/setup";
import { timeEntryReaderAssignments, timeEntryReaderGroups } from "../facade/time-entry-readers";
import {
  resolveAccessReach,
  resolveScopedHolderIds,
  userIdsHoldingPermission,
} from "../facade/role-assignments";
import { currentAndFutureAssignmentSalonIds, homeSalonAt } from "../facade/salon-assignments";
import { isTimeEntryInScope, scopedTimeEntryIds, timeEntryCoverage } from "../scope-filter";
import { SYSTEM_ROLE_IDS, SYSTEM_ROLE_PERMISSIONS } from "../system-roles";
import { normalizeRolePermissions, roleNameKey } from "../access-role";
import type { AccessContext } from "../access-context";

type Seed = Awaited<ReturnType<typeof seedTestData>>;

const READ = "time-entry:read:ZUGEWIESEN" as const;

describe("Issue #606 — time-entry reader list against the real read rule", () => {
  let app: FastifyInstance;
  let t: Seed;
  let other: Seed;
  let salonA: { id: string };
  let salonB: { id: string };
  let salonC: { id: string };
  let salonD: { id: string };
  let salonI: { id: string };
  let salonX: { id: string };
  const year = new Date().getUTCFullYear();
  const today = new Date();

  const holderIds: Record<string, string> = {};
  const entryIdsByPerson = new Map<string, string[]>();

  function suffix(label: string): string {
    return `${label}-${crypto.randomBytes(3).toString("hex")}`;
  }

  async function createPerson(
    label: string,
    options: { tenantId?: string; isActive?: boolean; exitDate?: Date; anonymized?: boolean } = {},
  ) {
    const s = suffix(label);
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@test.de`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: options.isActive ?? true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: options.tenantId ?? t.tenant.id,
        userId: user.id,
        employeeNumber: numericEmployeeNumber(),
        firstName: options.anonymized ? "Gelöscht" : `Vorname${s}`,
        lastName: options.anonymized ? `GELÖSCHT-${s}` : `Nachname${s}`,
        hireDate: new Date("2020-01-01"),
        ...(options.exitDate ? { exitDate: options.exitDate } : {}),
      },
    });
    return { user, employee };
  }

  function assignment(
    userId: string,
    accessRoleId: string,
    scope: {
      scopeType: "TENANT" | "SALONS" | "PERSONS";
      salonIds?: string[];
      employeeIds?: string[];
    },
    tenantId = t.tenant.id,
  ) {
    return app.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId,
        accessRoleId,
        scopeType: scope.scopeType,
        salonIds: scope.salonIds ?? [],
        employeeIds: scope.employeeIds ?? [],
      },
    });
  }

  function salonAssignment(
    employeeId: string,
    salonId: string,
    kind: "HOME" | "DEPLOYMENT",
    validFrom: string,
    validUntil: string | null,
  ) {
    return app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: t.tenant.id,
        employeeId,
        salonId,
        kind,
        validFrom: new Date(validFrom),
        validUntil: validUntil ? new Date(validUntil) : null,
        weekdays: [],
      },
    });
  }

  async function entry(employeeId: string, salonId: string, date: string) {
    const row = await app.prisma.timeEntry.create({
      data: {
        employeeId,
        salonId,
        date: new Date(date),
        startTime: new Date(`${date}T08:00:00Z`),
        endTime: new Date(`${date}T16:00:00Z`),
        source: "MANUAL",
      },
    });
    entryIdsByPerson.set(employeeId, [...(entryIdsByPerson.get(employeeId) ?? []), row.id]);
    return row;
  }

  async function salonManager(
    label: string,
    salonIds: string[],
    overrides: Parameters<typeof createPerson>[1] = {},
  ) {
    const person = await createPerson(label, overrides);
    const row = await assignment(person.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      scopeType: "SALONS",
      salonIds,
    });
    holderIds[label] = person.user.id;
    return { ...person, row };
  }

  async function listed(employeeId: string, userId: string) {
    return timeEntryReaderAssignments(app.prisma, t.tenant.id, employeeId, userId, new Date());
  }

  function coverageOf(rows: Awaited<ReturnType<typeof listed>>, label: string) {
    return rows.filter((r) => r.holderUserId === holderIds[label]).map((r) => r.coverage);
  }

  // The persons of the scenarios.
  let p0: Awaited<ReturnType<typeof createPerson>>; // Stammsalon A, nothing else
  let p1: Awaited<ReturnType<typeof createPerson>>; // Stammsalon A, one entry in salon C
  let p2: Awaited<ReturnType<typeof createPerson>>; // moved from B to A, entry in the B period recorded in A
  let p3: Awaited<ReturnType<typeof createPerson>>; // Stammsalon A, Springer in D (and later I)

  beforeAll(async () => {
    app = await getTestApp();
    t = await seedTestData(app, "rd606p");
    other = await seedTestData(app, "rd606q");
    salonA = { id: t.salonId };
    salonB = await createTestSalon(app.prisma, t.tenant.id, { name: "Rd606 B" });
    salonC = await createTestSalon(app.prisma, t.tenant.id, { name: "Rd606 C" });
    salonD = await createTestSalon(app.prisma, t.tenant.id, { name: "Rd606 D" });
    salonI = await createTestSalon(app.prisma, t.tenant.id, { name: "Rd606 I" });
    salonX = await createTestSalon(app.prisma, t.tenant.id, { name: "Rd606 X" });

    p0 = await createPerson("p0");
    p1 = await createPerson("p1");
    p2 = await createPerson("p2");
    p3 = await createPerson("p3");
    for (const p of [p0, p1, p3]) {
      await salonAssignment(p.employee.id, salonA.id, "HOME", "2020-01-01", null);
    }
    await salonAssignment(p2.employee.id, salonB.id, "HOME", "2020-01-01", `${year - 1}-06-30`);
    await salonAssignment(p2.employee.id, salonA.id, "HOME", `${year - 1}-07-01`, null);
    await salonAssignment(p3.employee.id, salonD.id, "DEPLOYMENT", `${year - 1}-01-01`, null);
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, t.tenant.id);
      await cleanupTestData(app, other.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("lists a holder for an entry recorded in a salon without any assignment, and drops it when that entry is soft-deleted", async () => {
    const sm = await salonManager("sm-c", [salonC.id]);
    expect(coverageOf(await listed(p1.employee.id, p1.user.id), "sm-c")).toEqual([]);
    const row = await entry(p1.employee.id, salonC.id, `${year - 1}-03-10`);
    expect(coverageOf(await listed(p1.employee.id, p1.user.id), "sm-c")).toEqual(["workSalon"]);
    await app.prisma.timeEntry.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    expect(coverageOf(await listed(p1.employee.id, p1.user.id), "sm-c")).toEqual([]);
    expect(sm.row.id).toBeTruthy();
  });

  it("uses the Stammsalon at the entry date: a former Stammsalon with an entry of that time is workSalon", async () => {
    await salonManager("sm-b", [salonB.id]);
    expect(coverageOf(await listed(p2.employee.id, p2.user.id), "sm-b")).toEqual([]);
    // Recorded in salon A during the period in which salon B was the Stammsalon.
    await entry(p2.employee.id, salonA.id, `${year - 1}-03-10`);
    expect(coverageOf(await listed(p2.employee.id, p2.user.id), "sm-b")).toEqual(["workSalon"]);
  });

  it("lists a Springer deployment as workSalon and keeps payroll off a workSalon row", async () => {
    await salonManager("sm-d", [salonD.id]);
    const payrollRole = await app.prisma.accessRole.create({
      data: {
        tenantId: t.tenant.id,
        name: `Lohn ${suffix("r")}`,
        nameKey: roleNameKey(`Lohn ${suffix("r")}`),
        permissions: normalizeRolePermissions([READ, "report:export:ZUGEWIESEN"]),
      },
    });
    const payroll = await createPerson("payroll");
    holderIds["payroll-d"] = payroll.user.id;
    await assignment(payroll.user.id, payrollRole.id, {
      scopeType: "SALONS",
      salonIds: [salonD.id],
    });
    const homePayroll = await createPerson("payroll-home");
    holderIds["payroll-a"] = homePayroll.user.id;
    await assignment(homePayroll.user.id, payrollRole.id, {
      scopeType: "SALONS",
      salonIds: [salonA.id],
    });

    const rows = await listed(p3.employee.id, p3.user.id);
    expect(coverageOf(rows, "sm-d")).toEqual(["workSalon"]);
    expect(rows.find((r) => r.holderUserId === holderIds["payroll-d"])).toMatchObject({
      coverage: "workSalon",
      purposes: ["protection"],
    });
    expect(rows.find((r) => r.holderUserId === holderIds["payroll-a"])).toMatchObject({
      coverage: "homeSalon",
      purposes: ["payroll", "protection"],
    });
  });

  it("never lists a deactivated salon, an inactive user, a departed or anonymised holder, a foreign tenant or a malformed row; a future exit still counts", async () => {
    // A deactivated salon: listed while active (Springer deployment), gone after the deactivation.
    await salonAssignment(p3.employee.id, salonI.id, "DEPLOYMENT", `${year - 1}-01-01`, null);
    await salonManager("sm-i", [salonI.id]);
    expect(coverageOf(await listed(p3.employee.id, p3.user.id), "sm-i")).toEqual(["workSalon"]);
    await app.prisma.salon.update({
      where: { id: salonI.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    expect(coverageOf(await listed(p3.employee.id, p3.user.id), "sm-i")).toEqual([]);

    await salonManager("sm-inactive", [salonA.id], { isActive: false });
    await salonManager("sm-departed", [salonA.id], { exitDate: new Date(`${year - 1}-12-31`) });
    await salonManager("sm-future-exit", [salonA.id], { exitDate: new Date(`${year + 2}-12-31`) });
    await salonManager("sm-anonymized", [salonA.id], { anonymized: true });

    // A malformed stored row (SALONS without a salon id) contributes nothing.
    const malformed = await createPerson("malformed");
    holderIds.malformed = malformed.user.id;
    await assignment(malformed.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      scopeType: "SALONS",
      salonIds: [],
    });

    // A role of another tenant, assigned inside this tenant, and the other tenant's own admin.
    const foreignRole = await app.prisma.accessRole.create({
      data: {
        tenantId: other.tenant.id,
        name: `Fremd ${suffix("f")}`,
        nameKey: roleNameKey(`Fremd ${suffix("f")}`),
        permissions: normalizeRolePermissions([READ]),
      },
    });
    const foreignRoleHolder = await createPerson("foreign-role");
    holderIds["foreign-role"] = foreignRoleHolder.user.id;
    await assignment(foreignRoleHolder.user.id, foreignRole.id, { scopeType: "TENANT" });

    const rows = await listed(p0.employee.id, p0.user.id);
    for (const label of [
      "sm-inactive",
      "sm-departed",
      "sm-anonymized",
      "malformed",
      "foreign-role",
    ]) {
      expect(coverageOf(rows, label), label).toEqual([]);
    }
    expect(coverageOf(rows, "sm-future-exit")).toEqual(["homeSalon"]);
    const names = (
      await timeEntryReaderGroups(app.prisma, t.tenant.id, p0.employee.id, p0.user.id, new Date())
    ).map((g) => g.roleName);
    expect(names.some((n) => n.startsWith("Fremd"))).toBe(false);
    // The other tenant's admin never shows up for this tenant's person.
    expect(rows.some((r) => r.holderUserId === other.adminUser.id)).toBe(false);
  });

  it("Pin 1: the listed holders equal what resolveScopedHolderIds keeps with timeEntryCoverage", async () => {
    // A Salonmanager of an unrelated salon, so the two sets are not trivially equal.
    await salonManager("sm-x", [salonX.id]);
    for (const person of [p0, p1, p2, p3]) {
      const rows = await listed(person.employee.id, person.user.id);
      const holders = (await userIdsHoldingPermission(app.prisma, t.tenant.id, READ)).filter(
        (id) => id !== person.user.id,
      );
      const eligible = (
        await app.prisma.user.findMany({
          where: {
            id: { in: holders },
            isActive: true,
            employee: {
              tenantId: t.tenant.id,
              NOT: { firstName: "Gelöscht", lastName: { startsWith: "GELÖSCHT-" } },
            },
          },
          select: { id: true },
        })
      ).map((u) => u.id);
      const home = await homeSalonAt(app.prisma, t.tenant.id, person.employee.id, today);
      const assignmentSalons = await currentAndFutureAssignmentSalonIds(
        app.prisma,
        t.tenant.id,
        person.employee.id,
        today,
      );
      const kept = await resolveScopedHolderIds(
        app.prisma,
        t.tenant.id,
        eligible,
        READ,
        async (reach) =>
          (await timeEntryCoverage(
            app.prisma,
            t.tenant.id,
            reach,
            person.employee.id,
            home?.salonId ?? null,
            assignmentSalons,
          )) !== null,
      );
      expect(new Set(rows.map((r) => r.holderUserId))).toEqual(new Set(kept));
    }
  });

  it("Pin 2: a listed holder reaches the person's entries, an eligible unlisted holder reaches none", async () => {
    const ctxOf = (userId: string): AccessContext => ({
      tenantId: t.tenant.id,
      actor: { kind: "user", userId },
      reach: { kind: "wholeTenant" },
    });
    // p1's first entry was soft-deleted above: record a live one in salon C.
    await entry(p1.employee.id, salonC.id, `${year - 1}-04-10`);
    let workSalonChecked = 0;
    let unlistedChecked = 0;
    for (const person of [p1, p2]) {
      const rows = await listed(person.employee.id, person.user.id);
      const listedIds = new Set(rows.map((r) => r.holderUserId));
      const ownEntries = await app.prisma.timeEntry.findMany({
        where: { employeeId: person.employee.id, deletedAt: null },
        select: { id: true, salonId: true, employeeId: true, date: true },
      });
      expect(ownEntries.length).toBeGreaterThan(0);

      const holders = (await userIdsHoldingPermission(app.prisma, t.tenant.id, READ)).filter(
        (id) => id !== person.user.id,
      );
      const eligible = await app.prisma.user.findMany({
        where: {
          id: { in: holders },
          isActive: true,
          employee: { tenantId: t.tenant.id, NOT: { firstName: "Gelöscht" } },
        },
        select: { id: true },
      });
      for (const { id } of eligible) {
        const reach = await resolveAccessReach(app.prisma, ctxOf(id), READ);
        const visible = await scopedTimeEntryIds(
          app.prisma,
          t.tenant.id,
          reach,
          new Date("2000-01-01"),
          new Date("2100-01-01"),
        );
        const seesAny = visible === "all" || ownEntries.some((e) => visible.includes(e.id));
        if (listedIds.has(id)) {
          // A listed holder with an existing entry in reach: the single-row rule agrees.
          const inScope = await Promise.all(
            ownEntries.map((e) => isTimeEntryInScope(app.prisma, t.tenant.id, reach, e)),
          );
          const coverage = rows.find((r) => r.holderUserId === id)
            ?.coverage as TimeEntryReaderCoverage;
          // p1 and p2 have no deployment: a workSalon cover can only come from an existing entry.
          if (coverage === "workSalon") {
            expect(seesAny).toBe(true);
            expect(inScope.some(Boolean)).toBe(true);
            workSalonChecked++;
          }
        } else {
          unlistedChecked++;
          expect(seesAny, `unlisted holder ${id} reaches an entry of ${person.employee.id}`).toBe(
            false,
          );
        }
      }
    }
    // Anti-vacuity: both directions were actually exercised.
    expect(workSalonChecked).toBeGreaterThanOrEqual(2);
    expect(unlistedChecked).toBeGreaterThan(0);
  });

  it("Pin 2 (future entries): a probe entry in the person's Stammsalon and in a deployment salon is in scope for exactly the listed holders", async () => {
    const rows = await listed(p3.employee.id, p3.user.id);
    for (const [index, [salonId, label]] of (
      [
        [salonA.id, "sm-future-exit"],
        [salonD.id, "sm-d"],
      ] as const
    ).entries()) {
      const probe = await entry(p3.employee.id, salonId, `${year - 1}-05-0${index + 5}`);
      expect(
        rows.some((r) => r.holderUserId === holderIds[label]),
        label,
      ).toBe(true);
      const reach = await resolveAccessReach(
        app.prisma,
        {
          tenantId: t.tenant.id,
          actor: { kind: "user", userId: holderIds[label] },
          reach: { kind: "wholeTenant" },
        },
        READ,
      );
      expect(
        await isTimeEntryInScope(app.prisma, t.tenant.id, reach, {
          salonId,
          employeeId: p3.employee.id,
          date: probe.date,
        }),
      ).toBe(true);
    }
    // The unrelated salon's Salonmanager neither is listed nor reaches the probes.
    expect(rows.some((r) => r.holderUserId === holderIds["sm-x"])).toBe(false);
  });

  it("Pin 4: every system role that exports reports or reads the team overview also reads time entries", () => {
    const roles = Object.entries(SYSTEM_ROLE_PERMISSIONS);
    expect(roles.length).toBeGreaterThan(0);
    for (const [slot, permissions] of roles) {
      if (
        permissions.includes("report:export:ZUGEWIESEN") ||
        permissions.includes("team-overview:read:ZUGEWIESEN")
      ) {
        expect(permissions, slot).toContain(READ);
      }
    }
  });
});
