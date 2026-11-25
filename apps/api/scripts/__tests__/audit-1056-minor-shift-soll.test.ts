/**
 * Issue #1056 — audit-1056-minor-shift-soll.ts is a read-only listing: it names the complete months
 * whose SHIFT_BASED roster Soll the § 11 JArbSchG break changes (CLOSED with the stored figures,
 * OPEN) and each person's live-saldo delta, ids and minutes only, and writes nothing.
 *
 * Fixture (closedSeptember): September closed under the adult rule (-120 for all), October open,
 * clock pinned to 2026-11-10T10:00:00Z. M17 and M18 are minors on every September shift; in October
 * M17 stays a minor on all four shifts, M18 on two of them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, cleanupTestData } from "../../src/__tests__/setup";
import {
  seedMinorShiftFixture,
  PINNED_NOW,
  type MinorShiftFixture,
} from "../../src/__tests__/shift-soll-minor-fixture-1056";
import {
  main,
  parseCli,
  signed,
  formatMonthLine,
  formatPersonLine,
  EXIT_FINDINGS,
} from "../audit-1056-minor-shift-soll";

describe("audit-1056-minor-shift-soll — pure helpers and CLI", () => {
  it("parseCli accepts --tenant-id, --all-tenants and --help", () => {
    expect(parseCli(["--tenant-id", "t1"])).toEqual({
      tenantId: "t1",
      allTenants: false,
      help: false,
    });
    expect(parseCli(["--all-tenants"]).allTenants).toBe(true);
    expect(parseCli(["--help"]).help).toBe(true);
  });

  it("parseCli rejects every write flag and unknown flag", () => {
    expect(() => parseCli(["--confirm"])).toThrow();
    expect(() => parseCli(["--apply"])).toThrow();
    expect(() => parseCli(["--tenant-id", "t1", "--force"])).toThrow();
  });

  it("main throws without or with a double tenant selection", async () => {
    await expect(main([])).rejects.toThrow(/Tenant-Auswahl/);
    await expect(main(["--tenant-id", "t1", "--all-tenants"])).rejects.toThrow(/Tenant-Auswahl/);
  });

  it("signed minutes: +N, -N, 0", () => {
    expect(signed(120)).toBe("+120");
    expect(signed(-60)).toBe("-60");
    expect(signed(0)).toBe("0");
  });

  it("a CLOSED line carries snapshotId, locked and the stored balance; an OPEN line neither", () => {
    const closed = formatMonthLine({
      tenantId: "t",
      employeeId: "e",
      monthLabel: "2026-09",
      state: "CLOSED",
      snapshotId: "s1",
      locked: true,
      storedBalanceMinutes: -120,
      balanceDeltaMinutes: 120,
      expectedDeltaMinutes: 0,
    });
    expect(closed).toBe(
      "month tenantId=t employeeId=e month=2026-09 state=CLOSED snapshotId=s1 locked=true storedBalanceMinutes=-120 balanceDeltaMinutes=+120 expectedDeltaMinutes=0",
    );
    const open = formatMonthLine({
      tenantId: "t",
      employeeId: "e",
      monthLabel: "2026-10",
      state: "OPEN",
      snapshotId: null,
      locked: null,
      storedBalanceMinutes: null,
      balanceDeltaMinutes: 60,
      expectedDeltaMinutes: 0,
    });
    expect(open).toBe(
      "month tenantId=t employeeId=e month=2026-10 state=OPEN balanceDeltaMinutes=+60 expectedDeltaMinutes=0",
    );
    expect(open).not.toContain("snapshotId");
    expect(open).not.toContain("locked");
    expect(
      formatPersonLine({
        tenantId: "t",
        employeeId: "e",
        closedMonths: 1,
        closedBalanceDeltaMinutes: 120,
        openMonths: 1,
        liveDeltaMinutes: 120,
      }),
    ).toBe(
      "person tenantId=t employeeId=e closedMonths=1 closedBalanceDeltaMinutes=+120 openMonths=1 liveDeltaMinutes=+120",
    );
  });
});

describe("audit-1056-minor-shift-soll (Issue #1056)", { timeout: 120_000 }, () => {
  let app: FastifyInstance;
  let fx: MinorShiftFixture;

  beforeAll(async () => {
    app = await getTestApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_NOW));
    fx = await seedMinorShiftFixture(app, "au1056", { closedSeptember: true });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (fx) await cleanupTestData(app, fx.tenantId);
    await closeTestApp();
  });

  it("lists the minors' closed September and open October with the live delta, and writes nothing", async () => {
    const ids = Object.values(fx.persons);
    const snapshotsBefore = await app.prisma.saldoSnapshot.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { id: "asc" },
    });
    // AuditLog carries no tenant column: the rows a write would leave name the persons or the snapshots.
    const auditEntityIds = [...ids, ...snapshotsBefore.map((s) => s.id)];
    const auditBefore = await app.prisma.auditLog.count({
      where: { entityId: { in: auditEntityIds } },
    });
    const accountsBefore = await app.prisma.overtimeAccount.findMany({
      where: { employeeId: { in: ids } },
      orderBy: { id: "asc" },
    });

    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    let code: number;
    try {
      code = await main(["--tenant-id", fx.tenantId], app.prisma);
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(EXIT_FINDINGS);

    const t = fx.tenantId;
    const sepSnapshot = (employeeId: string) =>
      snapshotsBefore.find((s) => s.employeeId === employeeId)!.id;
    const m17 = fx.persons.M17;
    const m18 = fx.persons.M18;

    expect(lines).toContain(
      `month tenantId=${t} employeeId=${m17} month=2026-09 state=CLOSED snapshotId=${sepSnapshot(m17)} locked=true storedBalanceMinutes=-120 balanceDeltaMinutes=+120 expectedDeltaMinutes=0`,
    );
    expect(lines).toContain(
      `month tenantId=${t} employeeId=${m17} month=2026-10 state=OPEN balanceDeltaMinutes=+120 expectedDeltaMinutes=0`,
    );
    expect(lines).toContain(
      `person tenantId=${t} employeeId=${m17} closedMonths=1 closedBalanceDeltaMinutes=+120 openMonths=1 liveDeltaMinutes=+120`,
    );
    expect(lines).toContain(
      `month tenantId=${t} employeeId=${m18} month=2026-09 state=CLOSED snapshotId=${sepSnapshot(m18)} locked=true storedBalanceMinutes=-120 balanceDeltaMinutes=+120 expectedDeltaMinutes=0`,
    );
    expect(lines).toContain(
      `month tenantId=${t} employeeId=${m18} month=2026-10 state=OPEN balanceDeltaMinutes=+60 expectedDeltaMinutes=0`,
    );
    expect(lines).toContain(
      `person tenantId=${t} employeeId=${m18} closedMonths=1 closedBalanceDeltaMinutes=+120 openMonths=1 liveDeltaMinutes=+60`,
    );

    const output = lines.join("\n");
    expect(output).not.toContain(fx.persons.ADULT);
    expect(output).not.toContain(fx.persons.NONE);

    // Ids and minutes only: no birth date, no name.
    for (const forbidden of ["birthDate", "2009-10-14", "2008-10-14", "Fix", "F1056"]) {
      expect(output, forbidden).not.toContain(forbidden);
    }

    // Read-only: every stored row is unchanged.
    expect(
      await app.prisma.saldoSnapshot.findMany({
        where: { employeeId: { in: ids } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(snapshotsBefore);
    expect(
      await app.prisma.overtimeAccount.findMany({
        where: { employeeId: { in: ids } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(accountsBefore);
    expect(await app.prisma.auditLog.count({ where: { entityId: { in: auditEntityIds } } })).toBe(
      auditBefore,
    );
  });
});
