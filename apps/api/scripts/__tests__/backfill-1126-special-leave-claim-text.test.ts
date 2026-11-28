/**
 * Issue #1126: the backfill empties the description of exactly the suggested special-leave
 * occasions that still carry the unchanged legacy seed text, and changes nothing else.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, seedTestData, cleanupTestData, soleAuditRow } from "../../src/__tests__/setup";
import {
  runBackfill,
  main,
  LEGACY_SEED_REASON,
  BACKFILL_MARKER,
  EXIT_OK,
  EXIT_ERROR,
} from "../backfill-1126-special-leave-claim-text";

describe("backfill 1126: legacy claim text of suggested special-leave occasions", () => {
  let app: FastifyInstance;
  let tenantA: Awaited<ReturnType<typeof seedTestData>>;
  let tenantB: Awaited<ReturnType<typeof seedTestData>>;
  const ids: Record<"a" | "b" | "c" | "d" | "e" | "f" | "g", string> = {
    a: "",
    b: "",
    c: "",
    d: "",
    e: "",
    f: "",
    g: "",
  };
  const EDITED = "Nur mit Mietvertrag";
  const EXTENDED = `${LEGACY_SEED_REASON} (Tarifvertrag)`;

  async function rule(data: {
    tenantId: string;
    name: string;
    reason: string | null;
    isStatutory: boolean;
    defaultDays?: number;
    requiresProof?: boolean;
    isActive?: boolean;
  }): Promise<string> {
    const row = await app.prisma.specialLeaveRule.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        reason: data.reason,
        isStatutory: data.isStatutory,
        defaultDays: data.defaultDays ?? 1,
        requiresProof: data.requiresProof ?? false,
        isActive: data.isActive ?? true,
      },
    });
    return row.id;
  }

  async function auditCount(entityId: string): Promise<number> {
    return app.prisma.auditLog.count({ where: { entity: "SpecialLeaveRule", entityId } });
  }

  beforeAll(async () => {
    app = await getTestApp();
    tenantA = await seedTestData(app, "bf1126a");
    tenantB = await seedTestData(app, "bf1126b");
    const A = tenantA.tenant.id;
    ids.a = await rule({
      tenantId: A,
      name: "Eigene Hochzeit",
      reason: LEGACY_SEED_REASON,
      isStatutory: true,
      defaultDays: 1,
      requiresProof: true,
      isActive: true,
    });
    // The tenant changed days, proof and status, but not the text.
    ids.b = await rule({
      tenantId: A,
      name: "Tod Geschwister",
      reason: LEGACY_SEED_REASON,
      isStatutory: true,
      defaultDays: 2,
      requiresProof: false,
      isActive: false,
    });
    ids.c = await rule({
      tenantId: A,
      name: "Umzug (betriebsbedingt)",
      reason: EDITED,
      isStatutory: true,
    });
    ids.d = await rule({
      tenantId: A,
      name: "Silberne Hochzeit",
      reason: EXTENDED,
      isStatutory: true,
    });
    ids.e = await rule({
      tenantId: A,
      name: "Goldene Hochzeit",
      reason: null,
      isStatutory: true,
    });
    // A custom rule is not a suggestion, even with the legacy text.
    ids.f = await rule({
      tenantId: A,
      name: "Ehrenamt",
      reason: LEGACY_SEED_REASON,
      isStatutory: false,
    });
    ids.g = await rule({
      tenantId: tenantB.tenant.id,
      name: "Eigene Hochzeit",
      reason: LEGACY_SEED_REASON,
      isStatutory: true,
    });
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      try {
        await cleanupTestData(app, t.tenant.id);
      } catch (err) {
        console.error("backfill-1126 cleanup failed:", err);
      }
    }
  });

  it("dry run lists exactly the unchanged-seed suggestions and writes nothing", async () => {
    const results = await runBackfill(app, { confirm: false, tenantId: tenantA.tenant.id });
    expect(results.map((r) => r.ruleId).sort()).toEqual([ids.a, ids.b].sort());
    expect(results.every((r) => r.outcome === "planned")).toBe(true);

    const rows = await app.prisma.specialLeaveRule.findMany({
      where: { id: { in: Object.values(ids) } },
    });
    const byId = new Map(rows.map((r) => [r.id, r.reason]));
    expect(byId.get(ids.a)).toBe(LEGACY_SEED_REASON);
    expect(byId.get(ids.b)).toBe(LEGACY_SEED_REASON);
    expect(byId.get(ids.c)).toBe(EDITED);
    expect(byId.get(ids.d)).toBe(EXTENDED);
    expect(byId.get(ids.e)).toBeNull();
    expect(byId.get(ids.f)).toBe(LEGACY_SEED_REASON);
    expect(byId.get(ids.g)).toBe(LEGACY_SEED_REASON);
    for (const id of Object.values(ids)) expect(await auditCount(id)).toBe(0);
  });

  it("confirm empties only the reason of a and b, audits each, leaves everything else", async () => {
    const results = await runBackfill(app, { confirm: true, tenantId: tenantA.tenant.id });
    expect(results.map((r) => [r.ruleId, r.outcome]).sort()).toEqual(
      [
        [ids.a, "written"],
        [ids.b, "written"],
      ].sort(),
    );

    const a = await app.prisma.specialLeaveRule.findUniqueOrThrow({ where: { id: ids.a } });
    expect(a.reason).toBeNull();
    expect([a.name, Number(a.defaultDays), a.requiresProof, a.isActive, a.isStatutory]).toEqual([
      "Eigene Hochzeit",
      1,
      true,
      true,
      true,
    ]);
    const b = await app.prisma.specialLeaveRule.findUniqueOrThrow({ where: { id: ids.b } });
    expect(b.reason).toBeNull();
    expect([b.name, Number(b.defaultDays), b.requiresProof, b.isActive, b.isStatutory]).toEqual([
      "Tod Geschwister",
      2,
      false,
      false,
      true,
    ]);

    const untouched = await app.prisma.specialLeaveRule.findMany({
      where: { id: { in: [ids.c, ids.d, ids.e, ids.f, ids.g] } },
    });
    const byId = new Map(untouched.map((r) => [r.id, r.reason]));
    expect(byId.get(ids.c)).toBe(EDITED);
    expect(byId.get(ids.d)).toBe(EXTENDED);
    expect(byId.get(ids.e)).toBeNull();
    expect(byId.get(ids.f)).toBe(LEGACY_SEED_REASON);
    // Tenant narrowing: the other tenant's suggestion is not touched.
    expect(byId.get(ids.g)).toBe(LEGACY_SEED_REASON);

    for (const id of [ids.a, ids.b]) {
      const row = await soleAuditRow(app.prisma, {
        where: { entity: "SpecialLeaveRule", entityId: id, action: "UPDATE" },
      });
      expect(row.userId).toBeNull();
      expect(row.oldValue).toEqual({ reason: LEGACY_SEED_REASON });
      expect(row.newValue).toEqual({ reason: null, ...BACKFILL_MARKER });
    }
    for (const id of [ids.c, ids.d, ids.e, ids.f, ids.g]) expect(await auditCount(id)).toBe(0);
  });

  it("is idempotent: a second run finds nothing and writes no audit row", async () => {
    const results = await runBackfill(app, { confirm: true, tenantId: tenantA.tenant.id });
    expect(results).toEqual([]);
    expect(await auditCount(ids.a)).toBe(1);
    expect(await auditCount(ids.b)).toBe(1);
  });

  it("CLI: rejects an unknown flag and honours --tenant with --confirm", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--bogus"], app)).toBe(EXIT_ERROR);
      expect(await main(["--tenant", tenantB.tenant.id, "--confirm"], app)).toBe(EXIT_OK);
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
    const g = await app.prisma.specialLeaveRule.findUniqueOrThrow({ where: { id: ids.g } });
    expect(g.reason).toBeNull();
    expect(await auditCount(ids.g)).toBe(1);
  });
});
