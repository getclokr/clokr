/**
 * Issue #604 (O-1, O-3, D-08) — GET /api/v1/appointment-hints/team answers only the persons inside
 * the caller's `time-entry:read` reach, judged per hint day by the Stammsalon of THAT day (the #86
 * person rule). Employees and the Personalabteilung template get 403 at the guard.
 *
 * Fixture: salons A, B and an empty salon C of one tenant; person A1 homed in A and person B1 homed
 * in B, each with a qualifying AFTER_CLOCK_OUT day yesterday; a foreign tenant with its own
 * qualifying person. MA = Salonmanager SALONS [A], MB = [B], MC = [C], HR = the shipped
 * Personalabteilung template (TENANT scope), ADMIN = the tenant admin, EMP = A1 with only the
 * Mitarbeiter role. No person names in fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  grantSystemRole,
} from "./setup";
import { TEST_TZ, pastDateStr, utcMidnight } from "./test-dates";
import { SYSTEM_ROLE_IDS } from "../contexts/platform";

const PASSWORD = "test1234";

interface TeamBody {
  enabled: boolean;
  hints: {
    employeeId: string;
    personName: string;
    date: string;
    kind: string;
    appointmentsUntil: string;
    clockedOutAt: string | null;
  }[];
}

function local(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);
}

describe("Issue #604 — GET /api/v1/appointment-hints/team", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let foreign: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: string;
  let salonB: string;
  let salonC: string;
  let a1: { id: string; user: { id: string; email: string } };
  let b1: { id: string; user: { id: string; email: string } };
  let foreignPerson: { id: string };
  let tokenMA: string;
  let tokenMB: string;
  let tokenMC: string;
  let tokenHR: string;
  let tokenEMP: string;
  const yesterday = pastDateStr(1);
  const fourDaysAgo = pastDateStr(4);

  async function createPerson(label: string, tenantId: string) {
    const s = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: label,
        lastName: "Reach604",
        hireDate: new Date("2024-01-01T00:00:00Z"),
      },
    });
    return { id: employee.id, user };
  }

  function home(employeeId: string, salonId: string, validFrom: string, validUntil?: string) {
    return app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: utcMidnight(validFrom),
        validUntil: validUntil ? utcMidnight(validUntil) : null,
      },
    });
  }

  async function qualifyingDay(
    employeeId: string,
    salonId: string,
    day: string,
    tenantSalon = salonId,
  ) {
    await app.prisma.phorestAppointment.create({
      data: {
        employeeId,
        date: utcMidnight(day),
        startTime: "10:00",
        endTime: "19:30",
        salonId: tenantSalon,
      },
    });
    await app.prisma.timeEntry.create({
      data: {
        employeeId,
        salonId: tenantSalon,
        date: utcMidnight(day),
        startTime: local(day, "09:00"),
        endTime: local(day, "18:00"),
        type: "WORK",
        source: "MANUAL",
      },
    });
  }

  async function login(email: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { accessToken: string }).accessToken;
  }

  async function assigned(
    label: string,
    role: keyof typeof SYSTEM_ROLE_IDS,
    scope: { type: "TENANT" } | { type: "SALONS"; salonIds: string[] },
  ): Promise<string> {
    const p = await createPerson(label, data.tenant.id);
    await app.prisma.roleAssignment.create({
      data: {
        tenantId: data.tenant.id,
        userId: p.user.id,
        accessRoleId: SYSTEM_ROLE_IDS[role],
        scopeType: scope.type,
        salonIds: scope.type === "SALONS" ? scope.salonIds : [],
        employeeIds: [],
      },
    });
    return login(p.user.email);
  }

  function team(token: string) {
    return app.inject({
      method: "GET",
      url: "/api/v1/appointment-hints/team",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function teamBody(token: string): Promise<TeamBody> {
    const res = await team(token);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as TeamBody;
  }

  async function setSwitch(on: boolean) {
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { appointmentTimeHintsEnabled: on, retroEntryWindowDays: 10 },
    });
  }

  const idsOf = (b: TeamBody) => b.hints.map((h) => `${h.employeeId}:${h.date}`).sort();

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "reach604");
    foreign = await seedTestData(app, "reach604f");
    salonA = data.salonId;
    salonB = (await createTestSalon(app.prisma, data.tenant.id, { name: "Reach604 B" })).id;
    salonC = (await createTestSalon(app.prisma, data.tenant.id, { name: "Reach604 C" })).id;
    await setSwitch(true);

    a1 = await createPerson("Aone", data.tenant.id);
    await grantSystemRole(app.prisma, {
      tenantId: data.tenant.id,
      userId: a1.user.id,
      role: "EMPLOYEE",
    });
    b1 = await createPerson("Bone", data.tenant.id);
    await home(a1.id, salonA, "2024-01-01");
    await home(b1.id, salonB, "2024-01-01");
    await qualifyingDay(a1.id, salonA, yesterday);
    await qualifyingDay(b1.id, salonB, yesterday);

    // The foreign tenant's person qualifies too, with the switch on there.
    await app.prisma.tenantConfig.update({
      where: { tenantId: foreign.tenant.id },
      data: { appointmentTimeHintsEnabled: true },
    });
    foreignPerson = await createPerson("Fone", foreign.tenant.id);
    await app.prisma.phorestAppointment.create({
      data: {
        employeeId: foreignPerson.id,
        date: utcMidnight(yesterday),
        startTime: "10:00",
        endTime: "19:30",
        salonId: foreign.salonId,
      },
    });

    tokenMA = await assigned("MgrA", "SALON_MANAGER", { type: "SALONS", salonIds: [salonA] });
    tokenMB = await assigned("MgrB", "SALON_MANAGER", { type: "SALONS", salonIds: [salonB] });
    tokenMC = await assigned("MgrC", "SALON_MANAGER", { type: "SALONS", salonIds: [salonC] });
    tokenHR = await assigned("Hr", "HR", { type: "TENANT" });
    tokenEMP = await login(a1.user.email);
  });

  afterAll(async () => {
    try {
      await app.prisma.roleAssignment.deleteMany({ where: { tenantId: data.tenant.id } });
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, foreign.tenant.id);
    } catch (err) {
      console.error("appointment-hints-reach-604 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("an employee is refused at the guard while the own endpoint still lists the hint", async () => {
    expect((await team(tokenEMP)).statusCode).toBe(403);
    const own = await app.inject({
      method: "GET",
      url: "/api/v1/appointment-hints",
      headers: { authorization: `Bearer ${tokenEMP}` },
    });
    expect(own.statusCode).toBe(200);
    expect((JSON.parse(own.body) as { hints: unknown[] }).hints).toHaveLength(1);
  });

  it("the HR template gets 403 with the guard's generic body and no person data", async () => {
    const res = await team(tokenHR);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(a1.id);
    expect(res.body).not.toContain("Reach604");
  });

  it("MA sees exactly A1's hint with the six keys and nothing of B1", async () => {
    const res = await team(tokenMA);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as TeamBody;
    expect(body.hints).toEqual([
      {
        employeeId: a1.id,
        personName: "Aone Reach604",
        date: yesterday,
        kind: "AFTER_CLOCK_OUT",
        appointmentsUntil: "19:30",
        clockedOutAt: "18:00",
      },
    ]);
    expect(Object.keys(body.hints[0]).sort()).toEqual(
      ["appointmentsUntil", "clockedOutAt", "date", "employeeId", "kind", "personName"].sort(),
    );
    expect(res.body).not.toContain(b1.id);
    expect(res.body).not.toContain("Bone");
  });

  it("MB sees exactly B1's hint; MC (an empty salon) gets the neutral empty answer", async () => {
    expect(idsOf(await teamBody(tokenMB))).toEqual([`${b1.id}:${yesterday}`]);
    const res = await team(tokenMC);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"enabled":true,"hints":[]}');
  });

  it("the admin sees A1 and B1, never the foreign tenant's person", async () => {
    const res = await team(data.adminToken);
    expect(res.statusCode).toBe(200);
    expect(idsOf(JSON.parse(res.body) as TeamBody)).toEqual(
      [`${a1.id}:${yesterday}`, `${b1.id}:${yesterday}`].sort(),
    );
    expect(res.body).not.toContain(foreignPerson.id);
  });

  it("judges the reach per hint day by that day's Stammsalon (Stichtag)", async () => {
    // A1's HOME in A ends at today - 3, a HOME in B starts at today - 2; A1 also qualifies at today - 4.
    await app.prisma.employeeSalonAssignment.deleteMany({ where: { employeeId: a1.id } });
    await home(a1.id, salonA, "2024-01-01", pastDateStr(3));
    await home(a1.id, salonB, pastDateStr(2));
    await qualifyingDay(a1.id, salonA, fourDaysAgo);

    expect(idsOf(await teamBody(tokenMA))).toEqual([`${a1.id}:${fourDaysAgo}`]);
    expect(idsOf(await teamBody(tokenMB))).toEqual(
      [`${a1.id}:${yesterday}`, `${b1.id}:${yesterday}`].sort(),
    );
  });

  it("after the person dismisses a hint it is gone for the managers too", async () => {
    // A1 is homed in B on yesterday (previous test); the own dismissal works on A1's own hint.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointment-hints/dismissals",
      headers: { authorization: `Bearer ${tokenEMP}` },
      payload: { date: yesterday, kind: "AFTER_CLOCK_OUT" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(idsOf(await teamBody(tokenMB))).toEqual([`${b1.id}:${yesterday}`]);
    expect(idsOf(await teamBody(data.adminToken))).toEqual(
      [`${a1.id}:${fourDaysAgo}`, `${b1.id}:${yesterday}`].sort(),
    );
  });

  it("answers { enabled: false, hints: [] } while the switch is off", async () => {
    await setSwitch(false);
    try {
      const res = await team(data.adminToken);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ enabled: false, hints: [] });
    } finally {
      await setSwitch(true);
    }
  });
});
