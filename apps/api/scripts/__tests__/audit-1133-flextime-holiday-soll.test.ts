/**
 * Issue #1133 - audit-1133-flextime-holiday-soll.ts is a read-only listing.
 *
 * The integration case runs `main` against a seeded tenant: one person gets a FLEXTIME contract
 * (40 h Tue-Fri, placeholder flag 1 on Mon-Fri) from April 2026, May 2026 is closed. The
 * nationwide holidays of both months differ between the old flag rule and the Ø-day. The other
 * seeded person keeps a FIXED_SCHEDULE contract and is the control. The case executes the real
 * queries, asserts that no row changes and that no person name reaches the output.
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
  holidaySollDifference,
} from "../audit-1133-flextime-holiday-soll";

const TZ = "Europe/Berlin";
const FLEX = {
  type: "FLEXTIME" as const,
  weeklyHours: 40,
  mondayHours: 1,
  tuesdayHours: 1,
  wednesdayHours: 1,
  thursdayHours: 1,
  fridayHours: 1,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [2, 3, 4, 5],
};

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

describe("holidaySollDifference (pure)", () => {
  it("a contract-day holiday is short by Ø-day − 60, a flagged non-contract Monday over by 60", () => {
    // Fri 1.5. and Thu 14.5.: 600 − 60 each; Mon 25.5.: 0 − 60.
    expect(holidaySollDifference(FLEX, ["2026-05-01", "2026-05-14", "2026-05-25"], TZ)).toEqual({
      dates: ["2026-05-01", "2026-05-14", "2026-05-25"],
      sollTooHighMinutes: 1020,
    });
  });

  it("a holiday on an unflagged weekend day differs in nothing", () => {
    expect(holidaySollDifference(FLEX, ["2026-10-03"], TZ)).toEqual({
      dates: [],
      sollTooHighMinutes: 0,
    });
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
    data = await seedTestData(app, "a1133");
    clean = await seedTestData(app, "b1133");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, clean.tenant.id);
    } finally {
      await closeTestApp();
    }
  });

  it("lists the closed May and the open April with their minutes, not the FIXED control, and changes no row", async () => {
    const employeeId = data.employee.id;
    const controlId = data.adminEmployee.id;
    await app.prisma.workSchedule.create({
      data: { employeeId, validFrom: new Date("2026-04-01T00:00:00Z"), ...FLEX },
    });
    const bounds = saldoSnapshotPeriodBounds(new Date("2026-05-01T00:00:00Z"));
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
        closedAt: new Date("2026-06-01T05:00:00Z"),
      },
    });

    const snapshot = async () => ({
      snapshots: await app.prisma.saldoSnapshot.findMany({
        where: { employee: { tenantId: data.tenant.id } },
        orderBy: { id: "asc" },
      }),
      schedules: await app.prisma.workSchedule.findMany({
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
    const apr = findings.find((l) => l.includes("month=2026-04"));
    const may = findings.find((l) => l.includes("month=2026-05"));
    expect(apr).toBeDefined();
    expect(may).toBeDefined();
    // April: Fri 3.4. +540, Mon 6.4. −60.
    expect(apr).toContain(`employeeId=${employeeId}`);
    expect(apr).toContain("closed=false");
    expect(apr).toContain("holidays=2026-04-03,2026-04-06");
    expect(apr).toContain("sollTooHighMinutes=480");
    // May: Fri 1.5. and Thu 14.5. +540 each, Mon 25.5. −60.
    expect(may).toContain("closed=true");
    expect(may).toContain("lockedEntries=false");
    expect(may).toContain("sollTooHighMinutes=1020");
    // No month before the FLEXTIME contract, and the FIXED control person is not listed.
    expect(findings.some((l) => l.includes("month=2026-03"))).toBe(false);
    expect(lines.join("\n")).not.toContain(controlId);
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

  it("returns EXIT_OK for a tenant without a FLEXTIME contract", async () => {
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
