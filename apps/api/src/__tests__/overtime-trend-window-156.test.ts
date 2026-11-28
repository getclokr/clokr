/**
 * Issue #156 - GET /dashboard/overtime-trend promises a six-month window (current month plus the
 * five before it). Built with `setUTCMonth(getUTCMonth() - 5)` it started one month late on the
 * 29th-31st of a month whose month five back is shorter (31 July -> "31 February" -> March), so the
 * oldest month silently dropped out.
 *
 * Legacy monthly snapshots (stored on the 1st) are seeded for January..July 2026 (August is added by the one test that needs it - the read has no upper bound); the clock is
 * pinned (Date only) and the answer must be exactly the six months ending in the pinned month.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, reissueTokenNow } from "./setup";
import { legacySaldoSnapshotPeriodBounds } from "./test-dates";

describe("overtime-trend six-month window on the 29th-31st (Issue #156)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function trendMonthsAt(now: string): Promise<string[]> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/overtime-trend",
        headers: { authorization: `Bearer ${reissueTokenNow(app, data.adminToken)}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body).snapshots as Array<{ month: string }>).map((s) => s.month);
    } finally {
      vi.useRealTimers();
    }
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "otw156");
    await app.prisma.employee.update({
      where: { id: data.adminEmployee.id },
      data: { hireDate: new Date("2025-01-01T00:00:00.000Z") },
    });
    for (let month = 1; month <= 7; month++) {
      const bounds = legacySaldoSnapshotPeriodBounds(2026, month);
      await app.prisma.saldoSnapshot.create({
        data: {
          employeeId: data.adminEmployee.id,
          periodType: "MONTHLY",
          periodStart: bounds.start,
          periodEnd: bounds.end,
          workedMinutes: 9600,
          expectedMinutes: 9600,
          balanceMinutes: 0,
          carryOver: month * 10,
          closedAt: new Date("2026-09-02T06:00:00Z"),
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } finally {
      await closeTestApp();
    }
  });

  const FEB_TO_JUL = [
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
    "2026-07-01",
  ];

  it("31 July: February..July, six months (was March..July)", async () => {
    expect(await trendMonthsAt("2026-07-31T10:00:00Z")).toEqual(FEB_TO_JUL);
  });

  it("30 July: February..July", async () => {
    expect(await trendMonthsAt("2026-07-30T10:00:00Z")).toEqual(FEB_TO_JUL);
  });

  it("15 July (control, never overflowed): February..July", async () => {
    expect(await trendMonthsAt("2026-07-15T10:00:00Z")).toEqual(FEB_TO_JUL);
  });

  it("31 August: March..August (31 March exists - no overflow, stays six months)", async () => {
    const bounds = legacySaldoSnapshotPeriodBounds(2026, 8);
    await app.prisma.saldoSnapshot.create({
      data: {
        employeeId: data.adminEmployee.id,
        periodType: "MONTHLY",
        periodStart: bounds.start,
        periodEnd: bounds.end,
        workedMinutes: 9600,
        expectedMinutes: 9600,
        balanceMinutes: 0,
        carryOver: 80,
        closedAt: new Date("2026-09-02T06:00:00Z"),
      },
    });
    expect(await trendMonthsAt("2026-08-31T10:00:00Z")).toEqual(
      FEB_TO_JUL.slice(1).concat("2026-08-01"),
    );
  });
});
