/**
 * Issue #1021 — approving a correction proposal (a RetroEntryRequest that is not coupled to any
 * entry) APPLIES the approved times in the approval's own transaction.
 *
 * Before #1021 the approval only flipped the status to APPROVED and waited for a grant redemption
 * (`grantId`) that no client sends, so the approved times never reached the record and the open
 * entry stayed „Ausstempeln fehlt“. The rule lives in `retro-correction-apply.ts`:
 *   - exactly one recorded WORK entry on the day -> corrected, the request ends USED;
 *   - none                                        -> one coupled entry is created, request APPROVED;
 *   - several                                     -> 409 RETRO_APPLY_AMBIGUOUS, request PENDING.
 * Every refusal leaves the request PENDING and writes nothing.
 *
 * Requests and entries are seeded directly with Prisma, never through POST /retro-entry-requests
 * (the #657 request-overlap rule would interfere). One distinct past weekday per case. No person
 * names in fixtures.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  cleanupTestData,
  seedTestData,
  soleAuditRow,
  soleAuditRowOrNull,
  soleNotification,
  auditRowsFor,
} from "./setup";
import { nextWeekdayStr, pastDateStr, saldoSnapshotPeriodBounds, TEST_TZ } from "./test-dates";
import { invalidReasonFields } from "../contexts/time-tracking/invalid-reason";
import { holdEmployeeLockThen } from "./entry-lock-race-helpers";

function at(dayStr: string, hhmm: string): Date {
  return fromZonedTime(`${dayStr}T${hhmm}:00`, TEST_TZ);
}

function detailedText(dayStr: string, from: string, to: string): string {
  const [y, m, d] = dayStr.split("-");
  return `Überschneidung mit bestehendem Eintrag vom ${Number(d)}.${Number(m)}.${y} (${from} – ${to})`;
}

describe("Issue #1021 — an approved correction proposal is applied by its approval", () => {
  let app: FastifyInstance;
  let seed: Awaited<ReturnType<typeof seedTestData>>;
  let tenantId: string;
  let employeeId: string;

  /** A PENDING correction proposal (no coupled entry) for `day`. */
  async function seedProposal(
    day: string,
    over: { startTime?: string | null; endTime?: string | null; breakMinutes?: number | null } = {},
  ) {
    return app.prisma.retroEntryRequest.create({
      data: {
        employeeId,
        targetDate: new Date(`${day}T00:00:00Z`),
        reason: "Correction proposal fixture",
        startTime: over.startTime === undefined ? "08:00" : over.startTime,
        endTime: over.endTime === undefined ? "17:00" : over.endTime,
        breakMinutes: over.breakMinutes === undefined ? 30 : over.breakMinutes,
        status: "PENDING",
      },
    });
  }

  async function seedEntry(
    day: string,
    from: string,
    to: string | null,
    extra: Record<string, unknown> = {},
  ) {
    return app.prisma.timeEntry.create({
      data: {
        employeeId,
        date: new Date(`${day}T00:00:00Z`),
        startTime: at(day, from),
        endTime: to ? at(day, to) : null,
        breakMinutes: 0,
        source: "MANUAL",
        salonId: seed.salonId,
        ...extra,
      },
    });
  }

  const review = (requestId: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "PATCH",
      url: `/api/v1/retro-entry-requests/${requestId}/review`,
      headers: { authorization: `Bearer ${seed.adminToken}` },
      payload: { status: "APPROVED", ...payload },
    });

  const redeemAsGrant = (requestId: string, day: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/time-entries",
      headers: { authorization: `Bearer ${seed.empToken}` },
      payload: {
        employeeId,
        date: day,
        startTime: at(day, "08:00").toISOString(),
        endTime: at(day, "16:00").toISOString(),
        breakMinutes: 0,
        grantId: requestId,
      },
    });

  const requestOf = (id: string) =>
    app.prisma.retroEntryRequest.findUniqueOrThrow({ where: { id } });

  const approvalAudits = (requestId: string) =>
    auditRowsFor(app, "RetroEntryRequest", requestId, "RETRO_ENTRY_APPROVED");

  beforeAll(async () => {
    app = await getTestApp();
    seed = await seedTestData(app, "rap1021");
    tenantId = seed.tenant.id;
    employeeId = seed.employee.id;
  });

  afterAll(async () => {
    try {
      await app.prisma.saldoSnapshot.deleteMany({ where: { employee: { tenantId } } });
      await app.prisma.timeEntry.deleteMany({ where: { employee: { tenantId } } });
      await app.prisma.retroEntryRequest.deleteMany({ where: { employee: { tenantId } } });
      await cleanupTestData(app, tenantId);
    } catch {
      // best-effort cleanup
    }
  });

  it("tracer (the prod case): one open entry with a missing clock-out gets the approved end, the request ends USED and is not redeemable", async () => {
    const day = nextWeekdayStr(pastDateStr(100));
    const entry = await seedEntry(day, "08:00", null, {
      breakMinutes: 30,
      isInvalid: true,
      ...invalidReasonFields("MISSING_CLOCK_OUT"),
    });
    await app.prisma.break.create({
      data: { timeEntryId: entry.id, startTime: at(day, "12:00"), endTime: at(day, "12:30") },
    });
    const request = await seedProposal(day, { breakMinutes: 30 });

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).status).toBe("USED");

    const after = await app.prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { breaks: true },
    });
    expect(after.endTime?.getTime()).toBe(at(day, "17:00").getTime());
    expect(after.startTime.getTime()).toBe(at(day, "08:00").getTime());
    expect(after.isInvalid).toBe(false);
    expect(after.invalidReasonCode).toBeNull();
    expect(after.source).toBe("CORRECTION");
    expect(after.breakMinutes).toBe(30);
    expect(after.breaks).toHaveLength(1); // the placed break row is kept
    expect(after.retroRequestId).toBeNull(); // a corrected entry is never coupled

    const approved = await soleAuditRow(app.prisma, {
      where: { entity: "RetroEntryRequest", entityId: request.id, action: "RETRO_ENTRY_APPROVED" },
    });
    const approvedNew = approved.newValue as Record<string, unknown>;
    expect(approvedNew.status).toBe("APPROVED");
    expect(approvedNew.reason).toBe("Correction proposal fixture");
    const used = await soleAuditRow(app.prisma, {
      where: {
        entity: "RetroEntryRequest",
        entityId: request.id,
        action: "RETRO_ENTRY_APPROVED_USED",
      },
    });
    expect((used.newValue as Record<string, unknown>).timeEntryId).toBe(entry.id);
    const updateAudit = await soleAuditRow(app.prisma, {
      where: { entity: "TimeEntry", entityId: entry.id, action: "UPDATE" },
    });
    expect((updateAudit.oldValue as Record<string, unknown>).endTime).toBeNull();
    expect((updateAudit.newValue as Record<string, unknown>).endTime).not.toBeNull();

    // Never redeemable a second time (four-eyes bypass guard).
    const redeem = await redeemAsGrant(request.id, day);
    expect(redeem.statusCode, redeem.body).toBe(403);
  });

  it("no recorded entry on the day: one entry is created and coupled to the request, which stays APPROVED and is not redeemable", async () => {
    const day = nextWeekdayStr(pastDateStr(130));
    const request = await seedProposal(day, { startTime: "08:00", endTime: "16:00" });

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).status).toBe("APPROVED");

    const entries = await app.prisma.timeEntry.findMany({
      where: { employeeId, date: new Date(`${day}T00:00:00Z`), deletedAt: null },
    });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.retroRequestId).toBe(request.id);
    expect(entry.source).toBe("CORRECTION");
    expect(entry.isInvalid).toBe(false);
    expect(entry.salonId).toBe(seed.salonId);
    expect(entry.startTime.getTime()).toBe(at(day, "08:00").getTime());
    expect(entry.endTime?.getTime()).toBe(at(day, "16:00").getTime());
    expect(entry.breakMinutes).toBe(30);

    const created = await soleAuditRow(app.prisma, {
      where: { entity: "TimeEntry", entityId: entry.id, action: "CREATE" },
    });
    expect((created.newValue as Record<string, unknown>).id).toBe(entry.id);

    const redeem = await redeemAsGrant(request.id, day);
    expect(redeem.statusCode, redeem.body).toBe(403);
  });

  it("several recorded entries: 409 RETRO_APPLY_AMBIGUOUS, the request stays PENDING and nothing changes", async () => {
    const day = nextWeekdayStr(pastDateStr(160));
    const first = await seedEntry(day, "08:00", "12:00");
    const second = await seedEntry(day, "13:00", "17:00");
    const request = await seedProposal(day);

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).code).toBe("RETRO_APPLY_AMBIGUOUS");

    const after = await requestOf(request.id);
    expect(after.status).toBe("PENDING");
    expect(after.reviewedBy).toBeNull();
    for (const [entry, to] of [
      [first, "12:00"],
      [second, "17:00"],
    ] as const) {
      const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.endTime?.getTime()).toBe(at(day, to).getTime());
      expect(row.source).toBe("MANUAL");
    }
    expect(await approvalAudits(request.id)).toHaveLength(0);
  });

  it("closed month: 403 month-locked, the request stays PENDING and the entry is unchanged", async () => {
    const day = nextWeekdayStr(pastDateStr(500));
    const entry = await seedEntry(day, "08:00", null, {
      isInvalid: true,
      ...invalidReasonFields("MISSING_CLOCK_OUT"),
    });
    const request = await seedProposal(day);
    const bounds = saldoSnapshotPeriodBounds(new Date(`${day}T00:00:00Z`));
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId,
        periodType: "MONTHLY",
        periodStart: bounds.start,
        periodEnd: bounds.end,
        workedMinutes: 0,
        expectedMinutes: 0,
        balanceMinutes: 0,
        carryOver: 0,
        closedAt: new Date(),
        superseded: false,
        note: "Issue #1021 month lock fixture",
      },
    });

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/abgeschlossen/);

    expect((await requestOf(request.id)).status).toBe("PENDING");
    const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.endTime).toBeNull();
    expect(row.isInvalid).toBe(true);
    expect(await approvalAudits(request.id)).toHaveLength(0);
  });

  it("overlap with another open request's pending row: 409 with the detailed text, the request stays PENDING", async () => {
    const day = nextWeekdayStr(pastDateStr(190));
    const recorded = await seedEntry(day, "08:00", "12:00");
    const otherRequest = await app.prisma.retroEntryRequest.create({
      data: {
        employeeId,
        targetDate: new Date(`${day}T00:00:00Z`),
        reason: "Other pending Nachtrag fixture",
        startTime: "13:00",
        endTime: "15:00",
        breakMinutes: 0,
        status: "PENDING",
      },
    });
    await seedEntry(day, "13:00", "15:00", {
      isInvalid: true,
      ...invalidReasonFields("RETRO_APPROVAL_PENDING"),
      retroRequestId: otherRequest.id,
    });
    const proposal = await seedProposal(day, { startTime: "08:00", endTime: "16:00" });

    const res = await review(proposal.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).error).toBe(detailedText(day, "13:00", "15:00"));

    expect((await requestOf(proposal.id)).status).toBe("PENDING");
    const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.endTime?.getTime()).toBe(at(day, "12:00").getTime());
    expect(row.source).toBe("MANUAL");
    expect(await approvalAudits(proposal.id)).toHaveLength(0);
    expect(
      await soleAuditRowOrNull(app.prisma, {
        where: { entity: "TimeEntry", entityId: recorded.id, action: "UPDATE" },
      }),
    ).toBeNull();
  });

  it("two concurrent approvals of one request: exactly one 200 and one 409, one entry write, one approval audit", async () => {
    const day = nextWeekdayStr(pastDateStr(220));
    const entry = await seedEntry(day, "08:00", null, {
      isInvalid: true,
      ...invalidReasonFields("MISSING_CLOCK_OUT"),
    });
    const request = await seedProposal(day);

    const results = await Promise.all([review(request.id), review(request.id)]);
    expect(results.map((r) => r.statusCode).sort(), results.map((r) => r.body).join("\n")).toEqual([
      200, 409,
    ]);

    expect(await approvalAudits(request.id)).toHaveLength(1);
    expect(await auditRowsFor(app, "TimeEntry", entry.id, "UPDATE")).toHaveLength(1);
    expect(
      await auditRowsFor(app, "RetroEntryRequest", request.id, "RETRO_ENTRY_APPROVED_USED"),
    ).toHaveLength(1);
    expect((await requestOf(request.id)).status).toBe("USED");
  });

  it("lock race: an overlapping row committed while the approval waits on the employee lock is seen by the re-check", async () => {
    const day = nextWeekdayStr(pastDateStr(250));
    const recorded = await seedEntry(day, "08:00", "12:00");
    const otherRequest = await app.prisma.retroEntryRequest.create({
      data: {
        employeeId,
        targetDate: new Date(`${day}T00:00:00Z`),
        reason: "Other pending Nachtrag fixture (race)",
        startTime: "13:00",
        endTime: "15:00",
        breakMinutes: 0,
        status: "PENDING",
      },
    });
    const proposal = await seedProposal(day, { startTime: "08:00", endTime: "17:00" });

    const { result, blocked } = await holdEmployeeLockThen(app, {
      tenantId,
      employeeId,
      start: () => review(proposal.id),
      holderWork: async (tx) => {
        await tx.timeEntry.create({
          data: {
            employeeId,
            date: new Date(`${day}T00:00:00Z`),
            startTime: at(day, "13:00"),
            endTime: at(day, "15:00"),
            source: "MANUAL",
            salonId: seed.salonId,
            isInvalid: true,
            ...invalidReasonFields("RETRO_APPROVAL_PENDING"),
            retroRequestId: otherRequest.id,
          },
        });
      },
    });

    expect(blocked, "the approval must queue on the employee lock").toBe(true);
    expect(result.statusCode, result.body).toBe(409);
    expect(JSON.parse(result.body).error).toBe(detailedText(day, "13:00", "15:00"));
    expect((await requestOf(proposal.id)).status).toBe("PENDING");
    const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.endTime?.getTime()).toBe(at(day, "12:00").getTime());
    expect(await approvalAudits(proposal.id)).toHaveLength(0);
  });

  it("a manager override sent with the approval is applied and audited as MANAGER_CORRECTION", async () => {
    const day = nextWeekdayStr(pastDateStr(280));
    const entry = await seedEntry(day, "08:00", null, {
      isInvalid: true,
      ...invalidReasonFields("MISSING_CLOCK_OUT"),
    });
    const request = await seedProposal(day, { endTime: "17:00" });

    const res = await review(request.id, { endTime: "16:30" });
    expect(res.statusCode, res.body).toBe(200);

    const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.endTime?.getTime()).toBe(at(day, "16:30").getTime());
    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "TimeEntry", entityId: entry.id, action: "MANAGER_CORRECTION" },
    });
    expect((audit.newValue as Record<string, unknown>).endTime).not.toBeNull();
    expect(await auditRowsFor(app, "TimeEntry", entry.id, "UPDATE")).toHaveLength(0);
  });

  it("break rows outside the approved interval are replaced, breakMinutes follow the approval, the audit keeps the old rows", async () => {
    const day = nextWeekdayStr(pastDateStr(310));
    const entry = await seedEntry(day, "08:00", "12:00", { breakMinutes: 15 });
    await app.prisma.break.create({
      data: { timeEntryId: entry.id, startTime: at(day, "10:00"), endTime: at(day, "10:15") },
    });
    const request = await seedProposal(day, {
      startTime: "11:00",
      endTime: "17:00",
      breakMinutes: 30,
    });

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(200);

    const row = await app.prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { breaks: true },
    });
    expect(row.startTime.getTime()).toBe(at(day, "11:00").getTime());
    expect(row.breaks).toHaveLength(0);
    expect(row.breakMinutes).toBe(30);
    expect(row.breakStatus).toBe("CONFIRMED");
    const audit = await soleAuditRow(app.prisma, {
      where: { entity: "TimeEntry", entityId: entry.id, action: "UPDATE" },
    });
    expect(((audit.oldValue as Record<string, unknown>).breaks as unknown[]).length).toBe(1);
  });

  it("an open entry with a running break: 409 RETRO_APPLY_BREAK_RUNNING, the request stays PENDING", async () => {
    const day = nextWeekdayStr(pastDateStr(340));
    await seedEntry(day, "08:00", null, { breakStartedAt: at(day, "12:00") });
    const request = await seedProposal(day);

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).code).toBe("RETRO_APPLY_BREAK_RUNNING");
    expect((await requestOf(request.id)).status).toBe("PENDING");
    expect(await approvalAudits(request.id)).toHaveLength(0);
  });

  it("a request without times: 409 RETRO_APPLY_NO_TIMES; with times in the approval it is applied", async () => {
    const day = nextWeekdayStr(pastDateStr(370));
    const request = await seedProposal(day, { startTime: null, endTime: null, breakMinutes: null });

    const refused = await review(request.id);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(JSON.parse(refused.body).code).toBe("RETRO_APPLY_NO_TIMES");
    expect((await requestOf(request.id)).status).toBe("PENDING");

    const applied = await review(request.id, { startTime: "08:00", endTime: "16:00" });
    expect(applied.statusCode, applied.body).toBe(200);
    const entries = await app.prisma.timeEntry.findMany({
      where: { employeeId, date: new Date(`${day}T00:00:00Z`), deletedAt: null },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].endTime?.getTime()).toBe(at(day, "16:00").getTime());
  });

  it("a locked entry: 403 locked text, the request stays PENDING", async () => {
    const day = nextWeekdayStr(pastDateStr(400));
    const entry = await seedEntry(day, "08:00", "12:00", { isLocked: true });
    const request = await seedProposal(day);

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(403);
    expect(JSON.parse(res.body).error).toBe(
      "Eintrag ist gesperrt und kann nicht bearbeitet werden",
    );
    expect((await requestOf(request.id)).status).toBe("PENDING");
    const row = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.endTime?.getTime()).toBe(at(day, "12:00").getTime());
  });

  it("approved vacation on the day: 409 with the § 8 BUrlG text, the request stays PENDING", async () => {
    const day = nextWeekdayStr(pastDateStr(430));
    const leave = await app.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: seed.vacationType.id,
        status: "APPROVED",
        startDate: new Date(`${day}T00:00:00Z`),
        endDate: new Date(`${day}T00:00:00Z`),
        days: 1,
      },
    });
    try {
      const request = await seedProposal(day);
      const res = await review(request.id);
      expect(res.statusCode, res.body).toBe(409);
      expect(JSON.parse(res.body).error).toMatch(/^§ 8 BUrlG: /);
      expect((await requestOf(request.id)).status).toBe("PENDING");
      expect(await approvalAudits(request.id)).toHaveLength(0);
    } finally {
      await app.prisma.leaveRequest.delete({ where: { id: leave.id } });
    }
  });

  it("an end more than 30 minutes after now: 400, the request stays PENDING", async () => {
    const day = nextWeekdayStr(pastDateStr(460));
    const request = await seedProposal(day, { startTime: "08:00", endTime: "18:00" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(day, "10:00"));
    try {
      const res = await review(request.id);
      expect(res.statusCode, res.body).toBe(400);
      expect(JSON.parse(res.body).error).toBe("Endzeit darf max. 30 Minuten in der Zukunft liegen");
    } finally {
      vi.useRealTimers();
    }
    expect((await requestOf(request.id)).status).toBe("PENDING");
  });

  it("a created entry gets the automatic break POST would plan when no break was approved", async () => {
    const day = nextWeekdayStr(pastDateStr(70));
    await app.prisma.tenantConfig.update({
      where: { tenantId },
      data: { autoBreakEnabled: true, defaultBreakStart: null },
    });
    try {
      const request = await seedProposal(day, {
        startTime: "08:00",
        endTime: "17:00",
        breakMinutes: 0,
      });
      const res = await review(request.id);
      expect(res.statusCode, res.body).toBe(200);

      const entry = await app.prisma.timeEntry.findFirstOrThrow({
        where: { retroRequestId: request.id },
        include: { breaks: true },
      });
      expect(entry.breaks.length).toBeGreaterThan(0);
      // `isAuto` is omitted from default reads (prisma plugin), so it is selected explicitly.
      const autoFlags = await app.prisma.break.findMany({
        where: { timeEntryId: entry.id },
        select: { isAuto: true },
      });
      expect(autoFlags.length).toBe(entry.breaks.length);
      expect(autoFlags.every((b) => b.isAuto)).toBe(true);
      expect(entry.breakStatus).toBe("AUTO");
      expect(entry.breakMinutes).toBeGreaterThan(0);
      const created = await soleAuditRow(app.prisma, {
        where: { entity: "TimeEntry", entityId: entry.id, action: "CREATE" },
      });
      expect(((created.newValue as Record<string, unknown>).breaks as unknown[]).length).toBe(
        entry.breaks.length,
      );
    } finally {
      await app.prisma.tenantConfig.update({
        where: { tenantId },
        data: { autoBreakEnabled: false },
      });
    }
  });

  it("every applied approval answers warnings and notifies the requester once, linking the entry", async () => {
    const day = nextWeekdayStr(pastDateStr(95));
    const entry = await seedEntry(day, "08:00", null, {
      isInvalid: true,
      ...invalidReasonFields("MISSING_CLOCK_OUT"),
    });
    const request = await seedProposal(day);

    const res = await review(request.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(Array.isArray(JSON.parse(res.body).warnings)).toBe(true);

    const notice = await soleNotification(app.prisma, {
      where: { userId: seed.empUser.id, type: "RETRO_ENTRY_DECIDED", relatedId: entry.id },
    });
    expect(notice.title).toBe("Zeitnachtrag genehmigt");
  });
});
