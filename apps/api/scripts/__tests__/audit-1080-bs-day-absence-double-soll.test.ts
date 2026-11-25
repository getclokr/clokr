/**
 * Issue #1080 - audit-1080-bs-day-absence-double-soll.ts is a read-only listing.
 *
 * The integration case runs `main` against a seeded tenant: a closed and an open month hold a
 * Berufsschultag inside an imposed absence of another code (the old rule reduced the Soll of that
 * day twice). A MANUAL-source Berufsschultag of the same shape is the control: the old rule
 * counted it once already, so it must not be listed. The case executes the real queries (the
 * scripts typecheck sees no query that no test ever ran), asserts that no row changes and that no
 * person name reaches the output.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "../../src/__tests__/setup";
import { saldoSnapshotPeriodBounds } from "../../src/__tests__/test-dates";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  main,
  parseCli,
  overlapDays,
} from "../audit-1080-bs-day-absence-double-soll";

const day = (s: string) => new Date(s + "T00:00:00Z");

async function captureMain(
  argv: string[],
  prisma: FastifyInstance["prisma"],
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    const code = await main(argv, prisma);
    return { code, lines };
  } finally {
    spy.mockRestore();
  }
}

describe("overlapDays (pure)", () => {
  it("pairs a Berufsschultag with the non-Berufsschule rows covering it and flags a full day", () => {
    const days = overlapDays(
      [
        { id: "a1", startDate: day("2026-09-14"), endDate: day("2026-09-18"), halfDay: false },
        { id: "a2", startDate: day("2026-09-16"), endDate: day("2026-09-16"), halfDay: true },
      ],
      [{ id: "b1", startDate: day("2026-09-16"), endDate: day("2026-09-16"), source: "PATTERN" }],
      "Europe/Berlin",
    );
    expect([...days.keys()]).toEqual(["2026-09-16"]);
    const d = days.get("2026-09-16")!;
    expect(d.absenceIds.sort()).toEqual(["a1", "a2"]);
    expect(d.bsAbsenceIds).toEqual(["b1"]);
    expect(d.fullDay).toBe(true);
    expect(d.hasPattern).toBe(true);
    expect(d.hasManual).toBe(false);
  });

  it("flags a day covered only by half-day rows as not full", () => {
    const days = overlapDays(
      [{ id: "a1", startDate: day("2026-09-16"), endDate: day("2026-09-16"), halfDay: true }],
      [{ id: "b1", startDate: day("2026-09-16"), endDate: day("2026-09-16"), source: "MANUAL" }],
      "Europe/Berlin",
    );
    expect(days.get("2026-09-16")!.fullDay).toBe(false);
    expect(days.get("2026-09-16")!.hasManual).toBe(true);
  });

  it("returns nothing when the Berufsschultag lies outside every absence", () => {
    const days = overlapDays(
      [{ id: "a1", startDate: day("2026-09-14"), endDate: day("2026-09-15"), halfDay: false }],
      [{ id: "b1", startDate: day("2026-09-16"), endDate: day("2026-09-16"), source: "PATTERN" }],
      "Europe/Berlin",
    );
    expect(days.size).toBe(0);
  });
});

describe("parseCli", () => {
  it("rejects an unknown or write flag by strict parsing", () => {
    expect(() => parseCli(["--tenant-id", "x", "--confirm"])).toThrow();
    expect(() => parseCli(["--apply"])).toThrow();
  });
});

describe("main (read-only)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let clean: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "a1080");
    clean = await seedTestData(app, "b1080");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, clean.tenant.id);
    } finally {
      await closeTestApp();
    }
  });

  it("lists the closed and the open month with 480 minutes, not the MANUAL control, and changes no row", async () => {
    const employeeId = data.employee.id;
    const controlId = data.adminEmployee.id;
    const mk = (
      id: string,
      type: "MATERNITY" | "OTHER" | "PARENTAL" | "VOCATIONAL_SCHOOL",
      source: "MANUAL" | "PATTERN",
      start: string,
      end: string,
    ) =>
      app.prisma.absence.create({
        data: {
          employeeId: id,
          type,
          source,
          startDate: day(start),
          endDate: day(end),
          days: 1,
          createdBy: "system",
        },
      });

    // Wed 16.09.2026: PATTERN Berufsschultag inside a MATERNITY absence 14.-18.09. (closed month).
    const maternity = await mk(employeeId, "MATERNITY", "MANUAL", "2026-09-14", "2026-09-18");
    const bsSep = await mk(employeeId, "VOCATIONAL_SCHOOL", "PATTERN", "2026-09-16", "2026-09-16");
    // Wed 14.10.2026: PATTERN Berufsschultag inside an OTHER absence 12.-16.10. (open month).
    const other = await mk(employeeId, "OTHER", "MANUAL", "2026-10-12", "2026-10-16");
    const bsOct = await mk(employeeId, "VOCATIONAL_SCHOOL", "PATTERN", "2026-10-14", "2026-10-14");
    // Control: a MANUAL-source Berufsschultag took part in the day dedup, so the old rule counted
    // the day once already.
    await mk(controlId, "PARENTAL", "MANUAL", "2026-09-14", "2026-09-18");
    await mk(controlId, "VOCATIONAL_SCHOOL", "MANUAL", "2026-09-16", "2026-09-16");

    const bounds = saldoSnapshotPeriodBounds(new Date("2026-09-01T00:00:00Z"));
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
        closedAt: new Date("2026-10-01T05:00:00Z"),
      },
    });

    const snapshot = async () => ({
      snapshots: await app.prisma.saldoSnapshot.findMany({
        where: { employee: { tenantId: data.tenant.id } },
        orderBy: { id: "asc" },
      }),
      absences: await app.prisma.absence.findMany({
        where: { employee: { tenantId: data.tenant.id } },
        orderBy: { id: "asc" },
      }),
      accounts: await app.prisma.overtimeAccount.findMany({
        where: { employee: { tenantId: data.tenant.id } },
        orderBy: { id: "asc" },
      }),
    });
    const before = await snapshot();

    const { code, lines } = await captureMain(["--tenant-id", data.tenant.id], app.prisma);

    expect(code).toBe(EXIT_FINDINGS);
    expect(await snapshot()).toEqual(before);

    const findings = lines.filter((l) => l.startsWith("finding "));
    expect(findings).toHaveLength(2);
    const sep = findings.find((l) => l.includes("month=2026-09"))!;
    const oct = findings.find((l) => l.includes("month=2026-10"))!;
    expect(sep).toContain(`employeeId=${employeeId}`);
    expect(sep).toContain("closed=true");
    expect(sep).toContain("lockedEntries=false");
    expect(sep).toContain("doubleReducedMinutes=480");
    expect(sep).toContain(`absenceIds=${maternity.id}`);
    expect(sep).toContain(`bsAbsenceIds=${bsSep.id}`);
    expect(oct).toContain("closed=false");
    expect(oct).toContain("doubleReducedMinutes=480");
    expect(oct).toContain(`absenceIds=${other.id}`);
    expect(oct).toContain(`bsAbsenceIds=${bsOct.id}`);
    // The MANUAL-source control person is not listed.
    expect(lines.join("\n")).not.toContain(controlId);
    expect(lines.find((l) => l.startsWith("summary "))).toContain("findings=2");
    // Ids and minutes only: no fixture name reaches the output.
    const all = lines.join("\n");
    for (const name of [
      data.employee.firstName,
      data.employee.lastName,
      data.adminEmployee.firstName,
    ]) {
      expect(all).not.toContain(name);
    }
  });

  it("returns EXIT_OK for a tenant without any overlap", async () => {
    const { code, lines } = await captureMain(["--tenant-id", clean.tenant.id], app.prisma);
    expect(code).toBe(EXIT_OK);
    expect(lines.filter((l) => l.startsWith("finding "))).toHaveLength(0);
  });

  it("answers EXIT_ERROR for neither or both of --tenant-id and --all-tenants and rejects --confirm", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main([], app.prisma)).toBe(EXIT_ERROR);
      expect(await main(["--tenant-id", data.tenant.id, "--all-tenants"], app.prisma)).toBe(
        EXIT_ERROR,
      );
    } finally {
      err.mockRestore();
    }
    await expect(main(["--tenant-id", data.tenant.id, "--confirm"], app.prisma)).rejects.toThrow();
  });
});
