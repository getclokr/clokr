/**
 * Issue #1126 — the suggested special-leave occasions carry no claim text.
 *
 * § 616 BGB names no occasion and no number of days and can be excluded by contract, so a
 * suggestion Clokr creates for a tenant must not state an entitlement. This test drives the real
 * route that lazily seeds the suggestions and pins what stays (name, days, proof, status) and what
 * goes (the stored description).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, seedTestData, cleanupTestData } from "./setup";

interface RuleRow {
  id: string;
  name: string;
  reason: string | null;
  defaultDays: number | string;
  requiresProof: boolean;
  isActive: boolean;
  isStatutory: boolean;
}

// Pinned from the pre-#1126 seed: proves name, days and proof are unchanged.
const EXPECTED_SUGGESTIONS: Array<[string, number, boolean]> = [
  ["25-jähriges Dienstjubiläum", 1, false],
  ["Eigene Hochzeit", 1, true],
  ["Geburt eines Kindes", 1, true],
  ["Goldene Hochzeit", 1, false],
  ["Schwere Erkrankung Hausangehöriger", 1, false],
  ["Silberne Hochzeit", 1, false],
  ["Tod Elternteil/Kind", 2, true],
  ["Tod Ehepartner/Lebenspartner", 2, true],
  ["Tod Geschwister", 1, true],
  ["Tod Schwiegereltern", 1, true],
  ["Umzug (betriebsbedingt)", 1, false],
].sort((a, b) => (a[0] as string).localeCompare(b[0] as string)) as Array<
  [string, number, boolean]
>;

describe("Special-leave suggestions carry no claim text (#1126)", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let rules: RuleRow[];
  let rawBody: string;

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "sl1126");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/special-leave/rules",
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    rawBody = res.body;
    rules = JSON.parse(res.body) as RuleRow[];
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
  });

  it("seeds eleven suggestions, every one without a description and active", () => {
    const suggestions = rules.filter((r) => r.isStatutory);
    expect(suggestions).toHaveLength(11);
    for (const s of suggestions) {
      expect(s.reason).toBeNull();
      expect(s.isActive).toBe(true);
    }
  });

  it("keeps name, defaultDays and requiresProof of the eleven suggestions", () => {
    const actual = rules
      .filter((r) => r.isStatutory)
      .map((r) => [r.name, Number(r.defaultDays), r.requiresProof] as [string, number, boolean])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(actual).toEqual(EXPECTED_SUGGESTIONS);
  });

  it("never mentions the statute in the response", () => {
    expect(rawBody).not.toContain("§ 616");
  });

  it("refuses to rename a suggestion and names it a suggested occasion", async () => {
    const target = rules.find((r) => r.isStatutory)!;
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/special-leave/rules/${target.id}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
      payload: { name: "Etwas anderes" },
    });
    expect(res.statusCode).toBe(400);
    const error = JSON.parse(res.body).error as string;
    expect(error).toBe("Der Name eines vorgeschlagenen Anlasses kann nicht geändert werden");
    expect(error).not.toMatch(/gesetzlich/i);

    const after = await app.prisma.specialLeaveRule.findFirst({
      where: { id: target.id, tenantId: data.tenant.id },
    });
    expect(after?.name).toBe(target.name);
  });

  it("refuses to delete a suggestion and names it a suggested occasion", async () => {
    const target = rules.find((r) => r.isStatutory)!;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/special-leave/rules/${target.id}`,
      headers: { authorization: `Bearer ${data.adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const error = JSON.parse(res.body).error as string;
    expect(error).toBe("Vorgeschlagene Anlässe können nicht gelöscht werden — nur deaktiviert");
    expect(error).not.toMatch(/gesetzlich/i);

    const still = await app.prisma.specialLeaveRule.findFirst({
      where: { id: target.id, tenantId: data.tenant.id },
    });
    expect(still).not.toBeNull();
  });
});
