/**
 * Issue #1021 — fixture test for audit-1021-approved-unapplied-retro.ts.
 *
 * The script is a read-only survey of approved correction proposals that were never applied. It
 * prints ids, dates and counts only. The worker test database may hold rows left behind by other
 * files, so the assertions look for the fixture's own lines and never for exact totals.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "../../src/__tests__/setup";
import { nextWeekdayStr, pastDateStr } from "../../src/__tests__/test-dates";
import { main, EXIT_OK, EXIT_ERROR, EXIT_FINDINGS } from "../audit-1021-approved-unapplied-retro";

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

describe("audit-1021-approved-unapplied-retro (Issue #1021)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let unappliedId: string;
  let coupledId: string;
  let usedId: string;
  let run: { code: number; lines: string[] };
  let countsBefore: { requests: number; entries: number };

  const counts = async () => ({
    requests: await app.prisma.retroEntryRequest.count({
      where: { employee: { tenantId: data.tenant.id } },
    }),
    entries: await app.prisma.timeEntry.count({
      where: { employee: { tenantId: data.tenant.id } },
    }),
  });

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "audit1021");
    const employeeId = data.employee.id;
    const day = (n: number) => nextWeekdayStr(pastDateStr(n));
    const request = (d: string, status: "APPROVED" | "USED") =>
      app.prisma.retroEntryRequest.create({
        data: {
          employeeId,
          targetDate: new Date(`${d}T00:00:00Z`),
          reason: "Audit fixture reason that must never be printed",
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 0,
          status,
          reviewedAt: new Date(),
        },
      });

    const unapplied = await request(day(120), "APPROVED");
    unappliedId = unapplied.id;
    const coupled = await request(day(150), "APPROVED");
    coupledId = coupled.id;
    await app.prisma.timeEntry.create({
      data: {
        employeeId,
        date: new Date(`${day(150)}T00:00:00Z`),
        startTime: new Date(`${day(150)}T08:00:00Z`),
        endTime: new Date(`${day(150)}T16:00:00Z`),
        source: "CORRECTION",
        salonId: data.salonId,
        retroRequestId: coupled.id,
      },
    });
    usedId = (await request(day(180), "USED")).id;

    countsBefore = await counts();
    run = await capture(() => main([], app.prisma));
  });

  afterAll(async () => {
    try {
      await app.prisma.timeEntry.deleteMany({ where: { employee: { tenantId: data.tenant.id } } });
      await app.prisma.retroEntryRequest.deleteMany({
        where: { employee: { tenantId: data.tenant.id } },
      });
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("audit-1021 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("lists the approved, uncoupled request with its would-be outcome and exits 2", () => {
    expect(run.code).toBe(EXIT_FINDINGS);
    const own = run.lines.filter((l) => l.includes(`requestId=${unappliedId}`));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain(`employeeId=${data.employee.id}`);
    expect(own[0]).toContain(`tenantId=${data.tenant.id}`);
    expect(own[0]).toContain("entriesOnDay=0");
    expect(own[0]).toContain("outcome=CREATE");
  });

  it("does not list a coupled approved request or a USED one, and prints totals", () => {
    const output = run.lines.join("\n");
    expect(output).not.toContain(coupledId);
    expect(output).not.toContain(usedId);
    expect(run.lines.some((l) => /^Totals: rows=\d+$/.test(l))).toBe(true);
    expect(run.lines.some((l) => /^Outcome CREATE: \d+$/.test(l))).toBe(true);
    expect(run.lines.some((l) => /^Month \d{4}-\d{2}: \d+$/.test(l))).toBe(true);
    expect(output).toContain("Nothing was applied");
  });

  it("prints ids, dates and counts only: no name, mail address or reason appears", () => {
    const output = run.lines.join("\n");
    expect(output).not.toContain(data.employee.firstName);
    expect(output).not.toContain(data.employee.lastName);
    expect(output).not.toContain(data.empUser.email);
    expect(output).not.toContain("Audit fixture reason");
    for (const line of run.lines) expect(line).not.toContain("@");
  });

  it("--help exits 0 and an unknown flag is rejected", async () => {
    const help = await capture(() => main(["--help"], app.prisma));
    expect(help.code).toBe(EXIT_OK);
    expect(help.lines.join("\n")).toContain("READ-ONLY");
    await expect(main(["--apply"], app.prisma)).rejects.toThrow();
    await expect(main(["--confirm"], app.prisma)).rejects.toThrow();
  });

  it("without DATABASE_URL and without an injected client it exits 1 and connects to nothing", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main([])).toBe(EXIT_ERROR);
    } finally {
      errSpy.mockRestore();
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it("is read-only: row counts are unchanged by the run and the source has no write call", async () => {
    expect(await counts()).toEqual(countsBefore);
    const request = await app.prisma.retroEntryRequest.findUniqueOrThrow({
      where: { id: unappliedId },
    });
    expect(request.status).toBe("APPROVED");

    const source = readFileSync(
      fileURLToPath(new URL("../audit-1021-approved-unapplied-retro.ts", import.meta.url)),
      "utf8",
    );
    expect(source.length).toBeGreaterThan(1000); // anti-vacuity: the scan read a real file
    expect(source).not.toMatch(
      /\.(update|create|delete|updateMany|deleteMany|upsert|createMany)\(/,
    );
    expect(source).not.toMatch(/\$executeRaw|\$queryRaw/);
  });
});
