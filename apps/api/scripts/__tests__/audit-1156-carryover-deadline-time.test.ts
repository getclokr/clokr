/**
 * Issue #1156 - audit-1156-carryover-deadline-time.ts is a read-only listing.
 *
 * The pure cases classify literal timestamps (a host-zone write of the old construction under
 * Berlin and Los Angeles is OTHER, the canonical value and a date-only admin input are not
 * findings). The integration case runs `main` against a seeded tenant: one canonical row, one
 * date-only row and one OTHER row - only the OTHER row is a finding, no row changes, no name
 * reaches the output.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData } from "../../src/__tests__/setup";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  classifyDeadline,
  intendedDay,
  main,
  parseCli,
} from "../audit-1156-carryover-deadline-time";

describe("classifyDeadline / intendedDay", () => {
  it("classifies the canonical, the date-only and a host-zone value", () => {
    expect(classifyDeadline(new Date("2027-03-31T23:59:59.000Z"))).toBe("END_OF_DAY");
    expect(classifyDeadline(new Date("2027-03-31T00:00:00.000Z"))).toBe("START_OF_DAY");
    // new Date(2027, 2, 31, 23, 59, 59) under Europe/Berlin (CEST) and America/Los_Angeles (PDT)
    expect(classifyDeadline(new Date("2027-03-31T21:59:59.000Z"))).toBe("OTHER");
    expect(classifyDeadline(new Date("2027-04-01T06:59:59.000Z"))).toBe("OTHER");
  });

  it("names the day a host-zone value meant", () => {
    expect(intendedDay(new Date("2027-03-31T21:59:59.000Z"))).toBe("2027-03-31");
    expect(intendedDay(new Date("2027-04-01T06:59:59.000Z"))).toBe("2027-03-31");
  });
});

describe("parseCli", () => {
  it("rejects a write flag", () => {
    expect(() => parseCli(["--all-tenants", "--confirm"])).toThrow();
    expect(() => parseCli(["--all-tenants", "--apply"])).toThrow();
  });
});

describe("main (read-only)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "a1156");
    const rows = {
      canonical: new Date("2027-03-31T23:59:59.000Z"),
      dateOnly: new Date("2028-03-31T00:00:00.000Z"),
      other: new Date("2029-03-31T21:59:59.000Z"),
    };
    for (const [key, deadline] of Object.entries(rows)) {
      const year = 2027 + Object.keys(ids).length;
      const row = await app.prisma.leaveEntitlement.create({
        data: {
          employeeId: data.employee.id,
          leaveTypeId: data.vacationType.id,
          year,
          totalDays: 30,
          carriedOverDays: 5,
          carryOverDeadline: deadline,
        },
      });
      ids[key] = row.id;
    }
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("needs a tenant selection", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main([], app.prisma)).toBe(EXIT_ERROR);
    err.mockRestore();
  });

  it("lists only the host-zone row as a finding, writes nothing, prints no name", async () => {
    const before = await app.prisma.leaveEntitlement.findMany({
      where: { id: { in: Object.values(ids) } },
      orderBy: { id: "asc" },
    });
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    const code = await main(["--tenant-id", data.tenant.id], app.prisma);
    info.mockRestore();

    expect(code).toBe(EXIT_FINDINGS);
    const out = lines.join("\n");
    expect(out).toContain(
      `FINDING class=OTHER tenantId=${data.tenant.id} entitlementId=${ids.other}`,
    );
    expect(out).toContain("meansDay=2029-03-31");
    expect(out).toContain(
      `INFO class=START_OF_DAY tenantId=${data.tenant.id} entitlementId=${ids.dateOnly}`,
    );
    expect(out).not.toContain(ids.canonical);
    expect(out).not.toContain(data.employee.firstName ?? "\u0000");

    const after = await app.prisma.leaveEntitlement.findMany({
      where: { id: { in: Object.values(ids) } },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
  });

  it("exits 0 when no OTHER row exists", async () => {
    await app.prisma.leaveEntitlement.delete({ where: { id: ids.other } });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const code = await main(["--tenant-id", data.tenant.id], app.prisma);
    info.mockRestore();
    expect(code).toBe(EXIT_OK);
  });
});
