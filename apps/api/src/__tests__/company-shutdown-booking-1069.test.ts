/**
 * Issue #1069 (tracer) - a Betriebsurlaub with "Vom Urlaubskonto abziehen" (the default) books, for
 * every person employed on its days, a COMPANY_SHUTDOWN absence and - through the leave cores - an
 * Urlaub request linked to the shutdown. The actor's own request waits for another approver
 * (four-eyes, D-06); the employer's order is not stopped by the lead-time rule (D-05) while a
 * regular request still is.
 *
 * Fixture: one tenant (seedTestData), the admin (an employee of the tenant, whole-tenant reach) as
 * the actor, the seeded EMPLOYEE (FIXED Mo-Fr 8 h) as the person. The shutdown is Monday and Tuesday
 * of an open month at least 40 days ahead - computed from the tenant-local today, both days in one
 * month, no holiday at the fixture salon (asserted, not assumed). No person names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  seedEntitlementYears,
  soleAuditRow,
  auditRowsFor,
} from "./setup";
import { dayRangeUtc, getTenantTimezone, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import {
  bookCompanyShutdown,
  type ShutdownActor,
} from "../contexts/absence/company-shutdown/booking";
import { COMPANY_SHUTDOWN_BOOKED } from "../contexts/absence/company-shutdown/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

describe("Issue #1069 - a Betriebsurlaub books Urlaub and its absence through the leave cores", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tz: string;
  let day1: string; // Monday
  let day2: string; // Tuesday
  let year: number;
  let shutdownId: string;
  let postBody: Record<string, unknown> & { booking: Record<string, unknown> };
  let actor: ShutdownActor;

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function usedDays(employeeId: string): Promise<number> {
    const row = await app.prisma.leaveEntitlement.findFirstOrThrow({
      where: { employeeId, year, leaveType: { code: "VACATION" } },
    });
    return Number(row.usedDays);
  }

  /** A raw person (own user, Mo-Fr contract, entitlement of the shutdown year). */
  async function rawPerson(label: string, hireDate: Date, names?: { first: string; last: string }) {
    const user = await app.prisma.user.create({
      data: {
        email: `${label}-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: names?.first ?? label,
        lastName: names?.last ?? "Shutdown1069",
        hireDate,
      },
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        weeklyHours: 40,
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date("2024-01-01"),
      },
    });
    await seedEntitlementYears(app, {
      employeeId: employee.id,
      leaveTypeId: data.vacationType.id,
      years: [year],
      totalDays: 30,
    });
    return employee;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cs1069");
    tz = await getTenantTimezone(app.prisma, data.tenant.id);

    // Monday + Tuesday, same month, no holiday, at least 40 days ahead (tenant-local today).
    let monday = plusDays(todayInTz(tz), 40);
    while (monday.getUTCDay() !== 1) monday = plusDays(monday, 1);
    for (;;) {
      const tuesday = plusDays(monday, 1);
      const holidays = await getHolidayMap(app.prisma, data.tenant.id, null, monday, tuesday);
      if (monday.getUTCMonth() === tuesday.getUTCMonth() && holidays.size === 0) {
        day1 = iso(monday);
        day2 = iso(tuesday);
        break;
      }
      monday = plusDays(monday, 7);
    }
    year = Number(day1.slice(0, 4));
    for (const employeeId of [data.employee.id, data.adminEmployee.id]) {
      await seedEntitlementYears(app, {
        employeeId,
        leaveTypeId: data.vacationType.id,
        years: [year],
        totalDays: 30,
      });
    }
    // The tenant's lead-time rule: a regular request must be filed 90 days ahead.
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { vacationLeadTimeDays: 90 },
    });
    actor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" },
      approveReach: { kind: "wholeTenant" },
      mayCreateOwn: true,
    };
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("company-shutdown-booking-1069 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("POST /company-shutdowns books an APPROVED, linked Urlaub request and the absence for the person and answers the counts", async () => {
    const before = await usedDays(data.employee.id);
    const adminBefore = await usedDays(data.adminEmployee.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/company-shutdowns",
      headers: authed(data.adminToken),
      payload: { name: "Betriebsurlaub 1069", startDate: day1, endDate: day2 },
    });
    expect(res.statusCode, res.body).toBe(201);
    postBody = res.json();
    shutdownId = postBody.id as string;
    expect(postBody.deductsFromVacation).toBe(true);

    // The answer carries counts only: no id, no name of a person.
    expect(postBody.booking).toMatchObject({
      persons: 2,
      absencesWritten: 2,
      vacationApproved: 1,
      vacationPending: 1,
    });
    const bookingText = JSON.stringify(postBody.booking);
    expect(bookingText).not.toContain(data.employee.id);
    expect(bookingText).not.toContain(data.adminEmployee.id);

    // The person: one APPROVED request, linked, reviewed by the actor, two days charged.
    const requests = await app.prisma.leaveRequest.findMany({
      where: { employeeId: data.employee.id, companyShutdownId: shutdownId },
      include: { leaveType: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      status: "APPROVED",
      reviewedBy: data.adminUser.id,
      halfDay: false,
      deletedAt: null,
    });
    expect(Number(requests[0].days)).toBe(2);
    expect(iso(requests[0].startDate)).toBe(day1);
    expect(iso(requests[0].endDate)).toBe(day2);
    expect(requests[0].leaveType.code).toBe("VACATION");
    expect(await usedDays(data.employee.id)).toBe(before + 2);

    // The imposed absence: one row over both days, linked, active.
    const absences = await app.prisma.absence.findMany({
      where: { employeeId: data.employee.id, companyShutdownId: shutdownId },
    });
    expect(absences).toHaveLength(1);
    expect(absences[0]).toMatchObject({
      type: "COMPANY_SHUTDOWN",
      source: "MANUAL",
      halfDay: false,
      deletedAt: null,
      createdBy: data.adminUser.id,
    });
    expect(iso(absences[0].startDate)).toBe(day1);
    expect(iso(absences[0].endDate)).toBe(day2);

    // The actor's own request waits for another approver (four-eyes); the absence exists anyway.
    const own = await app.prisma.leaveRequest.findMany({
      where: { employeeId: data.adminEmployee.id, companyShutdownId: shutdownId },
    });
    expect(own).toHaveLength(1);
    expect(own[0].status).toBe("PENDING");
    expect(own[0].reviewedBy).toBeNull();
    expect(await usedDays(data.adminEmployee.id)).toBe(adminBefore);
    expect(
      await app.prisma.absence.count({
        where: { employeeId: data.adminEmployee.id, companyShutdownId: shutdownId },
      }),
    ).toBe(1);
  });

  it("audits every write: the marker on the request CREATE, one CREATE per absence, one summary row, deductsFromVacation on the shutdown CREATE", async () => {
    const request = await app.prisma.leaveRequest.findFirstOrThrow({
      where: { employeeId: data.employee.id, companyShutdownId: shutdownId },
    });
    const create = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: request.id, action: "CREATE" },
    });
    expect(create.userId).toBe(data.adminUser.id);
    expect(create.newValue).toMatchObject({
      type: "VACATION",
      trigger: "COMPANY_SHUTDOWN",
      companyShutdownId: shutdownId,
      source: "MANAGER_CREATED",
      targetEmployeeId: data.employee.id,
    });

    // The actor's own request is not "on behalf of": no source / target keys.
    const ownRequest = await app.prisma.leaveRequest.findFirstOrThrow({
      where: { employeeId: data.adminEmployee.id, companyShutdownId: shutdownId },
    });
    const ownCreate = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: ownRequest.id, action: "CREATE" },
    });
    expect(ownCreate.newValue).toMatchObject({ trigger: "COMPANY_SHUTDOWN" });
    expect(ownCreate.newValue).not.toHaveProperty("source");

    const absences = await app.prisma.absence.findMany({
      where: { companyShutdownId: shutdownId },
      select: { id: true },
    });
    expect(absences).toHaveLength(2);
    for (const absence of absences) {
      const row = await soleAuditRow(app.prisma, {
        where: { entity: "Absence", entityId: absence.id, action: "CREATE" },
      });
      expect(row.userId).toBe(data.adminUser.id);
      expect(row.newValue).toMatchObject({
        type: "COMPANY_SHUTDOWN",
        companyShutdownId: shutdownId,
      });
    }

    const summary = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: shutdownId, action: COMPANY_SHUTDOWN_BOOKED },
    });
    expect(summary.userId).toBe(data.adminUser.id);
    expect(summary.newValue).toMatchObject({ persons: 2, vacationApproved: 1 });

    const created = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: shutdownId, action: "CREATE" },
    });
    expect(created.newValue).toMatchObject({ deductsFromVacation: true });
  });

  it("the tenant lead-time rule (90 days) does not stop the employer's order, while a regular request is still refused", async () => {
    // The booking above succeeded although the shutdown is only ~40 days ahead.
    expect(
      await app.prisma.leaveRequest.count({
        where: { employeeId: data.employee.id, companyShutdownId: shutdownId },
      }),
    ).toBe(1);
    // The core default is unchanged: the same person filing a request of their own, nearer than 90 days.
    const nearer = plusDays(todayInTz(tz), 14);
    let from = nearer;
    while (from.getUTCDay() !== 1) from = plusDays(from, 1);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/leave/requests",
      headers: authed(data.empToken),
      payload: { type: "VACATION", startDate: iso(from), endDate: iso(plusDays(from, 1)) },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: string }).error).toContain("Tage im Voraus");
  });

  it("a person employed only from the second day, an anonymised person and a person on the exception list: only the first is booked, a re-run adds nothing for the others", async () => {
    const lateHire = await rawPerson("late", dayRangeUtc(day2, tz).start);
    const anonymised = await rawPerson("anon", new Date("2024-01-01"), {
      first: "Gelöscht",
      last: `GELÖSCHT-${crypto.randomBytes(3).toString("hex")}`,
    });
    const excepted = await rawPerson("exc", new Date("2024-01-01"));
    await app.prisma.companyShutdownException.create({
      data: { shutdownId, employeeId: excepted.id, reason: null },
    });
    const requestsBefore = await app.prisma.leaveRequest.count({
      where: { companyShutdownId: shutdownId },
    });
    const absencesBefore = await app.prisma.absence.count({
      where: { companyShutdownId: shutdownId },
    });

    const outcome = await bookCompanyShutdown(app, {
      tenantId: data.tenant.id,
      shutdownId,
      actor,
      request: { ip: "127.0.0.1", headers: {} },
    });
    expect(outcome.ok).toBe(true);

    // The late hire: the second day only.
    const lateAbsence = await app.prisma.absence.findMany({
      where: { employeeId: lateHire.id, companyShutdownId: shutdownId },
    });
    expect(lateAbsence).toHaveLength(1);
    expect(iso(lateAbsence[0].startDate)).toBe(day2);
    expect(iso(lateAbsence[0].endDate)).toBe(day2);
    const lateRequest = await app.prisma.leaveRequest.findMany({
      where: { employeeId: lateHire.id, companyShutdownId: shutdownId },
    });
    expect(lateRequest).toHaveLength(1);
    expect(lateRequest[0].status).toBe("APPROVED");
    expect(Number(lateRequest[0].days)).toBe(1);
    expect(iso(lateRequest[0].startDate)).toBe(day2);

    // Nothing for the anonymised person and the person on the exception list.
    for (const id of [anonymised.id, excepted.id]) {
      expect(await app.prisma.absence.count({ where: { employeeId: id } })).toBe(0);
      expect(await app.prisma.leaveRequest.count({ where: { employeeId: id } })).toBe(0);
    }

    // Everything already booked stays as it was: exactly one new request and one new absence.
    expect(await app.prisma.leaveRequest.count({ where: { companyShutdownId: shutdownId } })).toBe(
      requestsBefore + 1,
    );
    expect(await app.prisma.absence.count({ where: { companyShutdownId: shutdownId } })).toBe(
      absencesBefore + 1,
    );
    const summaries = await auditRowsFor(
      app,
      "CompanyShutdown",
      shutdownId,
      COMPANY_SHUTDOWN_BOOKED,
    );
    expect(summaries).toHaveLength(2);
  });
});
