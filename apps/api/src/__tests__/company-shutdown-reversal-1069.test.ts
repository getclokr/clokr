/**
 * Issue #1069 (Task 4, O-5, D-08..D-11, D-21, D-22) - reversal: an edit of the period or of the
 * deduction flag, a delete and an exception cancel the generated bookings of OPEN months through the
 * cancellation core shared with the employment exit (Urlaub booked back, absences soft-deleted) and
 * book again where the Betriebsurlaub still applies; a closed month is never touched; a delete is a
 * soft delete; a foreign or unknown employee id on the exception routes writes nothing.
 *
 * Fixture: one tenant (seedTestData); persons are raw employees created per case (Mo-Fr 8 h, hired
 * 2024) and retired after the case so a later case's whole-population run (a route PATCH books
 * everybody employed) does not touch them. The seed fixtures are booked as well and are not asserted.
 * Windows are computed from the tenant-local today (open future months, holiday-free, asserted).
 * No person names.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
  soleAuditRow,
  soleNotification,
} from "./setup";
import { getTenantTimezone, monthRangeUtc, todayInTz } from "../contexts/working-time-account";
import { getHolidayMap } from "../contexts/absence/leave-days";
import { roleNameKey, normalizeRolePermissions } from "../contexts/platform/access-role";
import {
  bookCompanyShutdown,
  type ShutdownActor,
  type ShutdownBookingCounts,
} from "../contexts/absence/company-shutdown/booking";
import { COMPANY_SHUTDOWN_OVERLAP } from "../contexts/absence/company-shutdown/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function plusDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

type Window = { start: string; end: string; year: number };
type Booking = ShutdownBookingCounts;

describe("Issue #1069 - edits, deletes and exceptions cancel generated bookings in open months only", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let tz: string;
  let actor: ShutdownActor;
  let approver: { userId: string; employeeId: string };
  let cursor: Date;
  let farCursor: Date;
  let vacationTypeId: string;
  const created: string[] = [];

  function authed(token = data.adminToken) {
    return { authorization: `Bearer ${token}` };
  }

  /** The next Monday-Wednesday window of an open month (Mon-Fri holiday-free, inside one month). */
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

  /**
   * A holiday-free span over a month boundary: its first part lies in month M, its second in month
   * M+1, both with at least one workday. Searched far ahead so it never meets a Mon-Wed window.
   */
  async function crossMonthWindow(): Promise<{
    start: string;
    end: string;
    first: { year: number; month: number };
    lastOfFirst: string;
  }> {
    for (;;) {
      const lastOfMonth = new Date(
        Date.UTC(farCursor.getUTCFullYear(), farCursor.getUTCMonth() + 1, 0),
      );
      farCursor = new Date(Date.UTC(farCursor.getUTCFullYear(), farCursor.getUTCMonth() + 1, 1));
      const start = plusDays(lastOfMonth, -3);
      const end = plusDays(lastOfMonth, 3);
      const holidays = await getHolidayMap(app.prisma, tenantId, null, start, end);
      if (holidays.size > 0) continue;
      const weekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
      let inFirst = 0;
      let inSecond = 0;
      for (let d = start; d <= end; d = plusDays(d, 1)) {
        if (!weekday(d)) continue;
        if (d <= lastOfMonth) inFirst += 1;
        else inSecond += 1;
      }
      if (inFirst === 0 || inSecond === 0) continue;
      return {
        start: iso(start),
        end: iso(end),
        first: { year: lastOfMonth.getUTCFullYear(), month: lastOfMonth.getUTCMonth() + 1 },
        lastOfFirst: iso(lastOfMonth),
      };
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

  async function rawPerson(label: string, opts: { years: number[]; entitlement?: number }) {
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
        lastName: "Reversal1069",
        hireDate: new Date("2024-01-01"),
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
        salonId: data.salonId,
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
    created.push(employee.id);
    return { userId: user.id, employeeId: employee.id };
  }

  async function book(
    shutdownId: string,
    employeeIds: string[],
    patch: Partial<ShutdownActor> = {},
  ): Promise<Booking> {
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

  function patch(id: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "PATCH",
      url: `/api/v1/company-shutdowns/${id}`,
      headers: authed(),
      payload,
    });
  }

  function remove(id: string) {
    return app.inject({
      method: "DELETE",
      url: `/api/v1/company-shutdowns/${id}`,
      headers: authed(),
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cs1069v");
    tenantId = data.tenant.id;
    tz = await getTenantTimezone(app.prisma, tenantId);
    vacationTypeId = data.vacationType.id;
    cursor = plusDays(todayInTz(tz), 40);
    farCursor = plusDays(todayInTz(tz), 300);
    actor = {
      userId: data.adminUser.id,
      employeeId: data.adminEmployee.id,
      createReach: { kind: "wholeTenant" },
      approveReach: { kind: "wholeTenant" },
      mayCreateOwn: true,
    };
    // A second approver who is told about waiting requests.
    const user = await app.prisma.user.create({
      data: {
        email: `approver-${crypto.randomBytes(3).toString("hex")}@example.invalid`,
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
        lastName: "Reversal1069",
        hireDate: new Date("2024-01-01"),
      },
    });
    const roleName = `Reversal1069 ${crypto.randomBytes(3).toString("hex")}`;
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
    approver = { userId: user.id, employeeId: employee.id };
  });

  afterEach(async () => {
    // Retire the case's persons: a later whole-population run must not employ them in its window.
    if (created.length === 0) return;
    await app.prisma.employee.updateMany({
      where: { id: { in: created.splice(0) }, tenantId },
      data: { exitDate: new Date("2024-01-02") },
    });
  });

  afterAll(async () => {
    try {
      await app.prisma.roleAssignment.deleteMany({ where: { tenantId } });
      await cleanupTestData(app, tenantId);
    } catch (err) {
      console.error("company-shutdown-reversal-1069 cleanup failed:", err);
    }
    await closeTestApp();
  });

  // ── PATCH: the period changes ─────────────────────────────────────────────────────────────────

  it("PATCH ending a fully booked Mon-Wed shutdown on Tuesday cancels the old request, books the new one and restores the absence row", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("patch-end", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const [oldRequest] = await requestsOf(p.employeeId, shutdown.id);
    const [oldAbsence] = await absencesOf(p.employeeId, shutdown.id);
    expect(Number(oldRequest.days)).toBe(3);
    expect(await usedDays(p.employeeId, w.year)).toBe(3);
    const tuesday = iso(plusDays(new Date(w.start), 1));

    const res = await patch(shutdown.id, { endDate: tuesday });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { booking: Booking; endDate: string };
    expect(body.booking.reversedRequests).toBeGreaterThanOrEqual(1);
    expect(body.booking.vacationApproved).toBeGreaterThanOrEqual(1);

    const requests = await requestsOf(p.employeeId, shutdown.id);
    const cancelled = requests.find((r) => r.id === oldRequest.id)!;
    expect(cancelled.status).toBe("CANCELLED");
    const fresh = requests.filter((r) => r.status === "APPROVED");
    expect(fresh).toHaveLength(1);
    expect(Number(fresh[0].days)).toBe(2);
    expect(iso(fresh[0].endDate)).toBe(tuesday);
    // The three old days were booked back before the two new ones were charged: 2, not 5.
    expect(await usedDays(p.employeeId, w.year)).toBe(2);

    const absences = await absencesOf(p.employeeId, shutdown.id);
    expect(absences).toHaveLength(1);
    expect(absences[0].id).toBe(oldAbsence.id);
    expect(absences[0].deletedAt).toBeNull();
    expect(iso(absences[0].endDate)).toBe(tuesday);

    const cancel = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: oldRequest.id, action: "CANCEL" },
    });
    expect(cancel.newValue).toMatchObject({
      status: "CANCELLED",
      auditReason: "Betriebsurlaub geändert",
      trigger: "COMPANY_SHUTDOWN_REVERSED",
      companyShutdownId: shutdown.id,
    });
    // Reversal of the absence and its restore are both audited; the restore carries old and new.
    const absenceAudits = await auditRowsFor(app, "Absence", oldAbsence.id);
    expect(absenceAudits.map((a) => a.action)).toEqual(["CREATE", "DELETE", "UPDATE"]);
    const restore = absenceAudits[2];
    expect(JSON.stringify(restore.newValue)).toContain(tuesday);
    const summary = await soleAuditRow(app.prisma, {
      where: {
        entity: "CompanyShutdown",
        entityId: shutdown.id,
        action: "COMPANY_SHUTDOWN_REVERSED",
      },
    });
    expect(summary.newValue).toMatchObject({ reason: "CHANGED" });
  });

  it("PATCH of name or notes only writes no booking rows - and its UPDATE audit carries deductsFromVacation", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("patch-name", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const before = {
      requests: await requestsOf(p.employeeId, shutdown.id),
      absences: await absencesOf(p.employeeId, shutdown.id),
    };

    const res = await patch(shutdown.id, { name: "Betriebsurlaub umbenannt", notes: "n" });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { booking: Booking }).booking).toMatchObject({
      reversedRequests: 0,
      reversedAbsences: 0,
      vacationApproved: 0,
    });

    const after = {
      requests: await requestsOf(p.employeeId, shutdown.id),
      absences: await absencesOf(p.employeeId, shutdown.id),
    };
    expect(after.requests.map((r) => [r.id, r.status, r.updatedAt.getTime()])).toEqual(
      before.requests.map((r) => [r.id, r.status, r.updatedAt.getTime()]),
    );
    expect(after.absences.map((a) => [a.id, a.deletedAt, a.endDate.getTime()])).toEqual(
      before.absences.map((a) => [a.id, a.deletedAt, a.endDate.getTime()]),
    );
    const update = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: shutdown.id, action: "UPDATE" },
    });
    expect(update.newValue).toMatchObject({ deductsFromVacation: true });
    expect(update.oldValue).toMatchObject({ deductsFromVacation: true });
  });

  it("PATCH deductsFromVacation true -> false cancels every generated request and gives the Urlaub back; the absences stay", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("patch-flag", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    expect(await usedDays(p.employeeId, w.year)).toBe(3);

    const res = await patch(shutdown.id, { deductsFromVacation: false });
    expect(res.statusCode, res.body).toBe(200);

    const requests = await requestsOf(p.employeeId, shutdown.id);
    expect(requests.map((r) => r.status)).toEqual(["CANCELLED"]);
    expect(await usedDays(p.employeeId, w.year)).toBe(0);
    const absences = await absencesOf(p.employeeId, shutdown.id);
    expect(absences).toHaveLength(1);
    expect(absences[0].deletedAt).toBeNull();
  });

  it("PATCH moving the range into another active shutdown answers 409 COMPANY_SHUTDOWN_OVERLAP and changes nothing", async () => {
    const w1 = await nextWindow();
    const w2 = await nextWindow();
    const first = await createShutdown(w1.start, w1.end);
    const second = await createShutdown(w2.start, w2.end);
    const p = await rawPerson("patch-overlap", { years: [w1.year, w2.year] });
    await book(second.id, [p.employeeId]);
    const before = await requestsOf(p.employeeId, second.id);

    const res = await patch(second.id, { startDate: w1.start });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { code: string }).code).toBe(COMPANY_SHUTDOWN_OVERLAP);

    const row = await app.prisma.companyShutdown.findFirstOrThrow({
      where: { id: second.id, tenantId },
    });
    expect(iso(row.startDate)).toBe(w2.start);
    expect((await requestsOf(p.employeeId, second.id)).map((r) => [r.id, r.status])).toEqual(
      before.map((r) => [r.id, r.status]),
    );
    expect(first.id).not.toBe(second.id);
  });

  // ── Closed months are never touched (D-08) ────────────────────────────────────────────────────

  describe("a span over a closed and an open month", () => {
    async function setup(deducts: boolean) {
      const span = await crossMonthWindow();
      const shutdown = await createShutdown(span.start, span.end, deducts);
      const years = [Number(span.start.slice(0, 4)), Number(span.end.slice(0, 4))];
      const p = await rawPerson("closed-span", { years: [...new Set(years)] });
      await book(shutdown.id, [p.employeeId]);
      await closeMonth(p.employeeId, span.first.year, span.first.month);
      return { span, shutdown, p };
    }

    it("DELETE reverses the open month only: the closed month keeps its approved request and its absence", async () => {
      const { span, shutdown, p } = await setup(true);
      const before = await requestsOf(p.employeeId, shutdown.id);
      const inClosed = before.filter((r) => iso(r.startDate) <= span.lastOfFirst);
      const inOpen = before.filter((r) => iso(r.startDate) > span.lastOfFirst);
      expect(inClosed.length).toBeGreaterThan(0);
      expect(inOpen.length).toBeGreaterThan(0);

      const res = await remove(shutdown.id);
      expect(res.statusCode, res.body).toBe(204);

      const after = await requestsOf(p.employeeId, shutdown.id);
      for (const r of after.filter((x) => inClosed.some((c) => c.id === x.id))) {
        expect(r.status).toBe("APPROVED");
      }
      for (const r of after.filter((x) => inOpen.some((c) => c.id === x.id))) {
        expect(r.status).toBe("CANCELLED");
      }
      const absences = await absencesOf(p.employeeId, shutdown.id);
      const closedAbsence = absences.find((a) => iso(a.startDate) <= span.lastOfFirst)!;
      const openAbsence = absences.find((a) => iso(a.startDate) > span.lastOfFirst)!;
      expect(closedAbsence.deletedAt).toBeNull();
      expect(openAbsence.deletedAt).not.toBeNull();
      const summary = await soleAuditRow(app.prisma, {
        where: {
          entity: "CompanyShutdown",
          entityId: shutdown.id,
          action: "COMPANY_SHUTDOWN_REVERSED",
        },
      });
      expect(summary.newValue).toMatchObject({ reason: "DELETED" });
      expect(
        (summary.newValue as { skippedClosedMonths: number }).skippedClosedMonths,
      ).toBeGreaterThanOrEqual(1);
    });

    it("PATCH deductsFromVacation false changes the open month only and reports the skipped closed month", async () => {
      const { span, shutdown, p } = await setup(true);

      const res = await patch(shutdown.id, { deductsFromVacation: false });
      expect(res.statusCode, res.body).toBe(200);
      expect(
        (res.json() as { booking: Booking }).booking.skippedClosedMonths,
      ).toBeGreaterThanOrEqual(1);

      const requests = await requestsOf(p.employeeId, shutdown.id);
      for (const r of requests) {
        expect(r.status).toBe(iso(r.startDate) <= span.lastOfFirst ? "APPROVED" : "CANCELLED");
      }
      const absences = await absencesOf(p.employeeId, shutdown.id);
      expect(absences.every((a) => a.deletedAt === null)).toBe(true);
    });
  });

  // ── DELETE: a soft delete ─────────────────────────────────────────────────────────────────────

  it("DELETE answers 204, keeps the row with deletedAt, hides it from every reader and reverses its open-month rows", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("delete-soft", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const [request] = await requestsOf(p.employeeId, shutdown.id);

    const res = await remove(shutdown.id);
    expect(res.statusCode, res.body).toBe(204);

    const row = await app.prisma.companyShutdown.findFirst({
      where: { id: shutdown.id, tenantId },
    });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/company-shutdowns",
      headers: authed(),
    });
    expect((list.json() as Array<{ id: string }>).map((s) => s.id)).not.toContain(shutdown.id);

    // The identical answers of an unknown id (no oracle).
    const unknown = crypto.randomUUID();
    const exceptionBody = { employeeId: p.employeeId };
    const probes: Array<[string, string, Record<string, unknown> | undefined]> = [
      ["PATCH", "", { name: "x" }],
      ["DELETE", "", undefined],
      ["POST", "/exceptions", exceptionBody],
      ["DELETE", `/exceptions/${p.employeeId}`, undefined],
    ];
    for (const [method, tail, payload] of probes) {
      const gone = await app.inject({
        method: method as "PATCH",
        url: `/api/v1/company-shutdowns/${shutdown.id}${tail}`,
        headers: authed(),
        payload,
      });
      const never = await app.inject({
        method: method as "PATCH",
        url: `/api/v1/company-shutdowns/${unknown}${tail}`,
        headers: authed(),
        payload,
      });
      expect([gone.statusCode, gone.body], `${method} ${tail}`).toEqual([
        never.statusCode,
        never.body,
      ]);
      expect(gone.statusCode).toBe(404);
    }

    expect((await requestsOf(p.employeeId, shutdown.id)).map((r) => r.status)).toEqual([
      "CANCELLED",
    ]);
    expect(await usedDays(p.employeeId, w.year)).toBe(0);
    const absences = await absencesOf(p.employeeId, shutdown.id);
    expect(absences.every((a) => a.deletedAt !== null)).toBe(true);
    const cancel = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: request.id, action: "CANCEL" },
    });
    expect(cancel.newValue).toMatchObject({ auditReason: "Betriebsurlaub gelöscht" });
    const del = await soleAuditRow(app.prisma, {
      where: { entity: "CompanyShutdown", entityId: shutdown.id, action: "DELETE" },
    });
    expect(del.oldValue).toMatchObject({ deductsFromVacation: true });
  });

  // ── Exceptions after the booking ──────────────────────────────────────────────────────────────

  it("adding an exception cancels that person's bookings of open months only; removing it books them again", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const excepted = await rawPerson("exc-a", { years: [w.year] });
    const other = await rawPerson("exc-b", { years: [w.year] });
    await book(shutdown.id, [excepted.employeeId, other.employeeId]);
    const [oldRequest] = await requestsOf(excepted.employeeId, shutdown.id);
    const [oldAbsence] = await absencesOf(excepted.employeeId, shutdown.id);
    const otherBefore = await requestsOf(other.employeeId, shutdown.id);

    const add = await app.inject({
      method: "POST",
      url: `/api/v1/company-shutdowns/${shutdown.id}/exceptions`,
      headers: authed(),
      payload: { employeeId: excepted.employeeId, reason: "arbeitet" },
    });
    expect(add.statusCode, add.body).toBe(201);
    expect(Object.keys(add.json() as object).sort()).toEqual(
      ["createdAt", "employee", "employeeId", "id", "reason", "shutdownId"].sort(),
    );

    expect((await requestsOf(excepted.employeeId, shutdown.id)).map((r) => r.status)).toEqual([
      "CANCELLED",
    ]);
    expect(await usedDays(excepted.employeeId, w.year)).toBe(0);
    expect((await absencesOf(excepted.employeeId, shutdown.id))[0].deletedAt).not.toBeNull();
    const cancel = await soleAuditRow(app.prisma, {
      where: { entity: "LeaveRequest", entityId: oldRequest.id, action: "CANCEL" },
    });
    expect(cancel.newValue).toMatchObject({ auditReason: "Ausnahme vom Betriebsurlaub" });
    // Another person is untouched.
    expect(
      (await requestsOf(other.employeeId, shutdown.id)).map((r) => [
        r.id,
        r.status,
        r.updatedAt.getTime(),
      ]),
    ).toEqual(otherBefore.map((r) => [r.id, r.status, r.updatedAt.getTime()]));
    expect(await usedDays(other.employeeId, w.year)).toBe(3);

    const removeRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/company-shutdowns/${shutdown.id}/exceptions/${excepted.employeeId}`,
      headers: authed(),
    });
    expect(removeRes.statusCode, removeRes.body).toBe(204);

    const requests = await requestsOf(excepted.employeeId, shutdown.id);
    expect(requests.filter((r) => r.status === "APPROVED")).toHaveLength(1);
    expect(await usedDays(excepted.employeeId, w.year)).toBe(3);
    const absences = await absencesOf(excepted.employeeId, shutdown.id);
    expect(absences).toHaveLength(1);
    expect(absences[0].id).toBe(oldAbsence.id);
    expect(absences[0].deletedAt).toBeNull();
  });

  it("an employee id of another tenant on the exception routes gives the answer of an unknown id and writes nothing", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("exc-foreign", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const foreign = await seedTestData(app, "cs1069x");
    try {
      const calls = async (employeeId: string) => {
        const add = await app.inject({
          method: "POST",
          url: `/api/v1/company-shutdowns/${shutdown.id}/exceptions`,
          headers: authed(),
          payload: { employeeId },
        });
        const del = await app.inject({
          method: "DELETE",
          url: `/api/v1/company-shutdowns/${shutdown.id}/exceptions/${employeeId}`,
          headers: authed(),
        });
        return [add.statusCode, add.body, del.statusCode, del.body];
      };
      expect(await calls(foreign.employee.id)).toEqual(await calls(crypto.randomUUID()));
      expect(await app.prisma.absence.count({ where: { employeeId: foreign.employee.id } })).toBe(
        0,
      );
      expect(
        await app.prisma.leaveRequest.count({ where: { employeeId: foreign.employee.id } }),
      ).toBe(0);
      expect((await requestsOf(p.employeeId, shutdown.id)).map((r) => r.status)).toEqual([
        "APPROVED",
      ]);
    } finally {
      await cleanupTestData(app, foreign.tenant.id);
    }
  });

  // ── Which rows a reversal touches ─────────────────────────────────────────────────────────────

  it("the actor's own PENDING request is cancelled without booking back and its approver notice is dismissed; REJECTED and CANCELLED rows stay", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const adminId = data.adminEmployee.id;
    await book(shutdown.id, [adminId]);
    const [own] = await requestsOf(adminId, shutdown.id);
    expect(own.status).toBe("PENDING");
    const notice = await soleNotification(app.prisma, {
      where: { userId: approver.userId, type: "LEAVE_REQUEST", relatedId: own.id },
    });
    expect(notice.dismissedAt).toBeNull();
    const usedBefore = await usedDays(adminId, w.year);

    const later = (n: number) => plusDays(new Date(w.start), n);
    const rejected = await app.prisma.leaveRequest.create({
      data: {
        employeeId: adminId,
        leaveTypeId: vacationTypeId,
        startDate: later(3),
        endDate: later(3),
        days: 1,
        status: "REJECTED",
        companyShutdownId: shutdown.id,
      },
    });
    const cancelled = await app.prisma.leaveRequest.create({
      data: {
        employeeId: adminId,
        leaveTypeId: vacationTypeId,
        startDate: later(4),
        endDate: later(4),
        days: 1,
        status: "CANCELLED",
        companyShutdownId: shutdown.id,
      },
    });

    const res = await remove(shutdown.id);
    expect(res.statusCode, res.body).toBe(204);

    const after = await requestsOf(adminId, shutdown.id);
    expect(after.find((r) => r.id === own.id)!.status).toBe("CANCELLED");
    expect(after.find((r) => r.id === rejected.id)!.status).toBe("REJECTED");
    expect(after.find((r) => r.id === cancelled.id)!.status).toBe("CANCELLED");
    expect(after.find((r) => r.id === rejected.id)!.updatedAt.getTime()).toBe(
      rejected.updatedAt.getTime(),
    );
    expect(await usedDays(adminId, w.year)).toBe(usedBefore);
    const dismissed = await soleNotification(app.prisma, {
      where: { userId: approver.userId, type: "LEAVE_REQUEST", relatedId: own.id },
    });
    expect(dismissed.dismissedAt).not.toBeNull();
  });

  // ── Planner read ──────────────────────────────────────────────────────────────────────────────

  it("the planner shows a booked person's Betriebsurlaub once, as the derived row, and a deleted one not at all", async () => {
    const w = await nextWindow();
    const shutdown = await createShutdown(w.start, w.end);
    const p = await rawPerson("planner", { years: [w.year] });
    await book(shutdown.id, [p.employeeId]);
    const plan = await app.prisma.leavePlan.create({
      data: {
        tenantId,
        salonId: data.salonId,
        year: w.year,
        openedByUserId: data.adminUser.id,
      },
    });

    type Dto = {
      persons: Array<{
        employeeId: string;
        rows: Array<{ kind: string; typeCode: string | null; startDate: string; endDate: string }>;
      }>;
    };
    const read = async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/leave/plans/${plan.id}`,
        headers: authed(),
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as Dto).persons.find((x) => x.employeeId === p.employeeId)!;
    };

    const shown = await read();
    const derived = shown.rows.filter(
      (r) => r.kind === "COMPANY_SHUTDOWN" && r.startDate === w.start && r.endDate === w.end,
    );
    expect(derived).toHaveLength(1);
    expect(
      shown.rows.filter((r) => r.kind === "ABSENCE" && r.typeCode === "COMPANY_SHUTDOWN"),
    ).toHaveLength(0);

    expect((await remove(shutdown.id)).statusCode).toBe(204);
    const afterDelete = await read();
    expect(afterDelete.rows.filter((r) => r.startDate === w.start)).toHaveLength(0);
    expect(shutdown.id).toBeTruthy();
  });
});
