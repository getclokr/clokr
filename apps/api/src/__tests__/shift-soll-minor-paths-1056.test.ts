/**
 * Issue #1056 — every saldo path gives a minor on a SHIFT_BASED contract the same figures
 * (§ 11 JArbSchG roster break, the age decided per shift date).
 *
 * Fixture (shift-soll-minor-fixture-1056.ts, no September): four shifts 08:00-17:00 on 12.-15.10.2026,
 * worked with the prescribed 60 min break, October still OPEN when read. Clock pinned to
 * 2026-11-10T10:00:00Z (the cron test moves it by hand, see there).
 *
 *   person  October balance  live saldo (h)
 *   M17     0                0
 *   M18     -60              -1
 *   ADULT   -120             -2
 *   NONE    -120             -2
 *
 * Paths: open-month series (computeMonthSaldo), report figures and their bulk twin, the open-month
 * carry-in and its bulk twin, the live Überstundenkonto (breakdown, GET /overtime/:id,
 * updateOvertimeAccount) and the cron close. No response carries a birth date.
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
import { updateOvertimeAccount } from "../contexts/time-tracking/api/time-entries";
import { saldoSnapshotPeriodBounds } from "./test-dates";

const OCT_BALANCE: Record<MinorFixturePerson, number> = {
  M17: 0,
  M18: -60,
  ADULT: -120,
  NONE: -120,
};

describe("Issue #1056 — every saldo path nets a minor's roster with the § 11 break", () => {
  let app: FastifyInstance;
  let fx: MinorShiftFixture;

  beforeAll(async () => {
    app = await getTestApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_NOW));
    fx = await seedMinorShiftFixture(app, "minor-paths-1056");
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (fx) await cleanupTestData(app, fx.tenantId);
  });

  it("open month (computeMonthSaldo): M17 0 / M18 -60 / ADULT -120 / NONE -120, same Soll for all", async () => {
    const expected = new Set<number>();
    for (const key of PERSON_KEYS) {
      const r = await computeMonthSaldo(app, fx.persons[key], 2026, 10);
      expect(r.closed, key).toBe(false);
      expect(r.balanceMinutes, key).toBe(OCT_BALANCE[key]);
      expect(r.workedMinutes, key).toBe(1920);
      expected.add(r.expectedMinutes);
    }
    expect(
      [...expected],
      "every person has the same Soll (the break never moves C_net)",
    ).toHaveLength(1);
  });

  it("report figures: the bulk twin equals the per-person function", async () => {
    const requests = PERSON_KEYS.map((k) => ({ employeeId: fx.persons[k], year: 2026, month: 10 }));
    const bulk = await computeMonthReportFiguresForMany(app, fx.tenantId, requests);
    for (const key of PERSON_KEYS) {
      const single = await computeMonthReportFigures(app, fx.persons[key], 2026, 10);
      expect(bulk.get(monthReportFiguresKey(fx.persons[key], 2026, 10)), key).toEqual(single);
      expect(single.balanceMinutes, key).toBe(OCT_BALANCE[key]);
    }
  });

  it("GET /overtime/month-saldo/:id answers 200 with the same figures and no birth date", async () => {
    for (const key of PERSON_KEYS) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/overtime/month-saldo/${fx.persons[key]}?year=2026&month=10`,
        headers: { authorization: `Bearer ${fx.adminToken}` },
      });
      expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
      expect(res.body, key).not.toContain("birthDate");
      expect(res.body, key).not.toContain("2009-10-14");
      expect(res.body, key).not.toContain("2008-10-14");
    }
  });

  it("live Überstundenkonto: breakdown, GET /overtime/:id and updateOvertimeAccount agree (0 / -1 / -2 / -2 h)", async () => {
    for (const key of PERSON_KEYS) {
      const hours = OCT_BALANCE[key] / 60;
      const breakdown = await computeOvertimeBalanceBreakdown(app, fx.persons[key]);
      expect(breakdown?.totalHours, key).toBeCloseTo(hours, 5);

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/overtime/${fx.persons[key]}`,
        headers: { authorization: `Bearer ${fx.adminToken}` },
      });
      expect(res.statusCode, `${key}: ${res.body}`).toBe(200);
      expect(res.body, key).not.toContain("birthDate");
      expect((JSON.parse(res.body) as { balanceHours: number }).balanceHours, key).toBeCloseTo(
        hours,
        5,
      );

      await updateOvertimeAccount(app, fx.persons[key]);
      const account = await app.prisma.overtimeAccount.findUnique({
        where: { employeeId: fx.persons[key] },
      });
      expect(Number(account!.balanceHours), key).toBeCloseTo(hours, 5);
    }
  });

  it("open-month carry-in for November: single equals bulk (0 / -60 / -120 / -120)", async () => {
    const requests = PERSON_KEYS.map((k) => ({ employeeId: fx.persons[k], year: 2026, month: 11 }));
    const bulk = await openMonthCarryInMinutesForMany(app, fx.tenantId, requests);
    for (const key of PERSON_KEYS) {
      const single = await openMonthCarryInMinutes(app, fx.persons[key], 2026, 11);
      expect(single, key).toBe(OCT_BALANCE[key]);
      expect(bulk.get(openMonthCarryInKey(fx.persons[key], 2026, 11)), key).toBe(single);
    }
  });

  it("cron close: closes October with the open-month figures and carryOver = balance", async () => {
    const open: Record<string, { worked: number; expected: number; balance: number }> = {};
    for (const key of PERSON_KEYS) {
      const r = await computeMonthSaldo(app, fx.persons[key], 2026, 10);
      open[key] = {
        worked: r.workedMinutes,
        expected: r.expectedMinutes,
        balance: r.balanceMinutes,
      };
    }
    // The cron closes the previous month once the retro window of 10 days has passed; the pinned
    // clock (10.11.) is exactly on that day, so no clock change is needed.
    await app.tryAutoCloseMonth();
    const { start } = saldoSnapshotPeriodBounds(new Date("2026-10-01T00:00:00Z"));
    for (const key of PERSON_KEYS) {
      const rows = await app.prisma.saldoSnapshot.findMany({
        where: {
          employeeId: fx.persons[key],
          periodType: "MONTHLY",
          superseded: false,
          periodStart: start,
        },
        orderBy: { id: "asc" },
      });
      expect(rows, `${key}: the cron closed October`).toHaveLength(1);
      const row = rows[0]!;
      expect(row.balanceMinutes, key).toBe(OCT_BALANCE[key]);
      expect(row.balanceMinutes, key).toBe(open[key]!.balance);
      expect(row.workedMinutes, key).toBe(open[key]!.worked);
      expect(row.expectedMinutes, key).toBe(open[key]!.expected);
      expect(row.carryOver, key).toBe(row.balanceMinutes);
    }
  });
});
