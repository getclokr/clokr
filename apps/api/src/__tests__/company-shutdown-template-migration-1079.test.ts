/**
 * Issue #1079 — the data-only migration that gives the global Salonmanager template
 * `company-shutdown:manage:ZUGEWIESEN` (owner decision 25.11.2026, A2), proven on REAL SQL
 * execution of the checked-in file, same discipline as `month-correction-template-migration-599.test.ts`
 * and built on `template-grant-chain.ts` (the chain entry `_company_shutdown_template_grant`).
 * Admin and Inhaber held the key from the start and are not touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "./setup";
import {
  TEMPLATE_GRANT_CHAIN,
  grantMigrationSql,
  keysGrantedTo,
  replayChainFrom,
  templateAsOf,
  withRolledBackTransaction,
} from "./template-grant-chain";
import {
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRoleSlot,
} from "../contexts/platform";

const SUFFIX = "_company_shutdown_template_grant";
const GRANT = TEMPLATE_GRANT_CHAIN.find((g) => g.dirSuffix === SUFFIX)!;
const SLOTS = Object.keys(SYSTEM_ROLE_IDS) as SystemRoleSlot[];
const GRANTED = SLOTS.filter((slot) => keysGrantedTo(GRANT, slot).length > 0);

function body(): string {
  return grantMigrationSql(SUFFIX)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function statements(): string[] {
  return body()
    .split('UPDATE "AccessRole"')
    .slice(1)
    .map((s) => 'UPDATE "AccessRole"' + s);
}

describe("Issue #1079 — company-shutdown template migration, static shape", () => {
  it("the chain entry grants only the Salonmanager; every other slot gets nothing", () => {
    expect(GRANT).toBeDefined();
    expect(GRANTED).toEqual(["SALON_MANAGER"]);
  });

  it("one guarded UPDATE per granted slot, no other system-role id, no DDL, no assignment", () => {
    const text = body();
    const stmts = statements();
    expect(stmts).toHaveLength(GRANTED.length);
    for (const slot of SLOTS) {
      const own = stmts.filter((s) => s.includes(`WHERE "id" = '${SYSTEM_ROLE_IDS[slot]}'`));
      expect(own, slot).toHaveLength(GRANTED.includes(slot) ? 1 : 0);
    }
    for (const s of stmts) {
      expect(s).toContain('"tenantId" IS NULL');
      expect(s).toContain("IS DISTINCT FROM");
    }
    expect(text).not.toMatch(/\b(CREATE|ALTER|DROP)\b/);
    expect(text).not.toContain('INSERT INTO "RoleAssignment"');
    expect(text).not.toContain('INSERT INTO "AuditLog"');
  });

  it("both ARRAY literals of each UPDATE equal the slot's template as of this migration", () => {
    for (const slot of GRANTED) {
      const stmt = statements().find((s) => s.includes(`WHERE "id" = '${SYSTEM_ROLE_IDS[slot]}'`))!;
      const arrays = [...stmt.matchAll(/ARRAY\[([\s\S]*?)\]::text\[\]/g)].map((m) =>
        [...m[1]!.matchAll(/'([^']+)'/g)].map((k) => k[1]!),
      );
      expect(arrays, slot).toHaveLength(2);
      for (const keys of arrays) {
        expect(keys, slot).toEqual(templateAsOf(slot, SUFFIX));
        for (const k of keysGrantedTo(GRANT, slot)) expect(keys, slot).toContain(k);
      }
    }
  });
});

describe("Issue #1079 — company-shutdown template migration, replay and content drift", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await getTestApp();
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it("replay is idempotent and leaves every global row equal to its live constant", async () => {
    const ids = Object.values(SYSTEM_ROLE_IDS);
    const rows = await withRolledBackTransaction(app.prisma, async (tx) => {
      await replayChainFrom(tx, SUFFIX);
      const second: number[] = [];
      for (const s of statements()) second.push(await tx.$executeRawUnsafe(s));
      expect(second).toEqual(statements().map(() => 0));
      return tx.accessRole.findMany({ where: { id: { in: ids } } });
    });
    expect(rows).toHaveLength(7);
    for (const slot of SLOTS) {
      const row = rows.find((r) => r.id === SYSTEM_ROLE_IDS[slot]);
      expect(row?.permissions, slot).toEqual([...SYSTEM_ROLE_PERMISSIONS[slot]]);
    }
  });

  it("content drift: every global row equals its constant; only Admin, Inhaber and Salonmanager hold the key", async () => {
    for (const slot of SLOTS) {
      const row = await app.prisma.accessRole.findUniqueOrThrow({
        where: { id: SYSTEM_ROLE_IDS[slot] },
      });
      expect(row.permissions, slot).toEqual([...SYSTEM_ROLE_PERMISSIONS[slot]]);
      expect(row.permissions.includes("company-shutdown:manage:ZUGEWIESEN"), slot).toBe(
        ["ADMIN", "OWNER", "SALON_MANAGER"].includes(slot),
      );
    }
  });
});
