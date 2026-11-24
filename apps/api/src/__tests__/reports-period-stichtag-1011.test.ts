/**
 * Issue #1011 — the period report counts the absences of the running month through ITS one
 * Stichtag, tenant-local yesterday: the same day Soll, Ist, Saldo (`closingAsOf`, #985) and the
 * vacation tables (`vacationStichtag`) already stop at.
 *
 * Before the fix the running month's absence counts (rows' `absence`, months' `sickDays`,
 * „Abwesenheiten nach Art“, `kpis.sickDays`, the absences CSV) came from the WHOLE calendar month, so
 * an approved vacation day of the 30th stood in the table while the tile „Urlaub genommen“ said
 * „bis 15.11.“. `/reports/monthly` (and with it the Stundennachweis, the Monatsexport and DATEV)
 * keeps the whole month.
 *
 * Fake clock 2026-11-16T10:00Z (a Monday); tenant-local yesterday = 2026-11-15. Synthetic persons.
 *   Person V (FIXED_SCHEDULE 40 h Mo-Fr, VACATION entitlement 2026):
 *     VACATION 10.11. (Tue, past) and 30.11. (Mon, future)  -> counted through yesterday: 1
 *     SICK     05.11. (Thu, past) and 23.11. (Mon, future)  -> counted through yesterday: 1
 *   Person Z (Azubi): Berufsschule 12.11. (past) and 19.11. (future) -> counted: 1
 * The 1st-of-month case moves the clock to 2026-12-01T10:00Z: November is whole through 30.11.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp, seedTestData, cleanupTestData, reissueTokenNow } from "./setup";
import { createPopulationPerson } from "./population-fixtures-613";
import { absenceTypeFields, leaveTypeFields } from "../contexts/absence/leave-type";

const FAKE_NOW = "2026-11-16T10:00:00.000Z";
const FIRST_OF_DECEMBER = "2026-12-01T10:00:00.000Z";

type AbsenceCounts = Record<string, number>;
type PeriodRow = {
  employeeId: string;
  employeeNumber: string;
  sickDays: number;
  absence: AbsenceCounts;
  months: Array<{ year: number; month: number; sickDays: number }>;
};
type Period = {
  kpis: { sickDays: number; vacationTakenDays: number; closingAsOf: string };
  rows: PeriodRow[];
  vacation: { asOf: string };
  absences: Array<{ code: string; totalDays: number }>;
};
type MonthlyRow = { employeeId: string; vacationDays: number; sickDays: number };

describe("Issue #1011 — absences of the running month count through the report's Stichtag", () => {
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof seedTestData>>;
  let v: { employeeId: string; employeeNumber: string };
  let z: { employeeId: string; employeeNumber: string };

  const get = (url: string) =>
    app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${reissueTokenNow(app, data.adminToken)}` },
    });
  async function period(query: string): Promise<Period> {
    const res = await get(`/api/v1/reports/period?${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Period;
  }
  const rowOf = (p: Period, id: string) => p.rows.find((r) => r.employeeId === id)!;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FAKE_NOW));
    app = await getTestApp();
    data = await seedTestData(app, "rps1011");
    const hire = new Date("2025-01-01T00:00:00Z");
    const mk = async (tag: string) => {
      const p = await createPopulationPerson(app, {
        tenantId: data.tenant.id,
        salonId: data.salonId,
        tag,
        hireDate: hire,
      });
      return { employeeId: p.employeeId, employeeNumber: p.employeeNumber };
    };
    v = await mk("V1011");
    z = await mk("Z1011");
    await app.prisma.employee.update({
      where: { id: z.employeeId },
      data: { classification: "AZUBI", birthDate: new Date("2008-06-01") },
    });
    const sick = await app.prisma.leaveType.create({
      data: { tenantId: data.tenant.id, ...leaveTypeFields("SICK"), color: "#EF4444" },
    });
    await app.prisma.leaveEntitlement.create({
      data: {
        employeeId: v.employeeId,
        leaveTypeId: data.vacationType.id,
        year: 2026,
        totalDays: 30,
        usedDays: 0,
      },
    });
    const leave = (leaveTypeId: string, day: string) =>
      app.prisma.leaveRequest.create({
        data: {
          employeeId: v.employeeId,
          leaveTypeId,
          status: "APPROVED",
          startDate: new Date(`${day}T00:00:00Z`),
          endDate: new Date(`${day}T00:00:00Z`),
          days: 1,
        },
      });
    await leave(data.vacationType.id, "2026-11-10");
    await leave(data.vacationType.id, "2026-11-30");
    await leave(sick.id, "2026-11-05");
    await leave(sick.id, "2026-11-23");
    for (const day of ["2026-11-12", "2026-11-19"]) {
      await app.prisma.absence.create({
        data: {
          employeeId: z.employeeId,
          ...absenceTypeFields("VOCATIONAL_SCHOOL"),
          source: "PATTERN",
          startDate: new Date(`${day}T00:00:00.000Z`),
          endDate: new Date(`${day}T00:00:00.000Z`),
          days: 1,
          halfDay: false,
          createdBy: "system",
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    try {
      await cleanupTestData(app, data.tenant.id);
    } catch (err) {
      console.error("reports-period-stichtag-1011 cleanup failed:", err);
    }
    await closeTestApp();
  });

  it("counts vacation, sick days and Berufsschule through tenant-local yesterday", async () => {
    const p = await period("from=2026-01&to=2026-11");
    expect(p.kpis.closingAsOf).toBe("2026-11-15");
    expect(p.vacation.asOf).toBe("2026-11-15");
    const vr = rowOf(p, v.employeeId);
    expect(vr.absence.VACATION).toBe(1); // 10.11.; the 30.11. is still to come
    expect(vr.absence.SICK).toBe(1); // 05.11.; the 23.11. is still to come
    expect(vr.sickDays).toBe(1);
    expect(vr.months.find((m) => m.year === 2026 && m.month === 11)!.sickDays).toBe(1);
    expect(rowOf(p, z.employeeId).absence.VOCATIONAL_SCHOOL).toBe(1); // 12.11.; 19.11. is future
  });

  it("the table, the tile „Urlaub genommen“ and „Krankheitstage“ say the same", async () => {
    const p = await period("from=2026-01&to=2026-11");
    const vacationLine = p.absences.find((a) => a.code === "VACATION")!;
    const sumOfRows = p.rows.reduce((s, r) => s + r.absence.VACATION, 0);
    expect(vacationLine.totalDays).toBe(sumOfRows);
    expect(p.kpis.vacationTakenDays).toBe(sumOfRows);
    expect(p.kpis.sickDays).toBe(p.rows.reduce((s, r) => s + r.sickDays, 0));
  });

  it("/reports/monthly keeps counting the whole month", async () => {
    const res = await get("/api/v1/reports/monthly?year=2026&month=11");
    expect(res.statusCode, res.body).toBe(200);
    const row = (JSON.parse(res.body) as { rows: MonthlyRow[] }).rows.find(
      (r) => r.employeeId === v.employeeId,
    )!;
    expect(row.vacationDays).toBe(2);
    expect(row.sickDays).toBe(2);
  });

  it("the absences CSV is the same assembly: the vacation of V reads 1", async () => {
    const res = await get("/api/v1/reports/period/csv?from=2026-11&to=2026-11&table=absences");
    expect(res.statusCode, res.body).toBe(200);
    const lines = res.rawPayload.subarray(3).toString("utf8").split("\r\n");
    const line = lines.find((l) => l.startsWith(`${v.employeeNumber};`));
    expect(line).toBeDefined();
    // Columns: number; name; Krank; Kinderkrank; Urlaub (Arbeitstage); ...
    expect(Number(line!.split(";")[4].replace(",", "."))).toBe(1);
  });

  it("on the 1st of a month the running month contributes no absence day", async () => {
    vi.setSystemTime(new Date(FIRST_OF_DECEMBER));
    try {
      const p = await period("from=2026-11&to=2026-12");
      expect(p.kpis.closingAsOf).toBe("2026-11-30");
      const vr = rowOf(p, v.employeeId);
      // November is whole through the 30th: both vacation days; December adds none.
      expect(vr.absence.VACATION).toBe(2);
      expect(vr.absence.SICK).toBe(2);
      expect(vr.months.find((m) => m.year === 2026 && m.month === 12)?.sickDays ?? 0).toBe(0);
    } finally {
      vi.setSystemTime(new Date(FAKE_NOW));
    }
  });
});
