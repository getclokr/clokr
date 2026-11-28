/**
 * Issue #1156 — the carry-over deadline written by the rollover and read by the Hinweis warning
 * agree on the same Stichtag when the HOST is not on UTC.
 *
 * Both writers (`recalculateCarryOver`, `autoCarryOver`) used to build the Timestamptz with
 * `new Date(y, m - 1, d, 23, 59, 59)` in the host zone; the warning text read it with host-zone
 * getters and the audit value with the UTC date part. The cases run under zones east and west of UTC
 * (switched through `process.env.TZ`, restored afterwards) and read the stored row back. Fixed dates
 * only (2026/2027); the warning run pins `Date` with fake timers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  soleAuditRowOrNull,
  soleNotificationOrNull,
} from "./setup";
import { recalculateCarryOver } from "../contexts/absence/leave-days";
import { autoCarryOver } from "../contexts/absence/leave-request-create";
import { runCarryoverWarningOnce } from "../contexts/absence/plugins/carryover-warning";

const ORIGINAL_TZ = process.env.TZ;
// Control zones: the old construction lands on another instant (and, west of UTC, another UTC day).
const HOST_ZONES = ["Pacific/Auckland", "Europe/Berlin", "America/Los_Angeles"] as const;
const CANONICAL = "2027-03-31T23:59:59.000Z";

describe("Issue #1156 — carry-over deadline under a non-UTC host", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;

  async function mkEmployeeWithPrevYear(label: string): Promise<string> {
    const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const user = await app.prisma.user.create({
      data: { email: `cdtz-${label}-${uid}@test.de`, passwordHash: "x", isActive: true },
    });
    const employee = await app.prisma.employee.create({
      data: {
        tenantId: data.tenant.id,
        userId: user.id,
        employeeNumber: `CDTZ-${label}-${uid}`,
        firstName: "T",
        lastName: "T",
        hireDate: new Date(Date.UTC(2024, 0, 1)),
      },
    });
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "FIXED_SCHEDULE",
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
        validFrom: new Date(Date.UTC(2024, 0, 1)),
      },
    });
    await app.prisma.overtimeAccount.create({ data: { employeeId: employee.id, balanceHours: 0 } });
    // 2026: 30 days, 10 used, no carry of its own -> 20 days roll over into 2027.
    await app.prisma.leaveEntitlement.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.vacationType.id,
        year: 2026,
        totalDays: 30,
        usedDays: 10,
        carriedOverDays: 0,
        isAutoCalculated: true,
      },
    });
    return employee.id;
  }

  async function deadline2027(employeeId: string): Promise<Date | null> {
    const row = await app.prisma.leaveEntitlement.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: data.vacationType.id,
          year: 2027,
        },
      },
    });
    return row?.carryOverDeadline ?? null;
  }

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "cdtz");
  });

  afterAll(async () => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("Test cleanup failed:", err);
    }
    await closeTestApp();
  });

  for (const tz of HOST_ZONES) {
    it(`recalculateCarryOver stores 31 March 23:59:59Z under host zone ${tz}`, async () => {
      process.env.TZ = tz;
      // Control: the zone is in effect, the pre-#1156 construction would not have hit this instant.
      expect(new Date(2027, 2, 31, 23, 59, 59).toISOString()).not.toBe(CANONICAL);

      const employeeId = await mkEmployeeWithPrevYear(`rc-${tz.slice(0, 3)}`);
      await recalculateCarryOver(
        app.prisma,
        data.tenant.id,
        employeeId,
        data.vacationType.id,
        2027,
      );

      expect((await deadline2027(employeeId))?.toISOString()).toBe(CANONICAL);
    });

    it(`autoCarryOver stores 31 March 23:59:59Z under host zone ${tz}`, async () => {
      process.env.TZ = tz;
      expect(new Date(2027, 2, 31, 23, 59, 59).toISOString()).not.toBe(CANONICAL);

      const employeeId = await mkEmployeeWithPrevYear(`ac-${tz.slice(0, 3)}`);
      await autoCarryOver(app.prisma, data.tenant.id, employeeId, data.vacationType.id, 2027);

      expect((await deadline2027(employeeId))?.toISOString()).toBe(CANONICAL);
    });

    it(`the warning names the stored Stichtag in text and audit under host zone ${tz}`, async () => {
      process.env.TZ = tz;
      const employeeId = await mkEmployeeWithPrevYear(`wn-${tz.slice(0, 3)}`);
      await recalculateCarryOver(
        app.prisma,
        data.tenant.id,
        employeeId,
        data.vacationType.id,
        2027,
      );
      const row = await app.prisma.leaveEntitlement.findUniqueOrThrow({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: data.vacationType.id,
            year: 2027,
          },
        },
        include: { employee: { select: { userId: true } } },
      });

      // Exactly 30 days before the deadline instant -> the default 30-day threshold matches.
      vi.useFakeTimers({ now: new Date("2027-03-01T23:59:59Z"), toFake: ["Date"] });
      try {
        const res = await runCarryoverWarningOnce(app, { onlyEntitlementId: row.id });
        expect(res.warned).toBe(1);
      } finally {
        vi.useRealTimers();
      }

      const audit = await soleAuditRowOrNull(app.prisma, {
        where: { action: "CARRYOVER_WARNED", entity: "LeaveEntitlement", entityId: row.id },
      });
      expect((audit!.newValue as Record<string, unknown>).deadline).toBe("2027-03-31");

      const notif = await soleNotificationOrNull(app.prisma, {
        where: { userId: row.employee.userId, type: "CARRYOVER_EXPIRING" },
      });
      expect(notif!.title).toBe("Resturlaub verfällt am 31.03.2027");
      expect(notif!.message).toContain("verfällt am 31.03.2027.");
    });
  }
});
