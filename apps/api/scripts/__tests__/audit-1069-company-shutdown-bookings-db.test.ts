/**
 * Issue #1069 (O-7) — the read-only Bestand list against the worker test database: it lists the
 * fixture's own lines (MISSING, BOOKED, EXCEPTED), exits 2 while a MISSING line exists, prints ids,
 * dates and codes only and writes nothing. Assertions look for the fixture's own lines, never for
 * exact totals (the worker database may hold rows of other files).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "../../src/__tests__/setup";
import { getTenantTimezone, todayInTz } from "../../src/contexts/working-time-account";
import { main, EXIT_OK, EXIT_FINDINGS } from "../audit-1069-company-shutdown-bookings";

const DAY_MS = 24 * 60 * 60 * 1000;

async function capture(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    const code = await fn();
    return { code, lines };
  } finally {
    spy.mockRestore();
  }
}

describe("audit-1069-company-shutdown-bookings (Issue #1069)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let shutdownId: string;
  let day1: string;
  let day2: string;

  const run = (extra: string[] = []) =>
    capture(() =>
      main(
        ["--tenant", data.tenant.id, ...extra],
        app.prisma as unknown as Parameters<typeof main>[1],
      ),
    );
  const lineOf = (lines: string[], employeeId: string) =>
    lines.filter((l) => l.includes(`employeeId=${employeeId} `));

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "audit1069");
    const tz = await getTenantTimezone(app.prisma, data.tenant.id);
    // Two consecutive days inside one future month (a Betriebsurlaub over a month end would give
    // two lines per person; one month keeps the assertions plain).
    let start = new Date(todayInTz(tz).getTime() + 30 * DAY_MS);
    while (start.getUTCDate() > 25) start = new Date(start.getTime() + DAY_MS);
    day1 = start.toISOString().slice(0, 10);
    day2 = new Date(start.getTime() + DAY_MS).toISOString().slice(0, 10);
    const shutdown = await app.prisma.companyShutdown.create({
      data: {
        tenantId: data.tenant.id,
        name: "Betriebsurlaub 1069 Audit",
        startDate: new Date(day1),
        endDate: new Date(day2),
        deductsFromVacation: true,
      },
    });
    shutdownId = shutdown.id;
    await app.prisma.companyShutdownException.create({
      data: { shutdownId, employeeId: data.adminEmployee.id, reason: null },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("audit-1069 db test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("an affected person nobody booked is MISSING (exit 2); an excepted person is EXCEPTED, never MISSING", async () => {
    const { code, lines } = await run();
    expect(code).toBe(EXIT_FINDINGS);
    const person = lineOf(lines, data.employee.id);
    expect(person).toHaveLength(1);
    expect(person[0]).toContain(`shutdownId=${shutdownId}`);
    expect(person[0]).toContain(`month=${day1.slice(0, 7)}`);
    expect(person[0]).toContain("state=MISSING");
    const excepted = lineOf(lines, data.adminEmployee.id);
    expect(excepted).toHaveLength(1);
    expect(excepted[0]).toContain("state=EXCEPTED");
  });

  it("an active COMPANY_SHUTDOWN absence of the shutdown makes the month BOOKED (exit 0); the output carries ids, dates and codes only; nothing is written", async () => {
    await app.prisma.absence.create({
      data: {
        employeeId: data.employee.id,
        type: "COMPANY_SHUTDOWN",
        startDate: new Date(day1),
        endDate: new Date(day2),
        days: 2,
        halfDay: false,
        source: "MANUAL",
        companyShutdownId: shutdownId,
        createdBy: data.adminUser.id,
      },
    });
    const before = await app.prisma.absence.count({ where: { employeeId: data.employee.id } });
    const { code, lines } = await run();
    expect(code).toBe(EXIT_OK);
    const person = lineOf(lines, data.employee.id);
    expect(person).toHaveLength(1);
    expect(person[0]).toContain("state=BOOKED");
    // Ids, dates and codes only: no name, no mail address, no employee number.
    const text = lines.join("\n");
    expect(text).not.toContain("@");
    expect(text).not.toContain(data.employee.employeeNumber);
    expect(text).toContain("This script writes nothing.");
    expect(await app.prisma.absence.count({ where: { employeeId: data.employee.id } })).toBe(
      before,
    );
  });

  it("rejects a write flag before touching the database", async () => {
    await expect(run(["--confirm"])).rejects.toThrow();
  });
});
