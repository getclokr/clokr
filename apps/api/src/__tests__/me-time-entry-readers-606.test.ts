/**
 * Issue #606 — `GET /api/v1/me/time-entry-readers`: the roles that can read the caller's own time
 * entries, derived live from the stored role assignments. Categories only: role name, coverage and
 * purposes, never a person, an id or a head count.
 *
 * No person names in fixtures (CLAUDE.md PII rule): every identity is synthetic.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import type { TimeEntryReadersResponse } from "@clokr/types";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  createAdminApiKey,
  removeFixtureApiKeys,
  grantSystemRole,
  tokenWithoutSignIn,
  numericEmployeeNumber,
} from "./setup";
import { SYSTEM_ROLE_IDS } from "../contexts/platform";
import type { JwtPayload } from "../middleware/auth";

const PASSWORD = "test1234";

describe("Issue #606 — GET /api/v1/me/time-entry-readers", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: { id: string };
  let salonB: { id: string };
  let salonC: { id: string };
  const cleanupAssignmentIds: string[] = [];
  const holderEmails: string[] = [];

  function suffix(label: string): string {
    return `${label}-${crypto.randomBytes(3).toString("hex")}`;
  }

  /** A synthetic colleague (user + employee) who may later receive a stored role assignment. */
  async function createColleague(label: string) {
    const s = suffix(label);
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await app.prisma.user.create({
      data: { email: `${s}@test.de`, passwordHash, isActive: true },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: numericEmployeeNumber(),
        firstName: `Vorname${s}`,
        lastName: `Nachname${s}`,
        hireDate: new Date("2024-01-01"),
      },
    });
    holderEmails.push(user.email);
    return { user, employee };
  }

  async function assign(
    userId: string,
    accessRoleId: string,
    scope:
      | { type: "TENANT" }
      | { type: "SALONS"; salonIds: string[] }
      | { type: "PERSONS"; employeeIds: string[] },
  ) {
    const row = await app.prisma.roleAssignment.create({
      data: {
        tenantId: data.tenant.id,
        userId,
        accessRoleId,
        scopeType: scope.type,
        salonIds: scope.type === "SALONS" ? scope.salonIds : [],
        employeeIds: scope.type === "PERSONS" ? scope.employeeIds : [],
      },
    });
    cleanupAssignmentIds.push(row.id);
    return row;
  }

  function home(employeeId: string, salonId: string) {
    return app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: new Date("2020-01-01"),
        validUntil: null,
        weekdays: [],
      },
    });
  }

  async function readers(token: string) {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/time-entry-readers",
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      res,
      body: res.statusCode === 200 ? (JSON.parse(res.body) as TimeEntryReadersResponse) : null,
    };
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "rd606");
    salonA = { id: data.salonId };
    salonB = await createTestSalon(app.prisma, data.tenant.id, { name: "Rd606 Salon B" });
    salonC = await createTestSalon(app.prisma, data.tenant.id, { name: "Rd606 Salon C" });
    await home(data.employee.id, salonA.id);
  });

  afterEach(async () => {
    await app.prisma.roleAssignment.deleteMany({ where: { id: { in: cleanupAssignmentIds } } });
    cleanupAssignmentIds.length = 0;
    await removeFixtureApiKeys(app.prisma, data.tenant.id);
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("lists the tenant admin as a whole-company group with all three purposes", async () => {
    const { res, body } = await readers(data.empToken);
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      groups: [
        {
          roleName: "Admin",
          coverage: "wholeTenant",
          purposes: ["hours", "payroll", "protection"],
        },
      ],
      connectedPrograms: false,
    });
  });

  it("lists a Salonmanager assigned to the person's Stammsalon as homeSalon, and not for an unrelated salon", async () => {
    const mgr = await createColleague("sm-home");
    await assign(mgr.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      type: "SALONS",
      salonIds: [salonA.id],
    });
    const listed = await readers(data.empToken);
    expect(listed.body?.groups).toContainEqual({
      roleName: "Salonmanager",
      coverage: "homeSalon",
      purposes: ["hours", "protection"],
    });

    const other = await createColleague("sm-other");
    await assign(other.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      type: "SALONS",
      salonIds: [salonB.id],
    });
    // Two Salonmanagers, but only the one reaching the Stammsalon is a row (and rows are deduplicated).
    const after = await readers(data.empToken);
    expect(after.body?.groups.filter((g) => g.roleName === "Salonmanager")).toHaveLength(1);
  });

  it("follows a PATCH of the assignment at once: moved away it disappears, moved back it returns", async () => {
    const mgr = await createColleague("sm-move");
    const row = await assign(mgr.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      type: "SALONS",
      salonIds: [salonA.id],
    });
    const hasSalonManager = async () =>
      (await readers(data.empToken)).body?.groups.some((g) => g.roleName === "Salonmanager") ??
      false;
    expect(await hasSalonManager()).toBe(true);

    const patch = (salonId: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/role-assignments/${row.id}`,
        headers: { authorization: `Bearer ${data.adminToken}` },
        payload: { scope: { type: "SALONS", salonIds: [salonId] } },
      });
    expect((await patch(salonC.id)).statusCode).toBe(200);
    expect(await hasSalonManager()).toBe(false);
    expect((await patch(salonA.id)).statusCode).toBe(200);
    expect(await hasSalonManager()).toBe(true);
  });

  it("lists an Ausbilder assigned to the person as coverage person, and not one assigned to someone else", async () => {
    const trainer = await createColleague("trainer-person");
    await assign(trainer.user.id, SYSTEM_ROLE_IDS.TRAINER, {
      type: "PERSONS",
      employeeIds: [data.employee.id],
    });
    const other = await createColleague("trainer-other");
    const stranger = await createColleague("trainer-stranger");
    await assign(other.user.id, SYSTEM_ROLE_IDS.TRAINER, {
      type: "PERSONS",
      employeeIds: [stranger.employee.id],
    });
    const { body } = await readers(data.empToken);
    const trainerRows = body?.groups.filter((g) => g.roleName === "Ausbilder") ?? [];
    expect(trainerRows).toEqual([
      { roleName: "Ausbilder", coverage: "person", purposes: ["protection"] },
    ]);
  });

  it("never lists the person's own user, even when that user holds a whole-company role", async () => {
    await grantSystemRole(app.prisma, {
      tenantId: data.tenant.id,
      userId: data.empUser.id,
      role: "MANAGER",
    });
    try {
      const { body } = await readers(data.empToken);
      expect(body?.groups.map((g) => g.roleName)).toEqual(["Admin"]);
    } finally {
      await app.prisma.roleAssignment.deleteMany({
        where: { userId: data.empUser.id, accessRoleId: SYSTEM_ROLE_IDS.MANAGER },
      });
    }
  });

  it("answers no email, name, id or head count of any holder", async () => {
    const mgr = await createColleague("sm-privacy");
    await assign(mgr.user.id, SYSTEM_ROLE_IDS.SALON_MANAGER, {
      type: "SALONS",
      salonIds: [salonA.id],
    });
    const { res } = await readers(data.empToken);
    const raw = res.body;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["connectedPrograms", "groups"]);
    for (const identifying of [
      mgr.user.email,
      mgr.user.id,
      mgr.employee.id,
      mgr.employee.firstName,
      mgr.employee.lastName,
      data.adminUser.email,
      data.adminUser.id,
      data.adminEmployee.id,
      data.adminEmployee.lastName,
    ]) {
      expect(raw).not.toContain(identifying);
    }
    for (const group of JSON.parse(raw).groups as Record<string, unknown>[]) {
      expect(Object.keys(group).sort()).toEqual(["coverage", "purposes", "roleName"]);
    }
  });

  it("refuses an API key with 400, a token without an employee with 400 and a user without time-entry:read with 403", async () => {
    const key = await createAdminApiKey(app.prisma, {
      tenantId: data.tenant.id,
      createdBy: data.adminUser.id,
    });
    expect((await readers(key.token)).res.statusCode).toBe(400);

    const noEmployeeToken = app.jwt.sign({
      sub: data.adminUser.id,
      tenantId: data.tenant.id,
    } as JwtPayload);
    const noEmployee = await readers(noEmployeeToken);
    expect(noEmployee.res.statusCode).toBe(400);
    expect(JSON.parse(noEmployee.res.body)).toEqual({ error: "Kein Mitarbeiterprofil vorhanden" });

    const hr = await createColleague("hr-only");
    await assign(hr.user.id, SYSTEM_ROLE_IDS.HR, { type: "TENANT" });
    const hrToken = await tokenWithoutSignIn(app, hr.user.email);
    expect((await readers(hrToken)).res.statusCode).toBe(403);
  });
});
