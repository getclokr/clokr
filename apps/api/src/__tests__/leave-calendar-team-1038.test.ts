/**
 * Issue #1038 (owner decision 19.11.2026) — Ich › Abwesenheiten › Team.
 *
 * OD-3: the `scope=team` range answer of `GET /leave/calendar` also lists `persons` — every person
 * homed in one of the caller's Stammsalons on a window day who is employed in the window and never
 * anonymised (`homeSalonPersonsDuring`, the #613 rule) — so a colleague without any absence still
 * has a row.
 * OD-1: a colleague's PENDING request arrives as a masked range flagged `requested: true` (name and
 * period only; no type, status, half day, § 9 or request id).
 * OD-2: every other answer (`scope=own`, no scope, month form) keeps exactly its shape.
 *
 * Fixture (fake clock 2026-06-15T10:00Z, installed BEFORE the app boots; window 2026-06-01..30):
 * tenant with the default salon plus salons A and B.
 *   eA          caller, EMPLOYEE homed in A; own APPROVED (2nd-3rd) and PENDING (20th) rows
 *   cNone       homed in A, no leave at all
 *   cExitDuring homed in A, exit date on the 10th (inside the window)
 *   cExitBefore homed in A, exit date before the window
 *   cHireLater  homed in A, hired after the window
 *   cAnon       homed in A, anonymisation sentinel
 *   cPend       homed in A, PENDING 10th-11th and 12th
 *   cMix        homed in A, APPROVED 1st-3rd and a PENDING half day on the 4th
 *   pB          homed in B
 *   eFree       employee without any HOME assignment, own APPROVED row
 *   admin       whole-tenant admin, not homed anywhere
 * No person names.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  createTestSalon,
  grantSystemRole,
} from "./setup";

const PASSWORD = "test1234";
const MASKED_KEYS = [
  "employeeId",
  "endDate",
  "firstName",
  "isOwn",
  "lastName",
  "masked",
  "startDate",
];
const REQUESTED_KEYS = [...MASKED_KEYS, "requested"].sort();

type Entry = Record<string, unknown> & { isHoliday?: boolean };
type PersonRow = { employeeId: string; firstName: string; lastName: string; isOwn: boolean };
type RangeBody = {
  entries: Entry[];
  salons: unknown[];
  persons?: PersonRow[];
};

describe("Issue #1038 — Team tab: persons list and requested bars", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let salonA: { id: string };
  let salonB: { id: string };
  const emp: Record<string, string> = {};
  const req: Record<string, string> = {};
  const token: Record<string, string> = {};

  function uniqueSuffix(label: string): string {
    return `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async function createEmployee(
    label: string,
    extra: {
      hireDate?: Date;
      exitDate?: Date;
      firstName?: string;
      lastName?: string;
    } = {},
  ) {
    const s = uniqueSuffix(label);
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: extra.firstName ?? label,
        lastName: extra.lastName ?? "Team1038",
        hireDate: extra.hireDate ?? new Date("2024-01-01"),
        exitDate: extra.exitDate ?? null,
      },
    });
    await grantSystemRole(app.prisma, {
      tenantId: data.tenant.id,
      userId: user.id,
      role: "EMPLOYEE",
    });
    emp[label] = employee.id;
    token[label] = await login(user.email);
    return employee;
  }

  function home(employeeId: string, salonId: string, from: string, until: string | null) {
    return app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: data.tenant.id,
        employeeId,
        salonId,
        kind: "HOME",
        validFrom: new Date(`${from}T00:00:00Z`),
        validUntil: until === null ? null : new Date(`${until}T00:00:00Z`),
        weekdays: [],
      },
    });
  }

  function leave(
    key: string,
    employeeKey: string,
    start: string,
    end: string,
    status: string,
    halfDay = false,
  ) {
    return app.prisma.leaveRequest
      .create({
        data: {
          employeeId: emp[employeeKey],
          leaveTypeId: data.vacationType.id,
          startDate: new Date(`${start}T00:00:00Z`),
          endDate: new Date(`${end}T00:00:00Z`),
          days: halfDay ? 0.5 : 1,
          halfDay,
          status: status as "APPROVED" | "PENDING",
        },
      })
      .then((row) => {
        req[key] = row.id;
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

  function get(tok: string, qs: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/leave/calendar?${qs}`,
      headers: { authorization: `Bearer ${tok}` },
    });
  }

  async function range(tok: string, qs: string): Promise<RangeBody> {
    const res = await get(tok, qs);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as RangeBody;
  }

  const leaveRows = (body: RangeBody) => body.entries.filter((e) => e.isHoliday !== true);
  const rowsOf = (body: RangeBody, key: string) =>
    leaveRows(body).filter((e) => e.employeeId === emp[key]);
  const RANGE = "from=2026-06-01&to=2026-06-30";

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
    app = await getTestApp();
    data = await seedTestData(app, "team1038");
    salonA = await createTestSalon(app.prisma, data.tenant.id, { name: "Salon Nord" });
    salonB = await createTestSalon(app.prisma, data.tenant.id, { name: "Salon Ost" });

    await createEmployee("eA");
    await createEmployee("cNone");
    await createEmployee("cExitDuring", { exitDate: new Date("2026-06-10") });
    await createEmployee("cExitBefore", { exitDate: new Date("2026-05-15") });
    await createEmployee("cHireLater", { hireDate: new Date("2026-07-15") });
    await createEmployee("cAnon", { firstName: "Gelöscht", lastName: "GELÖSCHT-1038" });
    await createEmployee("cPend");
    await createEmployee("cMix");
    await createEmployee("pB");
    await createEmployee("eFree");
    for (const key of ["eA", "cNone", "cExitDuring", "cExitBefore", "cAnon", "cPend", "cMix"]) {
      await home(emp[key], salonA.id, "2024-01-01", null);
    }
    await home(emp.cHireLater, salonA.id, "2026-07-15", null);
    await home(emp.pB, salonB.id, "2024-01-01", null);

    await leave("eA", "eA", "2026-06-02", "2026-06-03", "APPROVED");
    await leave("eAPending", "eA", "2026-06-20", "2026-06-20", "PENDING");
    await leave("eFree", "eFree", "2026-06-22", "2026-06-23", "APPROVED");
    await leave("cPend1", "cPend", "2026-06-10", "2026-06-11", "PENDING");
    await leave("cPend2", "cPend", "2026-06-12", "2026-06-12", "PENDING");
    await leave("cMixApproved", "cMix", "2026-06-01", "2026-06-03", "APPROVED");
    await leave("cMixPending", "cMix", "2026-06-04", "2026-06-04", "PENDING", true);
  });

  afterAll(async () => {
    vi.useRealTimers();
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("leave-calendar-team-1038 cleanup failed:", err);
    }
    await closeTestApp();
  });

  describe("persons (OD-3)", () => {
    it("lists every employed colleague of the caller's Stammsalon, also without any absence", async () => {
      const body = await range(token.eA, `${RANGE}&scope=team`);
      expect(body.persons).toBeDefined();
      const persons = body.persons as PersonRow[];
      // Same last name, so code-unit order of the first names decides.
      expect(persons.map((p) => p.employeeId)).toEqual([
        emp.cExitDuring,
        emp.cMix,
        emp.cNone,
        emp.cPend,
        emp.eA,
      ]);
      // cNone has no leave row at all and is still listed.
      expect(rowsOf(body, "cNone")).toEqual([]);
      for (const person of persons) {
        expect(Object.keys(person).sort()).toEqual([
          "employeeId",
          "firstName",
          "isOwn",
          "lastName",
        ]);
        expect(person.isOwn).toBe(person.employeeId === emp.eA);
      }
    });

    it("orders by last name, first name, id in code-unit order", async () => {
      const body = await range(token.eA, `${RANGE}&scope=team`);
      const keys = (body.persons as PersonRow[]).map(
        (p) => `${p.lastName}|${p.firstName}|${p.employeeId}`,
      );
      expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(keys.length).toBe(5);
    });

    it("never lists a person who left before the window, was hired after it, is anonymised or homed elsewhere", async () => {
      const body = await range(token.eA, `${RANGE}&scope=team`);
      const ids = (body.persons as PersonRow[]).map((p) => p.employeeId);
      for (const key of ["cExitBefore", "cHireLater", "cAnon", "pB", "eFree"]) {
        expect(ids).not.toContain(emp[key]);
      }
      expect(ids).toContain(emp.cExitDuring);
    });

    it("carries no hire date, exit date or user id", async () => {
      const body = await range(token.eA, `${RANGE}&scope=team`);
      const json = JSON.stringify(body.persons);
      expect(json).not.toContain("hireDate");
      expect(json).not.toContain("exitDate");
      expect(json).not.toContain("userId");
    });

    it("a caller without any Stammsalon gets an empty list and still its own row", async () => {
      const body = await range(token.eFree, `${RANGE}&scope=team`);
      expect(body.persons).toEqual([]);
      expect(rowsOf(body, "eFree").length).toBe(1);
    });

    it("scope=own and a whole-tenant no-scope answer have exactly the keys entries and salons", async () => {
      const own = await range(token.eA, `${RANGE}&scope=own`);
      expect(Object.keys(own).sort()).toEqual(["entries", "salons"]);
      const admin = await range(data.adminToken, RANGE);
      expect(Object.keys(admin).sort()).toEqual(["entries", "salons"]);
    });

    it("the month form with scope=team is still a bare array", async () => {
      const res = await get(token.eA, "year=2026&month=6&scope=team");
      expect(res.statusCode, res.body).toBe(200);
      expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
  });
});
