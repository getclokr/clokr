/**
 * Issue #986 — the Monatsabschluss status never names a day after tenant-local yesterday as a
 * missing record. In the running month the gap check of `findMissingWorkdays()` runs only through
 * yesterday (the window end of `statusEmploymentWindow()`); a month that has ended keeps its full
 * window, so the status still equals what the close writer would demand.
 *
 * Tenant time zone Europe/Berlin, clock faked to Wednesday 2026-11-18T10:00:00Z (only `Date`).
 * One FIXED_SCHEDULE person (Mo–Fr 8 h) with an entry on every workday of November up to and
 * including 17.11. except ONE real gap on Tuesday 10.11.; no entries in October at all.
 * Synthetic fixture, no person names.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, reissueTokenNow } from "./setup";
import { createPopulationPerson, type PopulationPerson } from "./population-fixtures-613";

const FAKE_NOW = new Date("2026-11-18T10:00:00Z");
const GAP = "2026-11-10";

interface StatusRow {
  employeeId: string;
  status: "ready" | "missing" | "closed";
  missingDates?: string[];
  missingDateCount?: number;
}

function workdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

describe("Issue #986 — Monatsabschluss status in the running month", () => {
  let app: FastifyInstance;
  let d: Awaited<ReturnType<typeof seedTestData>>;
  let person: PopulationPerson;

  async function statusRow(year: number, month: number): Promise<StatusRow> {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FAKE_NOW);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/overtime/close-month/status?year=${year}&month=${month}`,
        headers: { authorization: `Bearer ${reissueTokenNow(app, d.adminToken)}` },
      });
      expect(res.statusCode).toBe(200);
      const rows = (JSON.parse(res.body) as { employees: StatusRow[] }).employees;
      const row = rows.find((r) => r.employeeId === person.employeeId);
      expect(row).toBeDefined();
      return row!;
    } finally {
      vi.useRealTimers();
    }
  }

  beforeAll(async () => {
    app = await getTestApp();
    d = await seedTestData(app, "rm986");
    person = await createPopulationPerson(app, {
      tenantId: d.tenant.id,
      salonId: d.salonId,
      tag: "rm",
      hireDate: new Date("2025-01-01T00:00:00.000Z"),
    });
    for (const day of workdaysBetween("2026-11-02", "2026-11-17")) {
      if (day === GAP) continue;
      await app.prisma.timeEntry.create({
        data: {
          employeeId: person.employeeId,
          date: new Date(`${day}T00:00:00Z`),
          // 08:00–16:30 Europe/Berlin (CET, UTC+1)
          startTime: new Date(`${day}T07:00:00Z`),
          endTime: new Date(`${day}T15:30:00Z`),
          breakMinutes: 30,
          breakStatus: "CONFIRMED",
          type: "WORK",
          salonId: d.salonId,
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    try {
      await cleanupTestData(app, d.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("names only the real gap of the running month, never today or a future day", async () => {
    const row = await statusRow(2026, 11);
    expect(row.status).toBe("missing");
    expect(row.missingDates).toEqual([GAP]);
    expect(row.missingDateCount).toBe(1);
    expect((row.missingDates ?? []).every((day) => day < "2026-11-18")).toBe(true);
  });

  it("keeps the full window of a month that has already ended", async () => {
    const row = await statusRow(2026, 10);
    expect(row.status).toBe("missing");
    // October 2026 has no entries at all: every workday through the month's last day is a gap
    // (03.10. is a Saturday, so no statutory holiday falls on a workday).
    expect(row.missingDates).toEqual(workdaysBetween("2026-10-01", "2026-10-31"));
  });
});
