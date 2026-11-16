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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { fromZonedTime } from "date-fns-tz";
import {
  getTestApp,
  cleanupTestData,
  seedTestData,
  soleAuditRow,
  soleAuditRowOrNull,
  auditRowsFor,
} from "./setup";
import { nextWeekdayStr, pastDateStr, saldoSnapshotPeriodBounds, TEST_TZ } from "./test-dates";
import { invalidReasonFields } from "../contexts/time-tracking/invalid-reason";

function at(dayStr: string, hhmm: string): Date {
  return fromZonedTime(`${dayStr}T${hhmm}:00`, TEST_TZ);
}

function detailedText(dayStr: string, from: string, to: string): string {
  const [y, m, d] = dayStr.split("-");
  return `Überschneidung mit bestehendem Eintrag vom ${d}.${m}.${y} (${from} – ${to})`;
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
});
