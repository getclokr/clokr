/**
 * Issue #1136 - audit-1136-shift-sick-without-roster.ts is a read-only listing.
 *
 * The pure cases run the REAL `closeEmployeeMonth` on a literal input (the measured case of the
 * issue: SHIFT_BASED 38 h / 4 days, November 2026, SICK Tue 3.-Fri 6., shifts on Thu 5. / Fri 6. and
 * on 10.-13., 17.-20., 24.-27.). The integration case runs `main` against a seeded tenant: one
 * SHIFT_BASED person has an unplanned sick Tuesday in September 2026 (month closed) and an unplanned
 * sick Wednesday in October 2026 (open); a control person's sick day HAS a shift and a FIXED_SCHEDULE
 * person's sick day has no roster at all - neither is listed. The case executes the real queries,
 * asserts that no row changes and that no person name reaches the output.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import {
  getTestApp,
  closeTestApp,
  seedTestData,
  cleanupTestData,
  grantSystemRole,
} from "../../src/__tests__/setup";
import { saldoSnapshotPeriodBounds } from "../../src/__tests__/test-dates";
import {
  closeEmployeeMonth,
  toCloseMonthApprovedLeave,
  type CloseMonthInput,
} from "../../src/contexts/working-time-account/close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../../src/contexts/working-time-account/timezone";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  formatMonthLine,
  main,
  monthFindingFromCore,
  parseCli,
  signed,
  type MonthMeta,
} from "../audit-1136-shift-sick-without-roster";

const TZ = "Europe/Berlin";
const D = (s: string) => new Date(s + "T00:00:00Z");
const nov = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;
const { start: NOV_START, end: NOV_END } = monthRangeUtc(2026, 11, TZ);
const { firstDay: NOV_FIRST, lastDay: NOV_LAST } = monthDayBounds(NOV_START, NOV_END, TZ);

const SB_38_4_TUE_FRI = {
  type: "SHIFT_BASED",
  weeklyHours: 38,
  contractWorkDaysPerWeek: 4,
  workDays: [2, 3, 4, 5],
  usualWorkDays: [2, 3, 4, 5],
  mondayHours: 0,
  tuesdayHours: 9.5,
  wednesdayHours: 9.5,
  thursdayHours: 9.5,
  fridayHours: 9.5,
  saturdayHours: 0,
  sundayHours: 0,
};

/** 07:45-18:00 (615 min brutto, 45 min break -> 570 netto) on the given November days. */
const shiftDays = (days: number[]) =>
  days.map((d) => ({ date: D(nov(d)), startTime: "07:45", endTime: "18:00" }));
const workDays = (days: number[], end = "18:00") =>
  days.map((d) => ({
    date: D(nov(d)),
    startTime: new Date(`${nov(d)}T07:45:00Z`),
    endTime: new Date(`${nov(d)}T${end}:00Z`),
    breakMinutes: 45,
  }));

const MEASURED_SHIFT_DAYS = [5, 6, 10, 11, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27];
const UNCOVERED_DAYS = MEASURED_SHIFT_DAYS.filter((d) => d >= 10);

function measuredInput(entries: CloseMonthInput["entries"], shiftList = MEASURED_SHIFT_DAYS) {
  return {
    employeeId: "x",
    monthStart: NOV_START,
    monthEnd: NOV_END,
    monthFirstDay: NOV_FIRST,
    monthLastDay: NOV_LAST,
    tz: TZ,
    carryOverIn: 0,
    schedule: SB_38_4_TUE_FRI,
    hireDate: D("2025-01-01"),
    exitDate: null,
    isTimeTrackingExempt: false as const,
    breakOver6hOverride: null,
    breakOver9hOverride: null,
    entries,
    shifts: shiftDays(shiftList),
    approvedLeave: toCloseMonthApprovedLeave([
      { startDate: D(nov(3)), endDate: D(nov(6)), halfDay: false, leaveType: { code: "SICK" } },
    ]),
    absences: [],
    holidayDateStrings: new Set<string>(),
    tenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
  } satisfies CloseMonthInput;
}

