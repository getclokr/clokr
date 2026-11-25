/**
 * Issue #1069 (O-6, D-18) - a person created LATER (POST /employees, CSV import) who is employed on
 * the days of an active Betriebsurlaub gets it booked right after the creation commit. The hook is
 * reactive (ADR 0002 Entscheidung 10): the creation answer never changes and a failing booking is
 * logged with ids only.
 *
 * Fixture: one tenant, the admin (whole-tenant reach) as the creating actor. The Betriebsurlaub is
 * written directly (Monday to Friday of the second December week, an open month ahead, no
 * holiday at the fixture salon - asserted), so no existing person is booked. Persons are created
 * through the real routes with FIXED_SCHEDULE Mo-Fr contracts. No person names in assertions.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, soleAuditRow } from "./setup";
import { getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import * as booking from "../contexts/absence/company-shutdown/booking";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

describe("Issue #1069 - a Betriebsurlaub follows a person created later", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let day1: string; // Monday
  let day2: string; // Tuesday
  let lastDay: string; // Friday
  let year: number;
  let shutdownId: string;

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function uid(): string {
    return crypto.randomBytes(4).toString("hex");
  }

  async function postEmployee(hireDate: string) {
    const id = uid();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: authed(data.adminToken),
      payload: {
        email: `hire1069-${id}@example.invalid`,
        firstName: "Hire",
        lastName: "Shutdown1069",
        employeeNumber: `H1069-${id}`,
        hireDate: `${hireDate}T00:00:00.000Z`,
        role: "EMPLOYEE",
        scheduleType: "FIXED_SCHEDULE",
        weeklyHours: 40,
        workDays: [1, 2, 3, 4, 5],
        password: `Test-${id}-pw1234!`,
      },
    });
    return res;
  }

  async function requestsOf(employeeId: string) {
    return app.prisma.leaveRequest.findMany({
      where: { employeeId, companyShutdownId: shutdownId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
  async function absencesOf(employeeId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "hire1069");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);

    // Monday to Friday of a December week at least 8 days ahead, no holiday there.
    const today = todayInTz(tz);
    let decYear = today.getUTCFullYear();
    if (plusDays(today, 8).getTime() > Date.UTC(decYear, 11, 20)) decYear += 1;
    let monday = new Date(Date.UTC(decYear, 11, 1));
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    for (;;) {
      const friday = plusDays(monday, 4);
      const holidays = await getHolidayMap(app.prisma, data.tenant.id, null, monday, friday);
      if (
        monday.getTime() >= plusDays(today, 8).getTime() &&
        friday.getUTCMonth() === 11 &&
        holidays.size === 0
      ) {
        day1 = iso(monday);
        day2 = iso(plusDays(monday, 1));
        lastDay = iso(friday);
        break;
      }
      monday = plusDays(monday, 7);
    }
    year = Number(day1.slice(0, 4));

    // Written directly: no existing person gets a booking from this fixture.
    const shutdown = await app.prisma.companyShutdown.create({
      data: {
        tenantId: data.tenant.id,
        name: "Betriebsurlaub 1069 Hire",
        startDate: new Date(day1),
        endDate: new Date(lastDay),
        deductsFromVacation: true,
      },
    });
    shutdownId = shutdown.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("company-shutdown-hire-1069 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("POST /employees: the answer is unchanged and the new person gets the absence and an APPROVED Urlaub request, audited with the marker and the admin as actor", async () => {
    const res = await postEmployee(`${year}-01-01`);
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json() as { id: string; employeeNumber: string; booking?: unknown };
    // The booking is a consequence of the creation, never part of its answer.
    expect(created).not.toHaveProperty("booking");
    expect(created.employeeNumber).toMatch(/^H1069-/);

    const requests = await requestsOf(created.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      status: "APPROVED",
      reviewedBy: data.adminUser.id,
      halfDay: false,
      deletedAt: null,
    });
    expect(Number(requests[0].days)).toBe(5);
    expect(iso(requests[0].startDate)).toBe(day1);
    expect(iso(requests[0].endDate)).toBe(lastDay);

    const absences = await absencesOf(created.id);
    expect(absences).toHaveLength(1);
    expect(absences[0]).toMatchObject({
      type: "COMPANY_SHUTDOWN",
      deletedAt: null,
      createdBy: data.adminUser.id,
    });
    expect(iso(absences[0].startDate)).toBe(day1);
    expect(iso(absences[0].endDate)).toBe(lastDay);

    const create = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: requests[0].id, action: "CREATE" },
    });
    expect(create.userId).toBe(data.adminUser.id);
    expect(create.newValue).toMatchObject({
      trigger: "COMPANY_SHUTDOWN",
      companyShutdownId: shutdownId,
      targetEmployeeId: created.id,
    });

    // Nobody else was booked by the hire.
    expect(await requestsOf(data.employee.id)).toHaveLength(0);
    expect(await absencesOf(data.employee.id)).toHaveLength(0);
    expect(await absencesOf(data.adminEmployee.id)).toHaveLength(0);
  });

  it("the Teilurlaub of the hire year bounds the days charged, the rest is paid release (D-04 reused)", async () => {
    // Hired on 1 December: one full month of employment in the shutdown's year.
    const res = await postEmployee(`${year}-12-01`);
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { id: string }).id;

    const entitlement = await app.prisma.leaveEntitlement.findFirstOrThrow({
      where: { employeeId: id, year, leaveType: { code: "VACATION" } },
    });
    const available = Number(entitlement.totalDays) + Number(entitlement.carriedOverDays);
    // The precondition that makes this a bound: less Teilurlaub than the five shutdown workdays.
    expect(available).toBeLessThan(5);

    const requests = await requestsOf(id);
    const charged = requests.reduce((sum, r) => sum + Number(r.days), 0);
    expect(charged).toBe(Math.floor(available));
    expect(Number(entitlement.usedDays)).toBe(charged);
    // The absence covers every shutdown day whatever was charged: the paid release.
    const absences = await absencesOf(id);
    expect(absences).toHaveLength(1);
    expect(iso(absences[0].startDate)).toBe(day1);
    expect(iso(absences[0].endDate)).toBe(lastDay);
  });

  it("hired inside the shutdown: only the days from the hire day; hired after it: nothing", async () => {
    const inside = await postEmployee(day2);
    expect(inside.statusCode, inside.body).toBe(201);
    const insideId = (inside.json() as { id: string }).id;
    const insideAbsences = await absencesOf(insideId);
    expect(insideAbsences).toHaveLength(1);
    expect(iso(insideAbsences[0].startDate)).toBe(day2);
    expect(iso(insideAbsences[0].endDate)).toBe(lastDay);
    for (const request of await requestsOf(insideId)) {
      expect(iso(request.startDate) >= day2).toBe(true);
    }

    const after = await postEmployee(iso(plusDays(new Date(lastDay), 7)));
    expect(after.statusCode, after.body).toBe(201);
    const afterId = (after.json() as { id: string }).id;
    expect(await absencesOf(afterId)).toHaveLength(0);
    expect(await requestsOf(afterId)).toHaveLength(0);
  });

  it("a non-deducting Betriebsurlaub books the absence only; a soft-deleted one books nothing", async () => {
    await app.prisma.companyShutdown.update({
      where: { id: shutdownId },
      data: { deductsFromVacation: false },
    });
    const noDeduction = await postEmployee(`${year}-01-01`);
    expect(noDeduction.statusCode, noDeduction.body).toBe(201);
    const noDeductionId = (noDeduction.json() as { id: string }).id;
    expect(await absencesOf(noDeductionId)).toHaveLength(1);
    expect(await requestsOf(noDeductionId)).toHaveLength(0);

    await app.prisma.companyShutdown.update({
      where: { id: shutdownId },
      data: { deductsFromVacation: true, deletedAt: new Date() },
    });
    const deleted = await postEmployee(`${year}-01-01`);
    expect(deleted.statusCode, deleted.body).toBe(201);
    const deletedId = (deleted.json() as { id: string }).id;
    expect(await absencesOf(deletedId)).toHaveLength(0);
    expect(await requestsOf(deletedId)).toHaveLength(0);

    await app.prisma.companyShutdown.update({
      where: { id: shutdownId },
      data: { deletedAt: null },
    });
  });

  it("a failing booking still answers 201 and logs an error with the ids only", async () => {
    const spy = vi
      .spyOn(booking, "bookCompanyShutdownsForHire")
      .mockRejectedValue(new Error("boom"));
    const logSpy = vi.spyOn(app.log, "error");
    try {
      const res = await postEmployee(`${year}-01-01`);
      expect(res.statusCode, res.body).toBe(201);
      const created = res.json() as { id: string };
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await absencesOf(created.id)).toHaveLength(0);

      const calls = logSpy.mock.calls.filter((call) =>
        JSON.stringify(call).includes("Betriebsurlaub"),
      );
      expect(calls).toHaveLength(1);
      const [fields] = calls[0] as [Record<string, unknown>, string];
      expect(fields).toMatchObject({ tenantId: data.tenant.id, employeeId: created.id });
      // Ids only: neither the mail address nor a name reaches the log call.
      const logged = JSON.stringify(calls[0]);
      expect(logged).not.toContain("example.invalid");
      expect(logged).not.toContain("Shutdown1069");
    } finally {
      spy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("CSV import: a committed person gets the booking, a refused row gets nothing", async () => {
    const id = uid();
    const [dd, mm, yyyy] = [`01`, `01`, String(year)];
    const csv = `email;vorname;nachname;nr;eintrittsdatum;rolle;wochenstunden;passwort
csv1069-${id}@example.invalid;Csv;Shutdown1069;C1069-${id};${dd}.${mm}.${yyyy};EMPLOYEE;40;Test-${id}-pw1234!
not-a-mail;Csv;Shutdown1069;C1069-bad-${id};${dd}.${mm}.${yyyy};EMPLOYEE;40;Test-${id}-pw1234!`;

    const absencesBefore = await app.prisma.absence.count({
      where: { companyShutdownId: shutdownId },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/imports/employees",
      headers: authed(data.adminToken),
      payload: { csv },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { imported: number; errors: number };
    expect(body).toMatchObject({ imported: 1, errors: 1 });

    const imported = await app.prisma.employee.findFirstOrThrow({
      where: { tenantId: data.tenant.id, employeeNumber: `C1069-${id}` },
    });
    expect(await absencesOf(imported.id)).toHaveLength(1);
    const requests = await requestsOf(imported.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("APPROVED");
    expect(
      await app.prisma.employee.count({
        where: { tenantId: data.tenant.id, employeeNumber: `C1069-bad-${id}` },
      }),
    ).toBe(0);
    // Exactly one new absence: the refused row left nothing behind.
    expect(await app.prisma.absence.count({ where: { companyShutdownId: shutdownId } })).toBe(
      absencesBefore + 1,
    );
  });
});
