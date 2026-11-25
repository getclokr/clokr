/**
 * Issue #1069 (Task 2) - the rules of the booking: only FREE days are charged, only within the
 * Resturlaub and only against the year the day lies in (the rest is paid release, § 615 BGB), a
 * Betriebsurlaub without the deduction books no Urlaub at all, the actor's reach and four-eyes hold
 * (no SYSTEM approver, nothing skipped silently), a staffing limit never blocks the employer's order
 * but is audited, a closed month is never written, a Berufsschultag is no Urlaub day, a run is
 * idempotent and exclusive, and two active Betriebsurlaube may not overlap.
 *
 * Fixture: one tenant (seedTestData) whose default salon homes every raw person; persons are raw
 * employees created per case (Mo-Fr 8 h contract, hired 2024), so cases never share a person. The
 * booking function is called directly with a synthetic actor (the admin of the seed, whole-tenant
 * reach, or a narrowed one) and `employeeIds` narrowing the run to the case's persons. All windows
 * are computed from the tenant-local today (open future months, Monday to Wednesday, one month, no
 * holiday - asserted). No person names.
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
  auditRowsFor,
  soleNotification,
} from "./setup";
import { getTenantTimezone, monthRangeUtc, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import { ensureLeaveType } from "../contexts/absence/ensure-leave-type";
import { absenceTypeFields } from "../contexts/absence/leave-type";
import { roleNameKey, normalizeRolePermissions } from "../contexts/platform/access-role";
import {
  bookCompanyShutdown,
  type ShutdownActor,
  type ShutdownBookingCounts,
} from "../contexts/absence/company-shutdown/booking";
import {
  COMPANY_SHUTDOWN_BOOKING_RUNNING,
  COMPANY_SHUTDOWN_OVERLAP,
  companyShutdownLockName,
  limitExceptionReasonFor,
} from "../contexts/absence/company-shutdown/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

type Window = { start: string; end: string; year: number };

describe("Issue #1069 - the rules of a Betriebsurlaub booking", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let tz: string;
  let actor: ShutdownActor;
  let approver2: { userId: string; employeeId: string };
  let cursor: Date;
  let vacationTypeId: string;

  /** The next Monday-Wednesday window of an open month (no holiday Mon-Fri, one month, Mon-Fri inside). */
  async function nextWindow(): Promise<Window> {
    for (;;) {
      while (cursor.getUTCDay() !== 1) cursor = plusDays(cursor, 1);
      const monday = cursor;
      cursor = plusDays(cursor, 7);
      const friday = plusDays(monday, 4);
      if (monday.getUTCMonth() !== friday.getUTCMonth()) continue;
      const holidays = await getHolidayMap(app.prisma, tenantId, null, monday, friday);
      if (holidays.size > 0) continue;
      return { start: iso(monday), end: iso(plusDays(monday, 2)), year: monday.getUTCFullYear() };
    }
  }

  function createShutdown(start: string, end: string, deductsFromVacation = true) {
    return app.prisma.companyShutdown.create({
      data: {
        tenantId,
        name: `Betriebsurlaub 1069 ${crypto.randomBytes(3).toString("hex")}`,
        startDate: new Date(start),
        endDate: new Date(end),
        deductsFromVacation,
      },
    });
  }

  async function rawPerson(
    label: string,
    opts: {
      years: number[];
      entitlement?: number;
      used?: number;
      hireDate?: Date;
      salonId?: string;
    },
  ) {
    const user = await app.prisma.user.create({
      data: {
        email: `${label}-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: `P${crypto.randomBytes(4).toString("hex")}`,
        firstName: label,
        lastName: "Rules1069",
        hireDate: opts.hireDate ?? new Date("2024-01-01"),
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
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId,
        employeeId: employee.id,
        salonId: opts.salonId ?? data.salonId,
        kind: "HOME",
        validFrom: new Date("2024-01-01T00:00:00Z"),
        validUntil: null,
        weekdays: [],
      },
    });
    await seedEntitlementYears(app, {
      employeeId: employee.id,
      leaveTypeId: vacationTypeId,
      years: opts.years,
      totalDays: opts.entitlement ?? 30,
    });
    if (opts.used) {
      await app.prisma.leaveEntitlement.updateMany({
        where: { employeeId: employee.id, leaveTypeId: vacationTypeId },
        data: { usedDays: opts.used },
      });
    }
    return { userId: user.id, employeeId: employee.id };
  }

  async function book(
    shutdownId: string,
    employeeIds: string[],
    patch: Partial<ShutdownActor> = {},
  ): Promise<ShutdownBookingCounts> {
    const outcome = await bookCompanyShutdown(app, {
      tenantId,
      shutdownId,
      actor: { ...actor, ...patch },
      employeeIds,
      request: { ip: "127.0.0.1", headers: {} },
    });
    if (!outcome.ok) throw new Error(`booking refused: ${outcome.code}`);
    return outcome.counts;
  }

  async function usedDays(employeeId: string, year: number): Promise<number> {
    const row = await app.prisma.leaveEntitlement.findFirstOrThrow({
      where: { employeeId, year, leaveTypeId: vacationTypeId },
    });
    return Number(row.usedDays);
  }

  function requestsOf(employeeId: string, shutdownId: string) {
    return app.prisma.leaveRequest.findMany({
      where: { employeeId, companyShutdownId: shutdownId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
  }

  function absencesOf(employeeId: string, shutdownId: string) {
    return app.prisma.absence.findMany({
      where: { employeeId, companyShutdownId: shutdownId },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
  }

  async function closeMonth(employeeId: string, year: number, month: number) {
    const { start, end } = monthRangeUtc(year, month, tz);
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId,
        periodType: "MONTHLY",
        periodStart: start,
        periodEnd: end,
        workedMinutes: 0,
        expectedMinutes: 0,
        balanceMinutes: 0,
        carryOver: 0,
        closedAt: new Date(),
        closedBy: "test-system",
      },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cs1069r");
    tenantId = data.tenant.id;
    tz = await getTenantTimezone(app.prisma, tenantId);
    vacationTypeId = data.vacationType.id;
    cursor = plusDays(todayInTz(tz), 40);
    actor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" },
      approveReach: { kind: "wholeTenant" },
      mayCreateOwn: true,
    };
    // A second approver (holds approve and read tenant-wide) who is told about waiting requests.
    const user = await app.prisma.user.create({
      data: {
        email: `approver2-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: `A${crypto.randomBytes(4).toString("hex")}`,
        firstName: "approver",
        lastName: "Rules1069",
        hireDate: new Date("2024-01-01"),
      },
    });
    const roleName = `Rules1069 ${crypto.randomBytes(3).toString("hex")}`;
    const role = await app.prisma.accessRole.create({
      data: {
        tenantId,
        name: roleName,
        nameKey: roleNameKey(roleName),
        permissions: normalizeRolePermissions([
          "leave-request:approve:ZUGEWIESEN",
          "leave-request:read:ZUGEWIESEN",
        ]),
      },
    });
    await app.prisma.roleAssignment.create({
      data: {
        tenantId,
        userId: user.id,
        accessRoleId: role.id,
        scopeType: "TENANT",
        salonIds: [],
        employeeIds: [],
      },
    });
    approver2 = { userId: user.id, employeeId: employee.id };
  });

  afterAll(async () => {
    try {
      await app.prisma.roleAssignment.deleteMany({ where: { tenantId } });
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("company-shutdown-booking-rules-1069 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── Without the deduction: paid release only ──────────────────────────────────────────────────

  it("deductsFromVacation false: every person gets the absence, no request, the entitlement stays, and counts as paid release", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end, false);
    const a = await rawPerson("nodeduct-a", { years: [w.year] });
    const b = await rawPerson("nodeduct-b", { years: [w.year] });

    const counts = await book(shutdown.id, [a.employeeId, b.employeeId]);

    expect(counts).toMatchObject({
      persons: 2,
      absencesWritten: 2,
      vacationApproved: 0,
      vacationPending: 0,
      paidReleaseOnly: 2,
      partlyPaidRelease: 0,
    });
    for (const person of [a, b]) {
      expect(await requestsOf(person.employeeId, shutdown.id)).toHaveLength(0);
      const absences = await absencesOf(person.employeeId, shutdown.id);
      expect(absences).toHaveLength(1);
      expect(iso(absences[0].startDate)).toBe(w.start);
      expect(iso(absences[0].endDate)).toBe(w.end);
      expect(await usedDays(person.employeeId, w.year)).toBe(0);
    }
  });

  // ── Resturlaub: only the available whole days, the rest is paid release ───────────────────────

  describe("Resturlaub (D-04)", () => {
    let w: Window;
    let shutdownId: string;

    beforeAll(async () => {
      w = await nextWindow();
      shutdownId = (await createShutdown(w.start, w.end)).id;
    });

    it("1 day left of Mon-Wed: Monday is charged, the rest is paid release; used days never above the entitlement", async () => {
      const p = await rawPerson("rest-1", { years: [w.year], entitlement: 1 });
      const counts = await book(shutdownId, [p.employeeId]);

      const requests = await requestsOf(p.employeeId, shutdownId);
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe("APPROVED");
      expect(Number(requests[0].days)).toBe(1);
      expect(iso(requests[0].startDate)).toBe(w.start);
      expect(iso(requests[0].endDate)).toBe(w.start);
      expect(await usedDays(p.employeeId, w.year)).toBe(1);
      const absences = await absencesOf(p.employeeId, shutdownId);
      expect(absences).toHaveLength(1);
      expect(iso(absences[0].endDate)).toBe(w.end);
      expect(counts).toMatchObject({
        vacationApproved: 1,
        partlyPaidRelease: 1,
        paidReleaseOnly: 0,
      });
    });

    it("nothing left: no request, the absence alone releases the three days with pay", async () => {
      const p = await rawPerson("rest-0", { years: [w.year], entitlement: 3, used: 3 });
      const counts = await book(shutdownId, [p.employeeId]);

      expect(await requestsOf(p.employeeId, shutdownId)).toHaveLength(0);
      expect(await absencesOf(p.employeeId, shutdownId)).toHaveLength(1);
      expect(await usedDays(p.employeeId, w.year)).toBe(3);
      expect(counts).toMatchObject({
        vacationApproved: 0,
        paidReleaseOnly: 1,
        partlyPaidRelease: 0,
      });
    });

    it("1.5 days left: one whole day is charged, the half day stays on the account", async () => {
      const p = await rawPerson("rest-15", { years: [w.year], entitlement: 1.5 });
      await book(shutdownId, [p.employeeId]);

      const requests = await requestsOf(p.employeeId, shutdownId);
      expect(requests).toHaveLength(1);
      expect(Number(requests[0].days)).toBe(1);
      expect(requests[0].halfDay).toBe(false);
      expect(await usedDays(p.employeeId, w.year)).toBe(1);
    });

    it("a PENDING Urlaub of the person counts against the allowance (a later approval can never overdraw)", async () => {
      const p = await rawPerson("rest-pending", { years: [w.year], entitlement: 1 });
      // Another request of the person (a different day of the same year) is waiting and holds the day.
      const later = plusDays(new Date(w.start), 3); // the Thursday of the same week
      await app.prisma.leaveRequest.create({
        data: {
          employeeId: p.employeeId,
          leaveTypeId: vacationTypeId,
          startDate: later,
          endDate: later,
          days: 1,
          status: "PENDING",
        },
      });
      const counts = await book(shutdownId, [p.employeeId]);

      expect(await requestsOf(p.employeeId, shutdownId)).toHaveLength(0);
      expect(counts.paidReleaseOnly).toBe(1);
    });
  });

  it("a span over the turn of the year books two segments, each charged against the year its days lie in", async () => {
    // The next 29 December that is still ahead, through 5 January: December days belong to year N,
    // January days to year N+1.
    let year = todayInTz(tz).getUTCFullYear();
    if (Date.UTC(year, 11, 29) < plusDays(todayInTz(tz), 30).getTime()) year += 1;
    const shutdown = await createShutdown(`${year}-12-29`, `${year + 1}-01-05`);
    const p = await rawPerson("cross-year", { years: [year, year + 1], entitlement: 30 });

    const counts = await book(shutdown.id, [p.employeeId]);

    const absences = await absencesOf(p.employeeId, shutdown.id);
    expect(absences.map((a) => [iso(a.startDate), iso(a.endDate)])).toEqual([
      [`${year}-12-29`, `${year}-12-31`],
      [`${year + 1}-01-01`, `${year + 1}-01-05`],
    ]);
    const requests = await requestsOf(p.employeeId, shutdown.id);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const december = requests.filter((r) => r.startDate.getUTCFullYear() === year);
    const january = requests.filter((r) => r.startDate.getUTCFullYear() === year + 1);
    expect(december.length).toBeGreaterThan(0);
    expect(january.length).toBeGreaterThan(0);
    // A request never spans the turn of the year ...
    for (const r of requests) expect(r.startDate.getUTCFullYear()).toBe(r.endDate.getUTCFullYear());
    // ... and every year's entitlement carries exactly its own days.
    const sum = (rows: typeof requests) => rows.reduce((acc, r) => acc + Number(r.days), 0);
    expect(await usedDays(p.employeeId, year)).toBe(sum(december));
    expect(await usedDays(p.employeeId, year + 1)).toBe(sum(january));
    expect(counts.absencesWritten).toBe(2);
  });

  // ── Free days only ────────────────────────────────────────────────────────────────────────────

  it("existing leave and recorded work are never charged again: sick Tuesday splits the run, a pending Wednesday and a worked Monday stay as they are", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const monday = new Date(w.start);
    const tuesday = plusDays(monday, 1);
    const wednesday = plusDays(monday, 2);
    const sickTypeId = await ensureLeaveType(app.prisma, app.log, tenantId, "SICK");

    // E1: an approved sick report on Tuesday.
    const e1 = await rawPerson("existing-sick", { years: [w.year] });
    await app.prisma.leaveRequest.create({
      data: {
        employeeId: e1.employeeId,
        leaveTypeId: sickTypeId,
        startDate: tuesday,
        endDate: tuesday,
        days: 1,
        status: "APPROVED",
      },
    });
    // E2: a pending Urlaub on Wednesday and a recorded work entry on Monday; 2 days of entitlement.
    const e2 = await rawPerson("existing-pending", { years: [w.year], entitlement: 2 });
    const waiting = await app.prisma.leaveRequest.create({
      data: {
        employeeId: e2.employeeId,
        leaveTypeId: vacationTypeId,
        startDate: wednesday,
        endDate: wednesday,
        days: 1,
        status: "PENDING",
      },
    });
    await app.prisma.timeEntry.create({
      data: {
        employeeId: e2.employeeId,
        date: monday,
        startTime: new Date(`${w.start}T07:00:00Z`),
        endTime: new Date(`${w.start}T15:00:00Z`),
        breakMinutes: 30,
        type: "WORK",
        salonId: data.salonId,
      },
    });

    const counts = await book(shutdown.id, [e1.employeeId, e2.employeeId]);

    const days = (rows: Array<{ startDate: Date; endDate: Date }>) =>
      rows.map((r) => [iso(r.startDate), iso(r.endDate)]);
    expect(days(await requestsOf(e1.employeeId, shutdown.id))).toEqual([
      [iso(monday), iso(monday)],
      [iso(wednesday), iso(wednesday)],
    ]);
    // E2: only Tuesday is free; the waiting Wednesday request and the worked Monday stay untouched.
    expect(days(await requestsOf(e2.employeeId, shutdown.id))).toEqual([
      [iso(tuesday), iso(tuesday)],
    ]);
    const stillWaiting = await app.prisma.leaveRequest.findUniqueOrThrow({
      where: { id: waiting.id },
    });
    expect(stillWaiting.status).toBe("PENDING");
    expect(stillWaiting.companyShutdownId).toBeNull();
    expect(counts.existingLeavePersons).toBe(2);
    // The absence covers the whole span for both.
    for (const p of [e1, e2]) {
      const absences = await absencesOf(p.employeeId, shutdown.id);
      expect(absences).toHaveLength(1);
      expect(iso(absences[0].endDate)).toBe(w.end);
    }
  });

  // ── Reach and four-eyes ───────────────────────────────────────────────────────────────────────

  describe("reach and four-eyes (D-06)", () => {
    let w: Window;
    let shutdownId: string;

    beforeAll(async () => {
      w = await nextWindow();
      shutdownId = (await createShutdown(w.start, w.end)).id;
    });

    it("the actor's own request stays PENDING and another approver is told once; the absence exists", async () => {
      const counts = await book(shutdownId, [data.adminEmployee.id]);

      const own = await requestsOf(data.adminEmployee.id, shutdownId);
      expect(own).toHaveLength(1);
      expect(own[0].status).toBe("PENDING");
      expect(own[0].reviewedBy).toBeNull();
      expect(await absencesOf(data.adminEmployee.id, shutdownId)).toHaveLength(1);
      expect(counts).toMatchObject({ vacationPending: 1, vacationApproved: 0 });
      const notice = await soleNotification(app.prisma, {
        where: { userId: approver2.userId, type: "LEAVE_REQUEST", relatedId: own[0].id },
      });
      expect(notice.relatedType).toBe("LeaveRequest");
    });

    it("a person outside the actor's approve reach gets a PENDING request and the approvers are told", async () => {
      const p = await rawPerson("outside-approve", { years: [w.year] });
      const counts = await book(shutdownId, [p.employeeId], {
        approveReach: { kind: "scoped", salonIds: [], employeeIds: [crypto.randomUUID()] },
      });

      const requests = await requestsOf(p.employeeId, shutdownId);
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe("PENDING");
      expect(counts.vacationPending).toBe(1);
      await soleNotification(app.prisma, {
        where: { userId: approver2.userId, type: "LEAVE_REQUEST", relatedId: requests[0].id },
      });
    });

    it("a person outside the actor's create reach gets the absence only", async () => {
      const p = await rawPerson("outside-create", { years: [w.year] });
      const counts = await book(shutdownId, [p.employeeId], {
        createReach: { kind: "scoped", salonIds: [], employeeIds: [] },
      });

      expect(await requestsOf(p.employeeId, shutdownId)).toHaveLength(0);
      expect(await absencesOf(p.employeeId, shutdownId)).toHaveLength(1);
      expect(counts.outsideCreateReach).toBe(1);
    });
  });

  // ── Leave limits (#836) ───────────────────────────────────────────────────────────────────────

  it("a staffing limit never stops the approval: the system reason is the audited exception with rule ids and counts", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const a = await rawPerson("limit-a", { years: [w.year] });
    const b = await rawPerson("limit-b", { years: [w.year] });
    const rule = await app.prisma.leaveLimitRule.create({
      data: {
        tenantId,
        salonId: data.salonId,
        groupKind: "ALL",
        maxPersons: 1,
        name: "Fixture 1069",
      },
    });
    try {
      const counts = await book(shutdown.id, [a.employeeId, b.employeeId]);
      expect(counts.vacationApproved).toBe(2);

      const requests = [
        ...(await requestsOf(a.employeeId, shutdown.id)),
        ...(await requestsOf(b.employeeId, shutdown.id)),
      ];
      expect(requests.map((r) => r.status)).toEqual(["APPROVED", "APPROVED"]);
      const withException = [];
      for (const request of requests) {
        for (const row of await auditRowsFor(app, "LeaveRequest", request.id, "APPROVE")) {
          const value = row.newValue as {
            leaveLimitException?: { reason: string; rules: Array<{ ruleId: string }> };
          };
          if (value.leaveLimitException) withException.push(value.leaveLimitException);
        }
      }
      // The second approval pushed the salon over maxPersons 1 and carries the exception.
      expect(withException).toHaveLength(1);
      expect(withException[0].reason).toBe(limitExceptionReasonFor(shutdown));
      expect(withException[0].rules.map((r) => r.ruleId)).toEqual([rule.id]);
    } finally {
      await app.prisma.leaveLimitRule.deleteMany({ where: { tenantId } });
    }
  });

  // ── Closed months ─────────────────────────────────────────────────────────────────────────────

  it("a closed month is never written: December is skipped, January is booked", async () => {
    let year = todayInTz(tz).getUTCFullYear();
    if (Date.UTC(year, 11, 29) < plusDays(todayInTz(tz), 30).getTime()) year += 1;
    const shutdown = await createShutdown(`${year}-12-29`, `${year + 1}-01-05`);
    const p = await rawPerson("closed-month", { years: [year, year + 1] });
    await closeMonth(p.employeeId, year, 12);

    const counts = await book(shutdown.id, [p.employeeId]);

    expect(counts.skippedClosedMonths).toBe(1);
    const absences = await absencesOf(p.employeeId, shutdown.id);
    expect(absences.map((a) => iso(a.startDate))).toEqual([`${year + 1}-01-01`]);
    const requests = await requestsOf(p.employeeId, shutdown.id);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.startDate.getUTCFullYear()).toBe(year + 1);
  });

  // ── Berufsschule ──────────────────────────────────────────────────────────────────────────────

  it("a person whose every shutdown workday is a Berufsschultag gets no Urlaub request (BS_ONLY), the absence exists", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("apprentice", { years: [w.year] });
    for (let i = 0; i < 3; i++) {
      const day = plusDays(new Date(w.start), i);
      await app.prisma.absence.create({
        data: {
          employeeId: p.employeeId,
          ...absenceTypeFields("VOCATIONAL_SCHOOL"),
          source: "PATTERN",
          startDate: day,
          endDate: day,
          days: 1,
          createdBy: data.adminUser.id,
        },
      });
    }

    const counts = await book(shutdown.id, [p.employeeId]);

    expect(await requestsOf(p.employeeId, shutdown.id)).toHaveLength(0);
    expect(await absencesOf(p.employeeId, shutdown.id)).toHaveLength(1);
    expect(counts.refused).toMatchObject({ BS_ONLY: 1 });
    expect(await usedDays(p.employeeId, w.year)).toBe(0);
  });

  // ── Idempotency and exclusivity ───────────────────────────────────────────────────────────────

  it("running the booking again for an already booked person and month writes nothing", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("rerun", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const before = {
      requests: await requestsOf(p.employeeId, shutdown.id),
      absences: await absencesOf(p.employeeId, shutdown.id),
      used: await usedDays(p.employeeId, w.year),
    };

    const again = await book(shutdown.id, [p.employeeId]);

    expect(again).toMatchObject({ absencesWritten: 0, vacationApproved: 0, vacationPending: 0 });
    expect((await requestsOf(p.employeeId, shutdown.id)).map((r) => r.id)).toEqual(
      before.requests.map((r) => r.id),
    );
    expect((await absencesOf(p.employeeId, shutdown.id)).map((a) => a.id)).toEqual(
      before.absences.map((a) => a.id),
    );
    expect(await usedDays(p.employeeId, w.year)).toBe(before.used);
  });

  it("a second run while the shutdown's lock is held answers COMPANY_SHUTDOWN_BOOKING_RUNNING and writes nothing", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("locked", { years: [w.year] });

    const outcome = await app.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${companyShutdownLockName(shutdown.id)}, 0))`;
      return bookCompanyShutdown(app, {
        tenantId,
        shutdownId: shutdown.id,
        actor,
        employeeIds: [p.employeeId],
        request: { ip: "127.0.0.1", headers: {} },
      });
    });

    expect(outcome).toEqual({ ok: false, code: COMPANY_SHUTDOWN_BOOKING_RUNNING });
    expect(await absencesOf(p.employeeId, shutdown.id)).toHaveLength(0);
    expect(await requestsOf(p.employeeId, shutdown.id)).toHaveLength(0);
  });

  // ── Overlap (D-11) ────────────────────────────────────────────────────────────────────────────

  describe("two active Betriebsurlaube of one tenant may not overlap", () => {
    let other: Awaited<ReturnType<typeof seedTestData>>;

    beforeAll(async () => {
      other = await seedTestData(app, "cs1069o");
    });

    afterAll(async () => {
      try {
        await cleanupTestData(app, other.tenant.id);
      } catch (err) {
        console.error("company-shutdown-booking-rules-1069 overlap cleanup failed:", err);
      }
    });

    function post(startDate: string, endDate: string) {
      return app.inject({
        method: "POST",
        url: "/api/v1/company-shutdowns",
        headers: { authorization: `Bearer ${other.adminToken}` },
        payload: { name: "Betriebsurlaub Überschneidung", startDate, endDate },
      });
    }

    it("create answers 409 COMPANY_SHUTDOWN_OVERLAP and writes nothing; a soft-deleted one does not count", async () => {
      const w = await nextWindow();
      const first = await post(w.start, w.end);
      expect(first.statusCode, first.body).toBe(201);
      const firstId = (first.json() as { id: string }).id;

      // Overlaps on the last day.
      const clash = await post(w.end, iso(plusDays(new Date(w.end), 2)));
      expect(clash.statusCode, clash.body).toBe(409);
      expect((clash.json() as { code: string }).code).toBe(COMPANY_SHUTDOWN_OVERLAP);
      expect(await app.prisma.companyShutdown.count({ where: { tenantId: other.tenant.id } })).toBe(
        1,
      );
      expect(
        await app.prisma.absence.count({
          where: { employee: { tenantId: other.tenant.id }, NOT: { companyShutdownId: firstId } },
        }),
      ).toBe(0);

      // The next day after the first one is free.
      const adjacent = await post(
        iso(plusDays(new Date(w.end), 1)),
        iso(plusDays(new Date(w.end), 2)),
      );
      expect(adjacent.statusCode, adjacent.body).toBe(201);

      // A soft-deleted Betriebsurlaub does not block its days.
      await app.prisma.companyShutdown.updateMany({
        where: { id: firstId, tenantId: other.tenant.id },
        data: { deletedAt: new Date() },
      });
      const again = await post(w.start, w.end);
      expect(again.statusCode, again.body).toBe(201);
    });
  });

  it("the booking never books for a person of another tenant even when the id is passed", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const foreign = await seedTestData(app, "cs1069f");
    try {
      const counts = await book(shutdown.id, [foreign.employee.id]);
      expect(counts.persons).toBe(0);
      expect(await app.prisma.absence.count({ where: { employeeId: foreign.employee.id } })).toBe(
        0,
      );
    } finally {
      await cleanupTestData(app, foreign.tenant.id);
    }
  });
});
