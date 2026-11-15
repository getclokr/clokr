/**
 * Issue #989 — the shipped Personalabteilung template holds only read rights on month close and
 * leave requests. The web used to offer the write actions anyway; this file proves the SERVER
 * refuses every one of them (so the UI gate is presentation, never the boundary), and that the
 * stored rows stay untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "./setup";
import { SYSTEM_ROLE_IDS } from "../contexts/platform";

const PASSWORD = "test1234";

describe("Issue #989 — Personalabteilung is refused every month-close and leave write", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let hrToken: string;
  let otherEmployeeId: string;
  let requestId: string;
  let approvedId: string;

  async function mkEmployee(label: string) {
    const s = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: s.toUpperCase().slice(0, 20),
        firstName: label,
        lastName: "Hr989Test",
        hireDate: new Date("2024-01-01"),
      },
    });
    return { user, employee };
  }

  function asHr(method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${hrToken}` },
      payload: payload ?? {},
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "hr989");
    const hr = await mkEmployee("hr989-hr");
    await app.prisma.roleAssignment.create({
      data: {
        tenantId: data.tenant.id,
        userId: hr.user.id,
        accessRoleId: SYSTEM_ROLE_IDS.HR,
        scopeType: "TENANT",
        salonIds: [],
        employeeIds: [],
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: hr.user.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    hrToken = (JSON.parse(login.body) as { accessToken: string }).accessToken;

    const other = await mkEmployee("hr989-other");
    otherEmployeeId = other.employee.id;
    const mk = (status: "PENDING" | "APPROVED", start: string) =>
      app.prisma.leaveRequest.create({
        data: {
          employeeId: otherEmployeeId,
          leaveTypeId: data.vacationType.id,
          startDate: new Date(start),
          endDate: new Date(start),
          days: 1,
          status,
        },
      });
    requestId = (await mk("PENDING", "2030-03-04")).id;
    approvedId = (await mk("APPROVED", "2030-03-05")).id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  const month = { year: 2030, month: 1 };

  it("refuses unlock-month", async () => {
    const res = await asHr("POST", "/overtime/unlock-month", {
      employeeId: otherEmployeeId,
      ...month,
      reason: "test",
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses close-month, with and without the gap confirmation", async () => {
    for (const confirmGaps of [undefined, true]) {
      const res = await asHr("POST", "/overtime/close-month", {
        employeeId: otherEmployeeId,
        ...month,
        ...(confirmGaps === undefined ? {} : { confirmGaps }),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("refuses close-year", async () => {
    const res = await asHr("POST", "/overtime/close-year", { year: 2030 });
    expect(res.statusCode).toBe(403);
  });

  it("refuses leave correct, attest and cancel, leaving the rows untouched", async () => {
    const correct = await asHr("PATCH", `/leave/requests/${approvedId}/correct`, {
      startDate: "2030-03-06",
      endDate: "2030-03-06",
      reason: "Korrektur durch Test",
    });
    expect(correct.statusCode).toBe(403);
    const attest = await asHr("PATCH", `/leave/requests/${approvedId}/attest`, {
      attestPresent: true,
    });
    expect(attest.statusCode).toBe(403);
    const cancel = await asHr("DELETE", `/leave/requests/${approvedId}`, {
      reason: "Storno durch Test",
    });
    expect(cancel.statusCode).toBe(403);
    const review = await asHr("PATCH", `/leave/requests/${requestId}/review`, {
      status: "APPROVED",
    });
    expect(review.statusCode).toBe(403);

    const rows = await app.prisma.leaveRequest.findMany({
      where: { id: { in: [requestId, approvedId] } },
      orderBy: { id: "asc" },
    });
    expect(rows.map((r) => r.status).sort()).toEqual(["APPROVED", "PENDING"]);
    expect(rows.every((r) => r.attestPresent === false)).toBe(true);
  });

  it("refuses creating a leave request for another person and for the caller itself", async () => {
    const forOther = await asHr("POST", "/leave/requests", {
      employeeId: otherEmployeeId,
      type: "VACATION",
      startDate: "2030-04-01",
      endDate: "2030-04-01",
    });
    expect(forOther.statusCode).toBe(403);
    const own = await asHr("POST", "/leave/requests", {
      type: "VACATION",
      startDate: "2030-04-02",
      endDate: "2030-04-02",
    });
    expect(own.statusCode).toBe(403);
    const count = await app.prisma.leaveRequest.count({
      where: { employee: { tenantId: data.tenant.id } },
    });
    expect(count).toBe(2);
  });
});
