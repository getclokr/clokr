// Issue #604 (D-05, AC 3, AC 5) — POST /api/v1/appointment-hints/dismissals: „Stimmt so“ hides one
// hint for person, day and kind, is audited in one transaction, and changes nothing else.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  soleAuditRow,
  createAdminApiKey,
} from "../../../../__tests__/setup";
import {
  TEST_TZ,
  pastDateStr,
  saldoSnapshotPeriodBounds,
  utcMidnight,
} from "../../../../__tests__/test-dates";
import { hardDeleteTimeDataForEmployee } from "../../facade/time-entries";

type Fixture = Awaited<ReturnType<typeof seedTestData>>;
interface HintBody {
  enabled: boolean;
  hints: { date: string; kind: string }[];
}

function local(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, TEST_TZ);
}

describe("Issue #604 — POST /api/v1/appointment-hints/dismissals", () => {
  let app: FastifyInstance;
  let data: Fixture;
  const afterDay = pastDateStr(1); // AFTER_CLOCK_OUT day
  const noEntryDay = pastDateStr(2); // NO_ENTRY day

  async function appointment(employeeId: string, day: string, start: string, end: string) {
    await app.prisma.phorestAppointment.create({
      data: {
        employeeId,
        date: utcMidnight(day),
        startTime: start,
        endTime: end,
        salonId: data.salonId,
      },
    });
  }

  async function entry(employeeId: string, day: string, start: string, end: string) {
    await app.prisma.timeEntry.create({
      data: {
        employeeId,
        date: utcMidnight(day),
        startTime: local(day, start),
        endTime: local(day, end),
        type: "WORK",
        source: "MANUAL",
        salonId: data.salonId,
      },
    });
  }

  async function hints(token = data.empToken): Promise<HintBody> {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/appointment-hints",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as HintBody;
  }

  async function dismiss(payload: unknown, token = data.empToken) {
    return app.inject({
      method: "POST",
      url: "/api/v1/appointment-hints/dismissals",
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });
  }

  async function dismissalCount(): Promise<number> {
    return app.prisma.appointmentHintDismissal.count({ where: { tenantId: data.tenant.id } });
  }

  async function auditCount(): Promise<number> {
    return app.prisma.auditLog.count({ where: auditWhere() });
  }

  function auditWhere() {
    return {
      action: "APPOINTMENT_HINT_DISMISSED",
      userId: { in: [data.empUser.id, data.adminUser.id] },
    };
  }

  async function setSwitch(on: boolean) {
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { appointmentTimeHintsEnabled: on, retroEntryWindowDays: 10 },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "dismiss604");
  });

  afterAll(async () => {
    await cleanupTestData(app, data.tenant.id);
    await closeTestApp();
  });

  beforeEach(async () => {
    const ids = [data.employee.id, data.adminEmployee.id];
    await app.prisma.appointmentHintDismissal.deleteMany({ where: { tenantId: data.tenant.id } });
    await app.prisma.auditLog.deleteMany({ where: auditWhere() });
    await app.prisma.phorestAppointment.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.timeEntry.deleteMany({ where: { employeeId: { in: ids } } });
    await app.prisma.saldoSnapshot.deleteMany({ where: { employeeId: { in: ids } } });
    await setSwitch(true);
    await appointment(data.employee.id, afterDay, "10:00", "19:30");
    await entry(data.employee.id, afterDay, "09:00", "18:00");
    await appointment(data.employee.id, noEntryDay, "09:00", "16:00");
  });

  it("stores one dismissal and one audit row, hides exactly that hint and keeps the other", async () => {
    const res = await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      dismissal: { date: string; kind: string; createdAt: string };
    };
    expect(body.dismissal.date).toBe(afterDay);
    expect(body.dismissal.kind).toBe("AFTER_CLOCK_OUT");
    expect(Object.keys(body.dismissal).sort()).toEqual(["createdAt", "date", "kind"]);

    const rows = await app.prisma.appointmentHintDismissal.findMany({
      where: { tenantId: data.tenant.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: data.tenant.id,
      employeeId: data.employee.id,
      kind: "AFTER_CLOCK_OUT",
      dismissedBy: data.empUser.id,
    });

    const audit = await soleAuditRow(app.prisma, {
      where: auditWhere(),
    });
    expect(audit.entity).toBe("AppointmentHintDismissal");
    expect(audit.entityId).toBe(rows[0].id);
    expect(audit.newValue).toEqual({
      employeeId: data.employee.id,
      date: afterDay,
      kind: "AFTER_CLOCK_OUT",
      appointmentsUntil: "19:30",
      clockedOutAt: "18:00",
    });

    expect((await hints()).hints.map((h) => `${h.date}:${h.kind}`)).toEqual([
      `${noEntryDay}:NO_ENTRY`,
    ]);
  });

  it("a second identical POST is 409 NO_APPOINTMENT_HINT with no new row", async () => {
    expect((await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" })).statusCode).toBe(201);
    const again = await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body)).toEqual({
      error: "Für diesen Tag gibt es keinen offenen Hinweis.",
      code: "NO_APPOINTMENT_HINT",
    });
    expect(await dismissalCount()).toBe(1);
    expect(await auditCount()).toBe(1);
  });

  it("refuses everything that is not an open own hint, writing nothing", async () => {
    // a day without a finding
    expect((await dismiss({ date: pastDateStr(4), kind: "NO_ENTRY" })).statusCode).toBe(409);
    // the right day with the other kind
    expect((await dismiss({ date: afterDay, kind: "NO_ENTRY" })).statusCode).toBe(409);
    // a day outside the window (a hint exists there, the window does not reach it)
    await appointment(data.employee.id, pastDateStr(11), "09:00", "16:00");
    expect((await dismiss({ date: pastDateStr(11), kind: "NO_ENTRY" })).statusCode).toBe(409);
    // a day of a closed month
    const { start, end } = saldoSnapshotPeriodBounds(utcMidnight(noEntryDay));
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId: data.employee.id,
        periodType: "MONTHLY",
        periodStart: start,
        periodEnd: end,
        workedMinutes: 0,
        expectedMinutes: 0,
        balanceMinutes: 0,
        carryOver: 0,
        closedAt: new Date(),
      },
    });
    expect((await dismiss({ date: noEntryDay, kind: "NO_ENTRY" })).statusCode).toBe(409);
    await app.prisma.saldoSnapshot.deleteMany({ where: { employeeId: data.employee.id } });
    // the switch off
    await setSwitch(false);
    expect((await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" })).statusCode).toBe(409);
    await setSwitch(true);
    // a caller without an employee link (API key)
    const key = await createAdminApiKey(app.prisma, {
      tenantId: data.tenant.id,
      createdBy: data.adminUser.id,
    });
    const viaKey = await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" }, key.token);
    expect(viaKey.statusCode).toBe(409);
    expect(JSON.parse(viaKey.body).code).toBe("NO_APPOINTMENT_HINT");

    expect(await dismissalCount()).toBe(0);
    expect(await auditCount()).toBe(0);
  });

  it("ignores a posted employeeId: the route acts only on the caller", async () => {
    // the admin person has a qualifying hint day of their own
    await appointment(data.adminEmployee.id, noEntryDay, "09:00", "16:00");
    const res = await dismiss({
      date: noEntryDay,
      kind: "NO_ENTRY",
      employeeId: data.adminEmployee.id,
    });
    // the CALLER's own hint of that day is dismissed, never the other person's
    expect(res.statusCode).toBe(201);
    const rows = await app.prisma.appointmentHintDismissal.findMany({
      where: { tenantId: data.tenant.id },
    });
    expect(rows.map((r) => r.employeeId)).toEqual([data.employee.id]);
    expect((await hints(data.adminToken)).hints.map((h) => h.date)).toEqual([noEntryDay]);
  });

  it("a body naming a foreign person's day is 409 for a caller without that hint", async () => {
    await app.prisma.phorestAppointment.deleteMany({ where: { employeeId: data.employee.id } });
    await appointment(data.adminEmployee.id, noEntryDay, "09:00", "16:00");
    const res = await dismiss({
      date: noEntryDay,
      kind: "NO_ENTRY",
      employeeId: data.adminEmployee.id,
    });
    expect(res.statusCode).toBe(409);
    expect(await dismissalCount()).toBe(0);
    expect((await hints(data.adminToken)).hints.map((h) => h.date)).toEqual([noEntryDay]);
  });

  it("an invalid body is 400", async () => {
    expect((await dismiss({ date: afterDay })).statusCode).toBe(400);
    expect((await dismiss({ date: "2026-13-40", kind: "NO_ENTRY" })).statusCode).toBe(400);
    expect((await dismiss({ date: afterDay, kind: "OTHER" })).statusCode).toBe(400);
  });

  it("changes no time entry, break, overtime row or overtime answer (AC 3)", async () => {
    async function snapshot() {
      const entries = await app.prisma.timeEntry.findMany({
        where: { employeeId: data.employee.id },
        orderBy: { id: "asc" },
        include: { breaks: { orderBy: { id: "asc" } } },
      });
      const overtime = await app.inject({
        method: "GET",
        url: `/api/v1/overtime/${data.employee.id}`,
        headers: { authorization: `Bearer ${data.adminToken}` },
      });
      expect(overtime.statusCode).toBe(200);
      return {
        entries: JSON.parse(JSON.stringify(entries)) as unknown,
        overtime: overtime.body,
        counts: {
          timeEntry: await app.prisma.timeEntry.count({
            where: { employee: { tenantId: data.tenant.id } },
          }),
          breaks: await app.prisma.break.count({
            where: { timeEntry: { employee: { tenantId: data.tenant.id } } },
          }),
          overtimeTx: await app.prisma.overtimeTransaction.count({
            where: { overtimeAccount: { employee: { tenantId: data.tenant.id } } },
          }),
        },
      };
    }

    const before = await snapshot();
    await hints();
    expect(await snapshot()).toEqual(before);
    expect((await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" })).statusCode).toBe(201);
    expect((await dismiss({ date: noEntryDay, kind: "NO_ENTRY" })).statusCode).toBe(201);
    expect(await snapshot()).toEqual(before);
  });

  it("hardDeleteTimeDataForEmployee removes the person's dismissals", async () => {
    expect((await dismiss({ date: afterDay, kind: "AFTER_CLOCK_OUT" })).statusCode).toBe(201);
    expect(await dismissalCount()).toBe(1);
    await app.prisma.$transaction(async (tx) => {
      await hardDeleteTimeDataForEmployee(tx, data.employee.id);
    });
    expect(await dismissalCount()).toBe(0);
  });
});
