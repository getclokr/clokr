/**
 * Issue #1095 - a leave request booked from a Betriebsurlaub says so in the lists and the calendar,
 * and the paid release days of a Betriebsurlaub (the imposed COMPANY_SHUTDOWN absence) are drawn
 * exactly once.
 *
 * Fixture: one tenant (seedTestData; admin with whole-tenant reach, one EMPLOYEE), a Betriebsurlaub
 * Mon 3 - Fri 7 March 2031 (a fixed far-future month, so no clock dependence). Both persons carry a
 * COMPANY_SHUTDOWN absence over the five days; the employee also has an approved Urlaub request
 * linked to the shutdown for Mon-Tue, plus an ordinary Urlaub request on 10-11 March. A second
 * tenant carries its own shutdown absence on the same days. No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, createTestSalon } from "./setup";

type Entry = Record<string, unknown> & { isHoliday?: boolean };

const MASKED_KEYS = [
  "employeeId",
  "endDate",
  "firstName",
  "isOwn",
  "lastName",
  "masked",
  "startDate",
];

describe("Issue #1095 - Betriebsurlaub label and release days", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let other: Awaited<ReturnType<typeof seedTestData>>;
  let shutdownId: string;
  let linkedRequestId: string;
  let plainRequestId: string;
  const SHUTDOWN_NAME = "Betriebsurlaub 1095";

  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  function get(url: string, token: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function calendar(token: string, qs = ""): Promise<Entry[]> {
    const res = await get(`/leave/calendar?year=2031&month=3${qs}`, token);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Entry[];
  }

  const release = (entries: Entry[]) => entries.filter((e) => e.typeCode === "COMPANY_SHUTDOWN");

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cl1095");
    other = await seedTestData(app, "cl1095b");

    const shutdown = await app.prisma.companyShutdown.create({
      data: {
        tenantId: data.tenant.id,
        name: SHUTDOWN_NAME,
        startDate: day("2031-03-03"),
        endDate: day("2031-03-07"),
      },
    });
    shutdownId = shutdown.id;

    for (const employeeId of [data.employee.id, data.adminEmployee.id]) {
      await app.prisma.absence.create({
        data: {
          employeeId,
          type: "COMPANY_SHUTDOWN",
          startDate: day("2031-03-03"),
          endDate: day("2031-03-07"),
          days: 5,
          companyShutdownId: shutdownId,
          createdBy: data.adminUser.id,
        },
      });
    }

    const linked = await app.prisma.leaveRequest.create({
      data: {
        employeeId: data.employee.id,
        leaveTypeId: data.vacationType.id,
        startDate: day("2031-03-03"),
        endDate: day("2031-03-04"),
        days: 2,
        status: "APPROVED",
        companyShutdownId: shutdownId,
      },
    });
    linkedRequestId = linked.id;
    const plain = await app.prisma.leaveRequest.create({
      data: {
        employeeId: data.employee.id,
        leaveTypeId: data.vacationType.id,
        startDate: day("2031-03-10"),
        endDate: day("2031-03-11"),
        days: 2,
        status: "APPROVED",
      },
    });
    plainRequestId = plain.id;

    // Another tenant's shutdown absence on the same days must never reach this tenant's calendar.
    await app.prisma.absence.create({
      data: {
        employeeId: other.employee.id,
        type: "COMPANY_SHUTDOWN",
        startDate: day("2031-03-03"),
        endDate: day("2031-03-07"),
        days: 5,
        createdBy: other.adminUser.id,
      },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, other.tenant.id);
    } catch (err) {
      console.error("company-shutdown-label-1095 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("GET /leave/requests delivers companyShutdownId and the shutdown's name on a linked request only", async () => {
    const res = await get("/leave/requests", data.empToken);
    expect(res.statusCode, res.body).toBe(200);
    const rows = JSON.parse(res.body) as Array<Record<string, unknown>>;

    const linked = rows.find((r) => r.id === linkedRequestId)!;
    expect(linked.companyShutdownId).toBe(shutdownId);
    expect(linked.companyShutdown).toEqual({ id: shutdownId, name: SHUTDOWN_NAME });

    const plain = rows.find((r) => r.id === plainRequestId)!;
    expect(plain.companyShutdownId).toBeNull();
    expect(plain.companyShutdown).toBeNull();
  });

  it("GET /leave/calendar names the shutdown on the linked request and on nothing else", async () => {
    const entries = await calendar(data.adminToken);
    const linked = entries.find((e) => e.id === linkedRequestId)!;
    expect(linked.typeCode).toBe("VACATION");
    expect(linked.companyShutdownId).toBe(shutdownId);
    expect(linked.companyShutdown).toEqual({ id: shutdownId, name: SHUTDOWN_NAME });

    const plain = entries.find((e) => e.id === plainRequestId)!;
    expect(plain.companyShutdownId).toBeNull();
    expect(plain.companyShutdown).toBeNull();
  });

  it("draws a release day only where no request of the person already covers it (no vacation day twice)", async () => {
    const entries = await calendar(data.adminToken);
    const mine = release(entries.filter((e) => e.employeeId === data.employee.id));
    // The employee's Mon-Tue are the linked Urlaub request; only Wed-Fri are release days.
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      typeCode: "COMPANY_SHUTDOWN",
      typeName: "Betriebsurlaub",
      startDate: "2031-03-05",
      endDate: "2031-03-07",
      status: "APPROVED",
      halfDay: false,
      companyShutdownId: shutdownId,
      companyShutdown: { id: shutdownId, name: SHUTDOWN_NAME },
    });

    // A person without a request is shown the whole shutdown once.
    const admin = release(entries.filter((e) => e.employeeId === data.adminEmployee.id));
    expect(admin).toHaveLength(1);
    expect(admin[0]).toMatchObject({ startDate: "2031-03-03", endDate: "2031-03-07" });

    // No day of the employee is drawn by two rows.
    const days = new Map<string, number>();
    for (const e of entries.filter((x) => x.employeeId === data.employee.id)) {
      for (
        let t = day(String(e.startDate)).getTime();
        t <= day(String(e.endDate)).getTime();
        t += 86_400_000
      ) {
        const key = new Date(t).toISOString().slice(0, 10);
        days.set(key, (days.get(key) ?? 0) + 1);
      }
    }
    expect([...days.values()].every((n) => n === 1)).toBe(true);
  });

  it("a soft-deleted shutdown absence and another tenant's absence are not drawn", async () => {
    const before = release(await calendar(data.adminToken));
    expect(before.some((e) => e.employeeId === other.employee.id)).toBe(false);

    await app.prisma.absence.updateMany({
      where: { employeeId: data.adminEmployee.id, companyShutdownId: shutdownId },
      data: { deletedAt: new Date() },
    });
    try {
      const after = release(await calendar(data.adminToken));
      expect(after.some((e) => e.employeeId === data.adminEmployee.id)).toBe(false);
      expect(after.some((e) => e.employeeId === data.employee.id)).toBe(true);
    } finally {
      await app.prisma.absence.updateMany({
        where: { employeeId: data.adminEmployee.id, companyShutdownId: shutdownId },
        data: { deletedAt: null },
      });
    }
  });

  it("a colleague outside the reader's reach gets a masked range with no shutdown field", async () => {
    // Put both persons in the tenant's salon so the employee's team scope names the admin.
    const salon = await createTestSalon(app.prisma, data.tenant.id, { name: "Salon 1095" });
    for (const employeeId of [data.employee.id, data.adminEmployee.id]) {
      await app.prisma.employeeSalonAssignment.create({
        data: {
          tenantId: data.tenant.id,
          employeeId,
          salonId: salon.id,
          kind: "HOME",
          validFrom: day("2024-01-01"),
          validUntil: null,
          weekdays: [],
        },
      });
    }
    const entries = await calendar(data.empToken, "&scope=team");
    const foreign = entries.filter((e) => e.employeeId === data.adminEmployee.id);
    expect(foreign.length).toBeGreaterThan(0);
    for (const row of foreign) {
      expect(Object.keys(row).sort()).toEqual(MASKED_KEYS);
    }
    // The employee's own rows stay detailed and carry the field.
    expect(entries.find((e) => e.id === linkedRequestId)?.companyShutdownId).toBe(shutdownId);
  });
});