const META: MonthMeta = {
  tenantId: "t-1",
  employeeId: "e-1",
  monthLabel: "2026-11",
  state: "OPEN",
  snapshotId: null,
  locked: null,
  storedBalanceMinutes: null,
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

describe("monthFindingFromCore (pure, real closeEmployeeMonth)", () => {
  it("measured case with W = R: Soll relief 1140, balance delta 0", () => {
    const result = closeEmployeeMonth(measuredInput(workDays(UNCOVERED_DAYS)));
    expect(monthFindingFromCore(result, META)).toMatchObject({
      sollReliefMinutes: 1140,
      balanceDeltaMinutes: 0,
    });
  });

  it("the same month worked 30 minutes longer on every rostered day: delta +360", () => {
    const result = closeEmployeeMonth(measuredInput(workDays(UNCOVERED_DAYS, "18:30")));
    expect(monthFindingFromCore(result, META)).toMatchObject({
      sollReliefMinutes: 1140,
      balanceDeltaMinutes: 360,
    });
  });

  it("a month whose sick days all have a shift yields null", () => {
    const allPlanned = [3, 4, 5, 6, 10, 11, 12, 13];
    const result = closeEmployeeMonth(measuredInput(workDays(allPlanned), allPlanned));
    expect(monthFindingFromCore(result, META)).toBeNull();
  });

  it("formatMonthLine prints ids, month, state and signed minutes only", () => {
    const open = formatMonthLine({ ...META, sollReliefMinutes: 570, balanceDeltaMinutes: 0 });
    expect(open).toBe(
      "month tenantId=t-1 employeeId=e-1 month=2026-11 state=OPEN sollReliefMinutes=+570 balanceDeltaMinutes=0",
    );
    const closed = formatMonthLine({
      ...META,
      state: "CLOSED",
      snapshotId: "s-1",
      locked: false,
      storedBalanceMinutes: -30,
      sollReliefMinutes: 570,
      balanceDeltaMinutes: 570,
    });
    expect(closed).toBe(
      "month tenantId=t-1 employeeId=e-1 month=2026-11 state=CLOSED snapshotId=s-1 locked=false storedBalanceMinutes=-30 sollReliefMinutes=+570 balanceDeltaMinutes=+570",
    );
    expect(signed(-5)).toBe("-5");
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
  let controlId: string;
  const names: string[] = [];

  beforeAll(async () => {
    app = await getTestApp();
    data = await seedTestData(app, "a1136");
    clean = await seedTestData(app, "b1136");
  });

  afterAll(async () => {
    try {
      await cleanupTestData(app, data.tenant.id);
      await cleanupTestData(app, clean.tenant.id);
    } finally {
      await closeTestApp();
    }
  });

  const sbSchedule = (employeeId: string) => ({
    employeeId,
    type: "SHIFT_BASED" as const,
    weeklyHours: 38,
    contractWorkDaysPerWeek: 4,
    workDays: [2, 3, 4, 5],
    usualWorkDays: [2, 3, 4, 5],
    mondayHours: 0,
    tuesdayHours: 9.5,
    wednesdayHours: 9.5,
    thursdayHours: 9.5,
    fridayHours: 9.5,
    saturdayHours: 0,
    sundayHours: 0,
    validFrom: D("2026-09-01"),
  });

  it("lists the closed September and the open October of the SHIFT_BASED person, nobody else, and changes no row", async () => {
    const prisma = app.prisma;
    const tenantId = data.tenant.id;
    const employeeId = data.employee.id;
    const fixedId = data.adminEmployee.id;

    await prisma.workSchedule.create({ data: sbSchedule(employeeId) });

    // Control person: SHIFT_BASED, the sick Tuesday HAS a planned shift.
    const controlUser = await prisma.user.create({
      data: {
        email: `control-1136-${Date.now().toString(36)}@test.invalid`,
        passwordHash: await bcrypt.hash("test1234", 4),
        isActive: true,
      },
    });
    const control = await prisma.employee.create({
      data: {
        tenantId,
        userId: controlUser.id,
        employeeNumber: `CTRL-1136-${Date.now().toString(36)}`,
        firstName: "Control",
        lastName: "Person",
        hireDate: D("2024-01-01"),
      },
    });
    controlId = control.id;
    await grantSystemRole(prisma, { tenantId, userId: controlUser.id, role: "EMPLOYEE" });
    await prisma.workSchedule.create({ data: sbSchedule(controlId) });
    await prisma.shift.create({
      data: {
        employeeId: controlId,
        salonId: data.salonId,
        date: D("2026-09-08"),
        startTime: "07:45",
        endTime: "18:00",
      },
    });
    names.push(
      data.employee.firstName,
      data.employee.lastName,
      data.adminEmployee.firstName,
      control.firstName,
      control.lastName,
    );

    const sick = await prisma.leaveType.create({
      data: { tenantId, code: "SICK", name: "Krank 1136", isPaid: true },
    });
    const approve = (employee: string, day: string) =>
      prisma.leaveRequest.create({
        data: {
          employeeId: employee,
          leaveTypeId: sick.id,
          startDate: D(day),
          endDate: D(day),
          days: 1,
          status: "APPROVED",
          halfDay: false,
        },
      });
    await approve(employeeId, "2026-09-08"); // Tuesday, unplanned, month closed below
    await approve(employeeId, "2026-10-07"); // Wednesday, unplanned, month stays open
    await approve(controlId, "2026-09-08"); // Tuesday WITH a shift
    await approve(fixedId, "2026-09-08"); // FIXED_SCHEDULE person, no roster at all

    const bounds = saldoSnapshotPeriodBounds(D("2026-09-01"));
    const snapshot = await prisma.saldoSnapshot.create({
      data: {
        employeeId,
        periodType: "MONTHLY",
        periodStart: bounds.start,
        periodEnd: bounds.end,
        workedMinutes: 0,
        expectedMinutes: 8000,
        balanceMinutes: -8000,
        carryOver: -8000,
        closedAt: new Date("2026-10-01T05:00:00Z"),
      },
    });

    const rowsOfTenant = async () => ({
      snapshots: await prisma.saldoSnapshot.findMany({
        where: { employee: { tenantId } },
        orderBy: { id: "asc" },
      }),
      leave: await prisma.leaveRequest.findMany({
        where: { employee: { tenantId } },
        orderBy: { id: "asc" },
      }),
      schedules: await prisma.workSchedule.findMany({
        where: { employee: { tenantId } },
        orderBy: { id: "asc" },
      }),
      shifts: await prisma.shift.findMany({
        where: { employee: { tenantId } },
        orderBy: { id: "asc" },
      }),
    });
    const before = await rowsOfTenant();

    const { code, lines } = await captureMain(["--tenant-id", tenantId], prisma);

    expect(code).toBe(EXIT_FINDINGS);
    expect(await rowsOfTenant()).toEqual(before);

    const monthLines = lines.filter((l) => l.startsWith("month "));
    expect(monthLines).toHaveLength(2);
    const sep = monthLines.find((l) => l.includes("month=2026-09"));
    const oct = monthLines.find((l) => l.includes("month=2026-10"));
    expect(sep).toBeDefined();
    expect(oct).toBeDefined();
    expect(sep).toContain(`employeeId=${employeeId}`);
    expect(sep).toContain("state=CLOSED");
    expect(sep).toContain(`snapshotId=${snapshot.id}`);
    expect(sep).toContain("locked=");
    expect(sep).toContain("storedBalanceMinutes=-8000");
    expect(sep).toContain("sollReliefMinutes=+570");
    expect(oct).toContain(`employeeId=${employeeId}`);
    expect(oct).toContain("state=OPEN");
    expect(oct).toContain("sollReliefMinutes=+570");

    const all = lines.join("\n");
    // The control person and the FIXED_SCHEDULE person are not listed.
    expect(all).not.toContain(controlId);
    expect(all).not.toContain(fixedId);
    // Ids and minutes only: no fixture name reaches the output.
    for (const name of names) expect(all).not.toContain(name);
  });

  it("returns EXIT_OK for a tenant without a sick day on a SHIFT_BASED contract", async () => {
    const { code, lines } = await captureMain(["--tenant-id", clean.tenant.id], app.prisma);
    expect(code).toBe(EXIT_OK);
    expect(lines.filter((l) => l.startsWith("month "))).toHaveLength(0);
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
