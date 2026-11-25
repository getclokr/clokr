/**
 * Issue #1056 (D-02) — a month closed under the adult roster rule stays exactly as stored.
 *
 * Fixture (shift-soll-minor-fixture-1056.ts, `closedSeptember: true`): September 2026 was closed
 * BEFORE the fix with balance -120 for all four persons (the entries locked), October is open. The
 * rule change makes the open October of the minors differ; the closed September must not move.
 *
 * Every reader and trigger that touches the account runs (GET /overtime/:id, computeMonthSaldo,
 * the report figures and their bulk twin, the open-month carry-in and its bulk twin,
 * recalculateSnapshots, updateOvertimeAccount, the cron); afterwards every SaldoSnapshot row captured
 * BEFORE (all columns, keyed by id) deep-equals its state, and no audit row exists for a September
 * snapshot id. A correction of such a month runs only by hand through a Monatskorrektur (#599).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, cleanupTestData } from "./setup";
import {
  seedMinorShiftFixture,
  PERSON_KEYS,
  PINNED_NOW,
  type MinorShiftFixture,
  type MinorFixturePerson,
} from "./shift-soll-minor-fixture-1056";
import {
  computeMonthSaldo,
  computeMonthReportFigures,
  computeMonthReportFiguresForMany,
  monthReportFiguresKey,
} from "../contexts/working-time-account/month-saldo";
import {
  computeOvertimeBalanceBreakdown,
  openMonthCarryInMinutes,
  openMonthCarryInMinutesForMany,
  openMonthCarryInKey,
} from "../contexts/working-time-account/overtime-balance";
import { recalculateSnapshots } from "../contexts/working-time-account/recalculate-snapshots";
import { updateOvertimeAccount } from "../contexts/time-tracking/api/time-entries";

const OCT_BALANCE: Record<MinorFixturePerson, number> = {
  M17: 0,
  M18: -60,
  ADULT: -120,
  NONE: -120,
};
const OCT_CARRY: Record<MinorFixturePerson, number> = {
  M17: -120,
  M18: -180,
  ADULT: -240,
  NONE: -240,
};

describe("Issue #1056 — a closed month is never recomputed or touched", () => {
  let app: FastifyInstance;
  let fx: MinorShiftFixture;
  let ids: string[];

  async function snapshotRows() {
    return app.prisma.saldoSnapshot.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { id: "asc" },
    });
  }

  beforeAll(async () => {
    app = await getTestApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_NOW));
    fx = await seedMinorShiftFixture(app, "minor-closed-1056", { closedSeptember: true });
    ids = PERSON_KEYS.map((k) => fx.persons[k]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (fx) await cleanupTestData(app, fx.tenantId);
  });

  it("every reader and trigger leaves the September snapshots as stored; October follows the new rule", async () => {
    const before = await snapshotRows();
    expect(before).toHaveLength(4);
    for (const row of before) expect(row.balanceMinutes).toBe(-120);
    const septemberIds = before.map((r) => r.id);
    const auditBefore = await app.prisma.auditLog.findMany({
      where: { entityId: { in: septemberIds } },
      orderBy: { id: "asc" },
    });
    expect(auditBefore).toHaveLength(0);

    // ── Readers ──
    for (const key of PERSON_KEYS) {
      const id = fx.persons[key];
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/overtime/${id}`,
        headers: { authorization: `Bearer ${fx.adminToken}` },
      });
      expect(res.statusCode, `GET /overtime/:id ${key}: ${res.body}`).toBe(200);

      const sep = await computeMonthSaldo(app, id, 2026, 9);
      expect(sep.closed, `${key} September is closed`).toBe(true);
      expect(sep.balanceMinutes, `${key} September stays the stored -120`).toBe(-120);
      const oct = await computeMonthSaldo(app, id, 2026, 10);
      expect(oct.closed, `${key} October is open`).toBe(false);
      expect(oct.balanceMinutes, `${key} October`).toBe(OCT_BALANCE[key]);
    }

    const requests = PERSON_KEYS.flatMap((k) => [
      { employeeId: fx.persons[k], year: 2026, month: 9 },
      { employeeId: fx.persons[k], year: 2026, month: 10 },
    ]);
    const bulk = await computeMonthReportFiguresForMany(app, fx.tenantId, requests);
    for (const r of requests) {
      const single = await computeMonthReportFigures(app, r.employeeId, r.year, r.month);
      expect(bulk.get(monthReportFiguresKey(r.employeeId, r.year, r.month))).toEqual(single);
    }

    const carryRequests = PERSON_KEYS.map((k) => ({
      employeeId: fx.persons[k],
      year: 2026,
      month: 11,
    }));
    const carryBulk = await openMonthCarryInMinutesForMany(app, fx.tenantId, carryRequests);
    for (const key of PERSON_KEYS) {
      const single = await openMonthCarryInMinutes(app, fx.persons[key], 2026, 11);
      expect(single, `${key} November carry-in`).toBe(OCT_CARRY[key]);
      expect(carryBulk.get(openMonthCarryInKey(fx.persons[key], 2026, 11))).toBe(single);
    }

    // ── Triggers ──
    for (const key of PERSON_KEYS) {
      const id = fx.persons[key];
      const septemberRow = before.find((r) => r.employeeId === id)!;
      const result = await recalculateSnapshots(app, id, new Date("2026-09-01T00:00:00Z"));
      expect(
        result.lockedMonthsSkipped.map((m) => m.snapshotId),
        `${key}: recalc reports September as locked and skips it`,
      ).toContain(septemberRow.id);
      await updateOvertimeAccount(app, id);
    }

    // The live saldo of a minor keeps the stored September minus: -2.0 h, not a recomputed 0.
    const liveM17 = await computeOvertimeBalanceBreakdown(app, fx.persons.M17);
    expect(liveM17?.totalHours).toBeCloseTo(-2, 5);
    const accountM17 = await app.prisma.overtimeAccount.findUnique({
      where: { employeeId: fx.persons.M17 },
    });
    expect(Number(accountM17!.balanceHours)).toBeCloseTo(-2, 5);

    await app.tryAutoCloseMonth();

    // ── Full-row comparison ──
    const after = await snapshotRows();
    const afterById = new Map(after.map((r) => [r.id, r]));
    for (const row of before) {
      expect(afterById.get(row.id), `snapshot ${row.id} is untouched, column by column`).toEqual(
        row,
      );
    }
    const auditAfter = await app.prisma.auditLog.findMany({
      where: { entityId: { in: septemberIds } },
      orderBy: { id: "asc" },
    });
    expect(auditAfter, "no audit row for a September snapshot").toHaveLength(0);

    // The October rows the cron wrote follow the new rule.
    // `periodStart` is a @db.Date: the new rows are told apart from September by id.
    for (const key of PERSON_KEYS) {
      const rows = after.filter(
        (r) => r.employeeId === fx.persons[key] && !r.superseded && !septemberIds.includes(r.id),
      );
      expect(rows, `${key} October row`).toHaveLength(1);
      expect(rows[0]!.balanceMinutes, key).toBe(OCT_BALANCE[key]);
      expect(rows[0]!.carryOver, key).toBe(OCT_CARRY[key]);
    }
  });
});
