/**
 * Issue #156 - "at most N months in advance" is N calendar months with the day clamped to the end
 * of the target month. `setMonth(getMonth() + 6)` on 31 August produced "31 February" = 3 March,
 * so a request ending on 1-3 March was let through although the limit ends on 28 February.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, reissueTokenNow } from "./setup";

describe("leave max-advance cap on 31 August (Issue #156)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function requestVacationOn(now: string, day: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    try {
      return await app.inject({
        method: "POST",
        url: "/api/v1/leave/requests",
        headers: { authorization: `Bearer ${reissueTokenNow(app, data.empToken)}` },
        payload: { type: "VACATION", startDate: day, endDate: day },
      });
    } finally {
      vi.useRealTimers();
    }
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "lma156");
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { vacationLeadTimeDays: 0, vacationMaxAdvanceMonths: 6 },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } finally {
      await closeTestApp();
    }
  });

  it("refuses Tuesday 2 March 2027 on 31 August 2026 (limit = 28 February), not 3 March", async () => {
    const res = await requestVacationOn("2026-08-31T10:00:00Z", "2027-03-02");
    expect(res.statusCode, res.body).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Monate");
  });

  it("does not refuse Friday 26 February 2027 as too far ahead", async () => {
    const res = await requestVacationOn("2026-08-31T10:00:00Z", "2027-02-26");
    const body = JSON.parse(res.body);
    expect(String(body.error ?? "")).not.toContain("Monate im Voraus");
  });
});
