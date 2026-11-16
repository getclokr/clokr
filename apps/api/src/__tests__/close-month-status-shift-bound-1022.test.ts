/**
 * Issue #1022 — the close-month status reads a SHIFT_BASED person's roster with the month's
 * calendar-day bounds.
 *
 * The status passed the INSTANT of the tenant-local month start (local Oct 1 00:00 in
 * Europe/Berlin = 2025-09-30T22:00Z) to `getShiftsInRange`. `Shift.date` is `@db.Date`, which
 * Postgres compares with the UTC DATE of that instant, so the shift of 30.09. became an expected
 * day of October; October's entries never contain it, so 30.09. was listed as missing in
 * October (the #493 class). The close writer (`month-gap-check.ts`) already used `monthFirstDay`.
 *
 * Fixture (dates fixed, 2025): d.employee is SHIFT_BASED, hired 01.09.2025, shifts on 30.09. and
 * 01.10., one entry on 01.10. only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  salonIdForEmployee,
} from "./setup";

type StatusRow = { employeeId: string; status: string; missingDates?: string[] };

describe("Issue #1022 — close-month status roster bound (SHIFT_BASED)", () => {
  let app: FastifyInstance;
  let d: Awaited<ReturnType<typeof seedTestData>>;

  async function statusRow(month: number): Promise<StatusRow> {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/overtime/close-month/status?year=2025&month=${month}`,
      headers: { authorization: `Bearer ${d.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const row = (JSON.parse(res.body).employees as StatusRow[]).find(
      (r) => r.employeeId === d.employee.id,
    );
    expect(row).toBeDefined();
    return row as StatusRow;
  }

  beforeAll(async () => {
    app = await getTestApp();
    d = await seedTestData(app, "csb1022");
    const hire = new Date("2025-09-01T00:00:00Z");
    await app.prisma.employee.update({ where: { id: d.employee.id }, data: { hireDate: hire } });
    await app.prisma.workSchedule.updateMany({
      where: { employeeId: d.employee.id },
      data: {
        type: "SHIFT_BASED",
        contractWorkDaysPerWeek: 5,
        usualWorkDays: [1, 2, 3, 4, 5],
        validFrom: hire,
      },
    });
    const salonId = await salonIdForEmployee(app.prisma, d.employee.id);
    for (const day of ["2025-09-30", "2025-10-01"]) {
      await app.prisma.shift.create({
        data: {
          employeeId: d.employee.id,
          salonId,
          date: new Date(`${day}T00:00:00Z`),
          startTime: "09:00",
          endTime: "17:00",
        },
      });
    }
    await app.prisma.timeEntry.create({
      data: {
        employeeId: d.employee.id,
        date: new Date("2025-10-01T00:00:00Z"),
        startTime: new Date("2025-10-01T07:00:00Z"),
        endTime: new Date("2025-10-01T15:00:00Z"),
        breakMinutes: 30,
        breakStatus: "CONFIRMED",
        isLocked: false,
        type: "WORK",
        source: "MANUAL",
        salonId,
      },
    });
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, d.tenant.id);
    } catch (err) {
      console.error("close-month-status-shift-bound-1022 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("October does not list 30.09. as a missing day", async () => {
    expect((await statusRow(10)).missingDates ?? []).toEqual([]);
  });

  it("September lists 30.09. as missing (control: the shift belongs to September)", async () => {
    expect((await statusRow(9)).missingDates).toEqual(["2025-09-30"]);
  });
});
