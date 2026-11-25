/**
 * Issue #1085 — fixture test for audit-1085-open-entries-outside-window.ts.
 *
 * The script is a read-only survey of open time entries (no end) that lie before their tenant's
 * retro window. It prints ids, dates and counts only. The worker test database may hold rows left
 * behind by other files, so the assertions look for the fixture's own lines and never for exact
 * totals.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "../../src/__tests__/setup";
import { nextWeekdayStr, pastDateStr } from "../../src/__tests__/test-dates";
import { invalidReasonFields } from "../../src/contexts/time-tracking/invalid-reason";
import {
  main,
  parseCli,
  EXIT_OK,
  EXIT_ERROR,
  EXIT_FINDINGS,
} from "../audit-1085-open-entries-outside-window";

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

describe("audit-1085-open-entries-outside-window (Issue #1085)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let oldOpenId: string;
  let oldOpenLockedId: string;
  let insideWindowId: string;
  let oldClosedId: string;
  let oldDeletedId: string;
  let oldPendingRetroId: string;
  let oldOpenDay: string;
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
    data = await seedTestData(app, "audit1085");
    const employeeId = data.employee.id;
    const day = (n: number) => nextWeekdayStr(pastDateStr(n));
    const entry = (
      d: string,
      end: string | null,
      extra: Record<string, unknown> = {},
    ): Promise<{ id: string }> =>
      app.prisma.timeEntry.create({
        data: {
          employeeId,
          date: new Date(`${d}T00:00:00Z`),
          startTime: new Date(`${d}T07:30:00Z`),
          endTime: end ? new Date(`${d}T${end}:00Z`) : null,
          breakMinutes: 0,
          source: "MANUAL",
          salonId: data.salonId,
          ...extra,
        },
      });

    oldOpenDay = day(100);
    oldOpenId = (await entry(oldOpenDay, null)).id;
    oldOpenLockedId = (await entry(day(140), null, { isLocked: true })).id;
    insideWindowId = (await entry(pastDateStr(3), null)).id;
    oldClosedId = (await entry(day(160), "15:30")).id;
    oldDeletedId = (await entry(day(180), null, { deletedAt: new Date() })).id;

    const pendingDay = day(200);
    const pending = await app.prisma.retroEntryRequest.create({
      data: {
        employeeId,
        targetDate: new Date(`${pendingDay}T00:00:00Z`),
        reason: "Audit fixture reason that must never be printed",
        startTime: "08:30",
        endTime: null,
        status: "PENDING",
      },
    });
    oldPendingRetroId = (
      await entry(pendingDay, null, {
        isInvalid: true,
        retroRequestId: pending.id,
        ...invalidReasonFields("RETRO_APPROVAL_PENDING"),
      })
    ).id;

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
      console.error("audit-1085 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("lists the open entry older than the window with its day, age and window, and exits 2", () => {
    expect(run.code).toBe(EXIT_FINDINGS);
    const own = run.lines.filter((l) => l.includes(`entryId=${oldOpenId}`));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain(`employeeId=${data.employee.id}`);
    expect(own[0]).toContain(`tenantId=${data.tenant.id}`);
    expect(own[0]).toContain(`date=${oldOpenDay}`);
    expect(own[0]).toMatch(/ageDays=\d{3}\b/);
    expect(own[0]).toContain("windowDays=10");
    expect(own[0]).toContain("locked=false");
  });

  it("marks a row of a closed month as locked", () => {
    const own = run.lines.filter((l) => l.includes(`entryId=${oldOpenLockedId}`));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain("locked=true");
  });

  it("does not list an entry inside the window, a closed entry, a deleted one or a pending Zeitnachtrag row", () => {
    const output = run.lines.join("\n");
    expect(output).not.toContain(insideWindowId);
    expect(output).not.toContain(oldClosedId);
    expect(output).not.toContain(oldDeletedId);
    expect(output).not.toContain(oldPendingRetroId);
  });

  it("prints totals, a month breakdown and the locked count", () => {
    expect(run.lines.some((l) => /^Totals: rows=\d+$/.test(l))).toBe(true);
    expect(run.lines.some((l) => /^Month \d{4}-\d{2}: \d+$/.test(l))).toBe(true);
    expect(run.lines.some((l) => /^Locked: \d+$/.test(l))).toBe(true);
    expect(run.lines.join("\n")).toContain("Nothing was ended");
  });

  it("prints ids, dates and counts only: no name, mail address or reason appears", () => {
    const output = run.lines.join("\n");
    expect(output).not.toContain(data.employee.firstName);
    expect(output).not.toContain(data.employee.lastName);
    expect(output).not.toContain(data.empUser.email);
    expect(output).not.toContain("Audit fixture reason");
    for (const line of run.lines) expect(line).not.toContain("@");
  });

  it("--help exits 0 and every write-style flag is refused", async () => {
    const help = await capture(() => main(["--help"], app.prisma));
    expect(help.code).toBe(EXIT_OK);
    expect(help.lines.join("\n")).toContain("READ-ONLY");
    expect(parseCli([])).toEqual({ help: false });
    for (const flag of ["--apply", "--confirm", "--fix", "--end", "--write", "--dry-run=false"]) {
      await expect(main([flag], app.prisma)).rejects.toThrow();
      expect(() => parseCli([flag])).toThrow();
    }
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

  it("is read-only: row counts and the open entry are unchanged by the run and the source has no write call", async () => {
    expect(await counts()).toEqual(countsBefore);
    const entry = await app.prisma.timeEntry.findUniqueOrThrow({ where: { id: oldOpenId } });
    expect(entry.endTime).toBeNull();
    expect(entry.deletedAt).toBeNull();

    const source = readFileSync(
      fileURLToPath(new URL("../audit-1085-open-entries-outside-window.ts", import.meta.url)),
      "utf8",
    );
    expect(source.length).toBeGreaterThan(1000); // anti-vacuity: the scan read a real file
    expect(source).not.toMatch(
      /\.(update|create|delete|updateMany|deleteMany|upsert|createMany)\(/,
    );
    expect(source).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("a tenant with a wider window keeps its inside-window entry out and a narrower one lists it", async () => {
    // The window is per tenant: with a 1-day window the 3-day-old open entry is outside it.
    await app.prisma.tenantConfig.update({
      where: { tenantId: data.tenant.id },
      data: { retroEntryWindowDays: 1 },
    });
    // The window lookup is cached for five minutes; a fresh module instance is needed.
    vi.resetModules();
    const fresh = await import("../audit-1085-open-entries-outside-window");
    const narrow = await capture(() => fresh.main([], app.prisma));
    expect(narrow.lines.some((l) => l.includes(`entryId=${insideWindowId}`))).toBe(true);
    expect(narrow.lines.find((l) => l.includes(`entryId=${insideWindowId}`))).toContain(
      "windowDays=1",
    );
  });
});
