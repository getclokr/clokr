/**
 * Issue #1036 - fixture test for migrate-1036-pending-leave-to-plan.ts.
 *
 * The script moves PENDING VACATION requests into the OPEN leave plan of their year: per request,
 * in ONE transaction, the request is withdrawn (PENDING -> CANCELLED) and a wish with the same days
 * and half-day flag is written through the wish core; a refused wish rolls everything back.
 *
 * Every date is fixed (plan year 2027); the script never reads the current day except as the
 * `now` of the wish core, and the actor is the plan opener (a MANAGER), so no deadline applies.
 *
 *   A  homed in S, two PENDING VACATION requests (full range, single half day)  -> moved
 *   B  homed in S, PENDING VACATION + an unlinked active wish inside it          -> refused, rolled back
 *   C  homed in S, PENDING OVERTIME_COMP                                         -> never listed
 *   D  homed in S, APPROVED VACATION                                             -> never listed
 *   E  homed in S2 (no plan), PENDING VACATION                                   -> NO_PLAN
 *   F  homed in S, PENDING VACATION across the turn of the year                  -> SPANS_YEARS
 *   G  homed in S, PENDING VACATION in 2028 (no OPEN 2028 plan)                  -> never listed
 *   I  homed in S, PENDING VACATION already linked to a wish                     -> LINKED_TO_WISH
 *   H  decided (APPROVED) between listing and moving                             -> NOT_PENDING
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  seedTestData,
  cleanupTestData,
  seedEntitlementYears,
  createTestSalon,
  auditRowsFor,
  soleAuditRow,
} from "../../src/__tests__/setup";
import { leaveTypeFields } from "../../src/contexts/absence/leave-type";
import {
  main,
  collectCandidates,
  moveCandidate,
  EXIT_OK,
  EXIT_ERROR,
  MIGRATION_MARKER,
} from "../migrate-1036-pending-leave-to-plan";

async function capture(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const code = await fn();
    return { code, lines };
  } finally {
    spy.mockRestore();
    errSpy.mockRestore();
  }
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const YEAR = 2027;

describe("migrate-1036-pending-leave-to-plan (Issue #1036)", () => {
  let app: FastifyInstance;
  let fixture: Awaited<ReturnType<typeof seedTestData>>;
  let planId: string;
  const names: string[] = [];
  const ids = { a1: "", a2: "", b: "", c: "", d: "", e: "", f: "", g: "", i: "", h: "" };
  let personA = "";
  let personB = "";
  let bWish = "";
  let iWish = "";
  let dry: { code: number; lines: string[] };
  let confirm: { code: number; lines: string[] };
  let again: { code: number; lines: string[] };
  let fingerprint: { before: string; after: string };
  let againFingerprint: { before: string; after: string };
  let untouchedBefore = "";
  let hOutcome = "";
  let hWishes = -1;
  let hAudits = -1;
  let noticeAfterDry: Date | null;
  const noticeIds = { a1: "", unrelated: "" };

  /** A person homed in `salonId` from 2024-01-01 with recognisable names for the PII check. */
  async function person(label: string, salonId: string): Promise<string> {
    const s = `${label}${Math.random().toString(36).slice(2, 8)}`;
    const firstName = `Mig1036First${s}`;
    const lastName = `Mig1036Last${s}`;
    names.push(firstName, lastName);
    const user = await app.prisma.user.create({
      data: {
        email: `${s}@example.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: fixture.tenant.id,
        userId: user.id,
        employeeNumber: `M${randomUUID().slice(0, 8)}`,
        firstName,
        lastName,
        hireDate: day("2024-01-01"),
      },
    });
    await app.prisma.employeeSalonAssignment.create({
      data: {
        tenantId: fixture.tenant.id,
        employeeId: employee.id,
        salonId,
        kind: "HOME",
        validFrom: day("2024-01-01"),
        validUntil: null,
        weekdays: [],
      },
    });
    await seedEntitlementYears(app, {
      employeeId: employee.id,
      leaveTypeId: fixture.vacationType.id,
      years: [YEAR],
    });
    return employee.id;
  }

  async function request(
    employeeId: string,
    startDay: string,
    endDay: string,
    opts: { halfDay?: boolean; status?: "PENDING" | "APPROVED"; leaveTypeId?: string } = {},
  ): Promise<string> {
    const row = await app.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: opts.leaveTypeId ?? fixture.vacationType.id,
        startDate: day(startDay),
        endDate: day(endDay),
        days: opts.halfDay ? 0.5 : 1,
        halfDay: opts.halfDay ?? false,
        status: opts.status ?? "PENDING",
      },
    });
    return row.id;
  }

  /** Status and audit rows of every request the run must leave alone (B refused, C, D, E, F, G, I). */
  async function untouchedState(): Promise<string> {
    const keep = [ids.b, ids.c, ids.d, ids.e, ids.f, ids.g, ids.i];
    const rows = await app.prisma.leaveRequest.findMany({
      where: { id: { in: keep } },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    const audits = await app.prisma.auditLog.count({
      where: { entity: "LeaveRequest", entityId: { in: keep } },
    });
    return JSON.stringify({ rows, audits });
  }

  /** Requests (id, status, updatedAt), the tenant's wishes and the audit rows of both entities. */
  async function fingerprintOf(): Promise<string> {
    const requests = await app.prisma.leaveRequest.findMany({
      where: { employee: { tenantId: fixture.tenant.id } },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    const wishes = await app.prisma.leavePlanWish.findMany({
      where: { tenantId: fixture.tenant.id },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const requestAudits = await app.prisma.auditLog.count({
      where: { entity: "LeaveRequest", entityId: { in: requests.map((r) => r.id) } },
    });
    const wishAudits = await app.prisma.auditLog.count({
      where: { entity: "LeavePlanWish", newValue: { path: ["planId"], equals: planId } },
    });
    return JSON.stringify({ requests, wishes, requestAudits, wishAudits });
  }

  beforeAll(async () => {
    app = await getTestApp();
    fixture = await seedTestData(app, "mig1036");
    planId = (
      await app.prisma.leavePlan.create({
        data: {
          tenantId: fixture.tenant.id,
          salonId: fixture.salonId,
          year: YEAR,
          openedByUserId: fixture.adminUser.id,
        },
      })
    ).id;

    const salon2 = await createTestSalon(app.prisma, fixture.tenant.id, { name: "Salon Zwei" });
    const overtimeComp = await app.prisma.leaveType.create({
      data: {
        tenantId: fixture.tenant.id,
        ...leaveTypeFields("OVERTIME_COMP"),
        color: "#8B5CF6",
      },
    });

    personA = await person("A", fixture.salonId);
    ids.a1 = await request(personA, "2027-03-01", "2027-03-05");
    ids.a2 = await request(personA, "2027-05-14", "2027-05-14", { halfDay: true });

    personB = await person("B", fixture.salonId);
    ids.b = await request(personB, "2027-04-12", "2027-04-16");
    bWish = (
      await app.prisma.leavePlanWish.create({
        data: {
          tenantId: fixture.tenant.id,
          planId,
          employeeId: personB,
          startDate: day("2027-04-14"),
          endDate: day("2027-04-14"),
          createdByUserId: fixture.adminUser.id,
        },
      })
    ).id;

    ids.c = await request(await person("C", fixture.salonId), "2027-06-07", "2027-06-07", {
      leaveTypeId: overtimeComp.id,
    });
    ids.d = await request(await person("D", fixture.salonId), "2027-07-05", "2027-07-09", {
      status: "APPROVED",
    });
    ids.e = await request(await person("E", salon2.id), "2027-08-02", "2027-08-06");
    ids.f = await request(await person("F", fixture.salonId), "2026-12-28", "2027-01-04");
    ids.g = await request(await person("G", fixture.salonId), "2028-02-07", "2028-02-11");
    const personI = await person("I", fixture.salonId);
    ids.i = await request(personI, "2027-09-06", "2027-09-10");
    iWish = (
      await app.prisma.leavePlanWish.create({
        data: {
          tenantId: fixture.tenant.id,
          planId,
          employeeId: personI,
          startDate: day("2027-09-06"),
          endDate: day("2027-09-10"),
          createdByUserId: fixture.adminUser.id,
          leaveRequestId: ids.i,
          takenOverAt: new Date(),
        },
      })
    ).id;

    // The approvers' open notice of request a1, plus one of another type that must stay open.
    noticeIds.a1 = (
      await app.prisma.notification.create({
        data: {
          userId: fixture.adminUser.id,
          type: "LEAVE_REQUEST",
          title: "Neuer Antrag",
          message: "Antrag",
          relatedType: "LeaveRequest",
          relatedId: ids.a1,
        },
      })
    ).id;
    noticeIds.unrelated = (
      await app.prisma.notification.create({
        data: {
          userId: fixture.adminUser.id,
          type: "LEAVE_REQUEST",
          title: "Anderer Antrag",
          message: "Antrag",
          relatedType: "LeaveRequest",
          relatedId: randomUUID(),
        },
      })
    ).id;

    const before = await fingerprintOf();
    dry = await capture(() => main(["--tenant", fixture.tenant.id], app));
    fingerprint = { before, after: await fingerprintOf() };
    noticeAfterDry = (
      await app.prisma.notification.findUniqueOrThrow({ where: { id: noticeIds.a1 } })
    ).dismissedAt;

    untouchedBefore = await untouchedState();
    confirm = await capture(() => main(["--tenant", fixture.tenant.id, "--confirm"], app));

    const againBefore = await fingerprintOf();
    again = await capture(() => main(["--tenant", fixture.tenant.id, "--confirm"], app));
    againFingerprint = { before: againBefore, after: await fingerprintOf() };

    // Race guard: H is listed as PENDING, then decided before it is moved.
    const personH = await person("H", fixture.salonId);
    ids.h = await request(personH, "2027-10-04", "2027-10-08");
    const hCandidate = (await collectCandidates(app, { tenantId: fixture.tenant.id })).find(
      (c) => c.requestId === ids.h,
    );
    if (!hCandidate) throw new Error("H must be a candidate");
    await app.prisma.leaveRequest.update({ where: { id: ids.h }, data: { status: "APPROVED" } });
    hOutcome = (await moveCandidate(app, hCandidate, { confirm: true, now: new Date() })).outcome;
    hWishes = await app.prisma.leavePlanWish.count({ where: { employeeId: personH } });
    hAudits = (await auditRowsFor(app, "LeaveRequest", ids.h)).length;
  });

  afterAll(async () => {
    if (!fixture) return;
    try {
      await cleanupTestData(app, fixture.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
  });

  const lineOf = (run: { lines: string[] }, requestId: string) =>
    run.lines.find((l) => l.includes(`request=${requestId} `));

  describe("dry run", () => {
    it("lists every candidate as WOULD_MOVE and writes nothing", () => {
      expect(dry.code).toBe(EXIT_ERROR); // B is refused
      for (const id of [ids.a1, ids.a2]) {
        expect(lineOf(dry, id)).toContain("result=WOULD_MOVE");
        expect(lineOf(dry, id)).toContain("type=VACATION");
      }
      expect(lineOf(dry, ids.a2)).toContain("halfDay=true");
      expect(dry.lines.at(-1)).toBe("Dry run: this run wrote nothing.");
      expect(fingerprint.after).toBe(fingerprint.before);
      expect(noticeAfterDry).toBeNull();
    });
  });

  describe("--confirm", () => {
    it("moves both requests: CANCELLED, one wish each with the same days and half-day flag", async () => {
      expect(confirm.code).toBe(EXIT_ERROR); // B is refused, the others are still moved
      const wishes = await app.prisma.leavePlanWish.findMany({
        where: { tenantId: fixture.tenant.id, employeeId: personA },
        orderBy: { startDate: "asc" },
      });
      expect(wishes).toHaveLength(2);
      const [w1, w2] = wishes;
      expect(w1.planId).toBe(planId);
      expect(w1.startDate.toISOString().slice(0, 10)).toBe("2027-03-01");
      expect(w1.endDate.toISOString().slice(0, 10)).toBe("2027-03-05");
      expect(w1.halfDay).toBe(false);
      expect(w2.startDate.toISOString().slice(0, 10)).toBe("2027-05-14");
      expect(w2.endDate.toISOString().slice(0, 10)).toBe("2027-05-14");
      expect(w2.halfDay).toBe(true);
      for (const w of wishes) {
        expect(w.createdByUserId).toBe(fixture.adminUser.id);
        expect(w.leaveRequestId).toBeNull();
        expect(w.deletedAt).toBeNull();
      }
      for (const [requestId, wish] of [
        [ids.a1, w1],
        [ids.a2, w2],
      ] as const) {
        const row = await app.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
        expect(row.status).toBe("CANCELLED");
        expect(lineOf(confirm, requestId)).toContain(`wish=${wish.id}`);
        expect(lineOf(confirm, requestId)).toContain("result=MOVED");
      }
      expect(confirm.lines.at(-1)).toBe("Written (--confirm).");
    });

    it("writes one UPDATE LeaveRequest audit row per request, carrying the marker", async () => {
      const wishes = await app.prisma.leavePlanWish.findMany({
        where: { tenantId: fixture.tenant.id, employeeId: personA },
        orderBy: { startDate: "asc" },
      });
      for (const [requestId, wish] of [
        [ids.a1, wishes[0]],
        [ids.a2, wishes[1]],
      ] as const) {
        const row = await soleAuditRow(app.prisma, {
          where: { entity: "LeaveRequest", entityId: requestId, action: "UPDATE" },
        });
        expect(row.userId).toBeNull();
        expect(row.oldValue).toEqual({ status: "PENDING" });
        expect(row.newValue).toMatchObject({
          status: "CANCELLED",
          auditReason: MIGRATION_MARKER.auditReason,
          trigger: MIGRATION_MARKER.trigger,
          leavePlanWishId: wish.id,
          leavePlanId: planId,
        });
        expect(await auditRowsFor(app, "LeaveRequest", requestId)).toHaveLength(1);
      }
    });

    it("writes one CREATE LeavePlanWish audit row per wish by the plan opener, same marker", async () => {
      const wishes = await app.prisma.leavePlanWish.findMany({
        where: { tenantId: fixture.tenant.id, employeeId: personA },
        orderBy: { startDate: "asc" },
      });
      for (const wish of wishes) {
        const row = await soleAuditRow(app.prisma, {
          where: { entity: "LeavePlanWish", entityId: wish.id, action: "CREATE" },
        });
        expect(row.userId).toBe(fixture.adminUser.id);
        expect(row.newValue).toMatchObject({
          planId,
          employeeId: personA,
          startDate: wish.startDate.toISOString().slice(0, 10),
          endDate: wish.endDate.toISOString().slice(0, 10),
          halfDay: wish.halfDay,
          auditReason: MIGRATION_MARKER.auditReason,
          trigger: MIGRATION_MARKER.trigger,
        });
      }
    });

    it("dismisses the approvers' open notice of a moved request and nothing else (orchestrator decision)", async () => {
      const moved = await app.prisma.notification.findUniqueOrThrow({
        where: { id: noticeIds.a1 },
      });
      expect(moved.dismissedAt).not.toBeNull();
      const other = await app.prisma.notification.findUniqueOrThrow({
        where: { id: noticeIds.unrelated },
      });
      expect(other.dismissedAt).toBeNull();
    });

    it("prints ids, days and codes only - no name", () => {
      const text = [...dry.lines, ...confirm.lines, ...again.lines].join("\n");
      for (const name of names) expect(name.length).toBeGreaterThan(0);
      for (const name of names) expect(text).not.toContain(name);
    });
  });

  describe("every other outcome", () => {
    it("B: the wish core refuses, the whole transaction rolls back (dry run and confirm)", async () => {
      for (const run of [dry, confirm]) {
        expect(lineOf(run, ids.b)).toContain("result=LEAVE_PLAN_WISH_OVERLAP");
      }
      const request = await app.prisma.leaveRequest.findUniqueOrThrow({ where: { id: ids.b } });
      expect(request.status).toBe("PENDING");
      const wishes = await app.prisma.leavePlanWish.findMany({ where: { employeeId: personB } });
      expect(wishes.map((w) => w.id)).toEqual([bWish]);
      expect(await auditRowsFor(app, "LeaveRequest", ids.b)).toHaveLength(0);
    });

    it("C and D (other type, other status) and G (no OPEN plan of its year) are never listed", () => {
      for (const id of [ids.c, ids.d, ids.g]) {
        expect(lineOf(dry, id)).toBeUndefined();
        expect(lineOf(confirm, id)).toBeUndefined();
      }
    });

    it("E, F and I are skipped with their reason and left alone", () => {
      expect(lineOf(confirm, ids.e)).toContain("plan=none");
      expect(lineOf(confirm, ids.e)).toContain("result=NO_PLAN");
      expect(lineOf(confirm, ids.f)).toContain("result=SPANS_YEARS");
      expect(lineOf(confirm, ids.i)).toContain("result=LINKED_TO_WISH");
      expect(lineOf(confirm, ids.i)).toContain(`wish=${iWish}`);
    });

    it("nothing the run must leave alone changed (statuses, audit rows)", async () => {
      expect(await untouchedState()).toBe(untouchedBefore);
      const c = await app.prisma.leaveRequest.findUniqueOrThrow({ where: { id: ids.c } });
      const d = await app.prisma.leaveRequest.findUniqueOrThrow({ where: { id: ids.d } });
      expect([c.status, d.status]).toEqual(["PENDING", "APPROVED"]);
    });

    it("totals match the listed outcomes", () => {
      const totals = confirm.lines.find((l) => l.startsWith("Totals:"));
      expect(totals).toBe(
        "Totals: candidates=6 moved=2 wouldMove=0 refused=1 noPlan=1 spansYears=1 notPending=0 linkedToWish=1",
      );
      expect(dry.lines.find((l) => l.startsWith("Totals:"))).toBe(
        "Totals: candidates=6 moved=0 wouldMove=2 refused=1 noPlan=1 spansYears=1 notPending=0 linkedToWish=1",
      );
    });
  });

  describe("idempotency and the race guard", () => {
    it("a second --confirm moves nothing again and writes nothing new", () => {
      expect(again.lines.some((l) => /result=(MOVED|WOULD_MOVE)/.test(l))).toBe(false);
      expect(lineOf(again, ids.a1)).toBeUndefined();
      expect(lineOf(again, ids.a2)).toBeUndefined();
      expect(againFingerprint.after).toBe(againFingerprint.before);
    });

    it("H: a request decided between listing and moving is NOT_PENDING and untouched", () => {
      expect(hOutcome).toBe("NOT_PENDING");
      expect(hWishes).toBe(0);
      expect(hAudits).toBe(0);
    });
  });

  describe("CLI", () => {
    it("--year 2026 lists nothing and succeeds", async () => {
      const run = await capture(() => main(["--tenant", fixture.tenant.id, "--year", "2026"], app));
      expect(run.code).toBe(EXIT_OK);
      expect(run.lines.some((l) => l.includes("request="))).toBe(false);
    });

    it("--help succeeds, an unknown flag and a malformed --year fail", async () => {
      expect((await capture(() => main(["--help"], app))).code).toBe(EXIT_OK);
      expect((await capture(() => main(["--bogus"], app))).code).toBe(EXIT_ERROR);
      expect((await capture(() => main(["--year", "27"], app))).code).toBe(EXIT_ERROR);
    });
  });
});
