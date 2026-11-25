/**
 * Issue #1056 — the manual Monatsabschluss (POST /api/v1/overtime/close-month) nets a minor's
 * SHIFT_BASED roster Soll with the § 11 JArbSchG break (§ 18 Abs. 2 ArbZG), the age decided per
 * shift date; adults and persons without a birth date keep their figures.
 *
 * Fixture (shift-soll-minor-fixture-1056.ts): four shifts 08:00-17:00 on 12.-15.10.2026, worked with
 * the prescribed 60 min break.
 *   M17 (born 2009-10-14)   -> balance 0   (the adult rule gave -120)
 *   M18 (born 2008-10-14)   -> balance -60 (60 min break before the 18th birthday, adult 30 from 14.10.)
 *   ADULT / NONE            -> balance -120, unchanged
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, cleanupTestData } from "./setup";
import {
  seedMinorShiftFixture,
  pre1056MonthInput,
  PERSON_KEYS,
  OCT_SHIFT_DAYS,
  PINNED_NOW,
  type MinorShiftFixture,
  type MinorFixturePerson,
} from "./shift-soll-minor-fixture-1056";
import { closeEmployeeMonth } from "../contexts/working-time-account/close-employee-month";
import { saldoSnapshotPeriodBounds } from "./test-dates";

describe("Issue #1056 — POST /overtime/close-month nets a minor's roster with the § 11 break", () => {
  let app: FastifyInstance;
  let fx: MinorShiftFixture;
  const bodies: Partial<Record<MinorFixturePerson, string>> = {};
  const stored: Partial<
    Record<
      MinorFixturePerson,
      {
        workedMinutes: number;
        expectedMinutes: number;
        balanceMinutes: number;
        carryOver: number;
      }
    >
  > = {};

  beforeAll(async () => {
    app = await getTestApp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_NOW));
    fx = await seedMinorShiftFixture(app, "minor-close-1056");
    const { start } = saldoSnapshotPeriodBounds(new Date("2026-10-01T00:00:00Z"));
    for (const key of PERSON_KEYS) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/overtime/close-month",
        headers: { authorization: `Bearer ${fx.adminToken}` },
        payload: { employeeId: fx.persons[key], year: 2026, month: 10, confirmGaps: true },
      });
      expect(res.statusCode, `close ${key}: ${res.body}`).toBe(201);
      bodies[key] = res.body;
      const rows = await app.prisma.saldoSnapshot.findMany({
        where: {
          employeeId: fx.persons[key],
          periodType: "MONTHLY",
          superseded: false,
          periodStart: start,
        },
        orderBy: { id: "asc" },
      });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      stored[key] = {
        workedMinutes: row.workedMinutes,
        expectedMinutes: row.expectedMinutes,
        balanceMinutes: row.balanceMinutes,
        carryOver: row.carryOver,
      };
    }
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (fx) await cleanupTestData(app, fx.tenantId);
  });

  it("stores the § 11-netted figures for the minors, the adult rule for the others", () => {
    expect(stored.M17).toMatchObject({ balanceMinutes: 0, carryOver: 0 });
    expect(stored.M18).toMatchObject({ balanceMinutes: -60, carryOver: -60 });
    expect(stored.ADULT).toMatchObject({ balanceMinutes: -120, carryOver: -120 });
    expect(stored.NONE).toMatchObject({ balanceMinutes: -120, carryOver: -120 });
  });

  it("every person stores the same worked and expected minutes (measured: 1920 / 10560)", () => {
    for (const key of PERSON_KEYS) {
      expect(stored[key]!.workedMinutes, key).toBe(1920);
      // 22 Mon-Fri days in October 2026 x 480 min.
      expect(stored[key]!.expectedMinutes, key).toBe(10560);
    }
  });

  it("no close-month response carries a birth date", () => {
    for (const key of PERSON_KEYS) {
      expect(bodies[key], key).not.toContain("birthDate");
      expect(bodies[key], key).not.toContain("2009-10-14");
      expect(bodies[key], key).not.toContain("2008-10-14");
    }
  });

  it("the pure core on M18's inputs equals the stored snapshot; without birthDate it gives the pre-#1056 -120", () => {
    const hire = new Date("2026-10-01T00:00:00Z");
    const input = { ...pre1056MonthInput(2026, 10, hire, OCT_SHIFT_DAYS, 0) };
    const withBirth = closeEmployeeMonth({
      ...input,
      birthDate: new Date("2008-10-14T00:00:00Z"),
    });
    expect(withBirth.balanceMinutes).toBe(stored.M18!.balanceMinutes);
    expect(withBirth.workedMinutes).toBe(stored.M18!.workedMinutes);
    expect(withBirth.expectedMinutes).toBe(stored.M18!.expectedMinutes);
    expect(closeEmployeeMonth(input).balanceMinutes).toBe(-120);
  });
});
