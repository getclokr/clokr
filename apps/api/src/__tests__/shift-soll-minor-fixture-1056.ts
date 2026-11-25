/**
 * Issue #1056 — shared fixture of the roster-Soll-for-minors tests.
 *
 * One tenant (defaults 30/45, no auto break), an admin, and four SHIFT_BASED persons on the same
 * roster:
 *   M17    born 2009-10-14 — under 18 on every October shift day (17th birthday mid-month, no change)
 *   M18    born 2008-10-14 — under 18 on 12./13.10., adult from the 18th birthday on 14.10.
 *   ADULT  born 1990-01-01
 *   NONE   no birth date
 * Shifts Mon 12. to Thu 15.10.2026, 08:00-17:00, worked with 540 min presence and the 60 min break a
 * minor is prescribed (so a worked shift counts 480). With `closedSeptember` the same pattern exists
 * on Mon 14. to Thu 17.09.2026, closed under the pre-#1056 ADULT rule (balance -120 for everyone,
 * the entries locked), exactly as the code stored it before the fix.
 *
 * Every read in this module names an explicit orderBy (Issue #561). No real names or e-mails.
 */
import type { FastifyInstance } from "fastify";
import {
  closeEmployeeMonth,
  type CloseMonthInput,
} from "../contexts/working-time-account/close-employee-month";
import { monthRangeUtc, monthDayBounds } from "../contexts/working-time-account/timezone";
import { grantSystemRole, salonIdForEmployee, seedTestData } from "./setup";
import { saldoSnapshotPeriodBounds } from "./test-dates";

export const TZ = "Europe/Berlin";
export const OCT_SHIFT_DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];
export const SEP_SHIFT_DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
/** The clock every test of the phase pins: after both months ended, past the cron grace day. */
export const PINNED_NOW = "2026-11-10T10:00:00Z";

export type MinorFixturePerson = "M17" | "M18" | "ADULT" | "NONE";
export const PERSON_KEYS: MinorFixturePerson[] = ["M17", "M18", "ADULT", "NONE"];

const BIRTH_DATES: Record<MinorFixturePerson, string | null> = {
  M17: "2009-10-14",
  M18: "2008-10-14",
  ADULT: "1990-01-01",
  NONE: null,
};

export interface MinorShiftFixture {
  tenantId: string;
  adminToken: string;
  salonId: string;
  persons: Record<MinorFixturePerson, string>;
}

const SHIFT_SCHEDULE: Record<string, unknown> = {
  type: "SHIFT_BASED",
  weeklyHours: 40,
  mondayHours: 8,
  tuesdayHours: 8,
  wednesdayHours: 8,
  thursdayHours: 8,
  fridayHours: 8,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
  contractWorkDaysPerWeek: 5,
  usualWorkDays: [1, 2, 3, 4, 5],
};

const utc = (dateStr: string) => new Date(dateStr + "T00:00:00Z");

/** The core input of one fixture month, WITHOUT a birth date: the pre-#1056 (adult) rule. */
export function pre1056MonthInput(
  year: number,
  month: number,
  hireDate: Date,
  days: string[],
  carryOverIn: number,
): CloseMonthInput {
  const { start: monthStart, end: monthEnd } = monthRangeUtc(year, month, TZ);
  const { firstDay: monthFirstDay, lastDay: monthLastDay } = monthDayBounds(
    monthStart,
    monthEnd,
    TZ,
  );
  return {
    employeeId: "fixture-1056",
    monthStart,
    monthEnd,
    monthFirstDay,
    monthLastDay,
    tz: TZ,
    carryOverIn,
    schedule: SHIFT_SCHEDULE,
    hireDate,
    exitDate: null,
    isTimeTrackingExempt: false,
    breakOver6hOverride: null,
    breakOver9hOverride: null,
    entries: days.map((d) => ({
      date: utc(d),
      startTime: new Date(d + "T08:00:00Z"),
      endTime: new Date(d + "T17:00:00Z"),
      breakMinutes: 60,
    })),
    shifts: days.map((d) => ({ date: utc(d), startTime: "08:00", endTime: "17:00" })),
    approvedLeave: [],
    absences: [],
    holidayDateStrings: new Set<string>(),
    accountCorrections: [],
    tenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
  };
}

export async function seedMinorShiftFixture(
  app: FastifyInstance,
  tag: string,
  opts: { closedSeptember?: boolean } = {},
): Promise<MinorShiftFixture> {
  const prisma = app.prisma;
  const base = await seedTestData(app, tag);
  const tenantId = base.tenant.id;
  const salonId = base.salonId;
  const hire = opts.closedSeptember ? "2026-09-01" : "2026-10-01";
  const hireDate = utc(hire);
  const persons = {} as Record<MinorFixturePerson, string>;

  for (const key of PERSON_KEYS) {
    const birth = BIRTH_DATES[key];
    const user = await prisma.user.create({
      data: {
        email: `1056-${key.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
        passwordHash: "$2a$10$0000000000000000000000.0000000000000000000000000000000",
        isActive: true,
      },
    });
    const employee = await prisma.employee.create({
      data: {
        tenantId,
        userId: user.id,
        employeeNumber: String(10_000_000 + Math.floor(Math.random() * 900_000_000)),
        firstName: "Fix",
        lastName: `F1056${key}`,
        hireDate,
        birthDate: birth ? utc(birth) : null,
      },
    });
    await grantSystemRole(prisma, { tenantId, userId: user.id, role: "EMPLOYEE" });
    await prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "SHIFT_BASED",
        weeklyHours: 40,
        mondayHours: 8,
        tuesdayHours: 8,
        wednesdayHours: 8,
        thursdayHours: 8,
        fridayHours: 8,
        saturdayHours: 0,
        sundayHours: 0,
        workDays: [1, 2, 3, 4, 5],
        contractWorkDaysPerWeek: 5,
        usualWorkDays: [1, 2, 3, 4, 5],
        validFrom: hireDate,
      },
    });
    await prisma.overtimeAccount.create({ data: { employeeId: employee.id, balanceHours: 0 } });
    await prisma.employeeSalonAssignment.create({
      data: {
        tenantId,
        employeeId: employee.id,
        salonId,
        kind: "HOME",
        validFrom: hireDate,
        validUntil: null,
        weekdays: [],
      },
    });
    persons[key] = employee.id;

    const salon = await salonIdForEmployee(prisma, employee.id);
    const months: Array<{ days: string[]; locked: boolean }> = [
      { days: OCT_SHIFT_DAYS, locked: false },
    ];
    if (opts.closedSeptember) months.unshift({ days: SEP_SHIFT_DAYS, locked: true });
    for (const { days, locked } of months) {
      for (const d of days) {
        await prisma.shift.create({
          data: {
            employeeId: employee.id,
            salonId: salon,
            date: utc(d),
            startTime: "08:00",
            endTime: "17:00",
            deletedAt: null,
          },
        });
        await prisma.timeEntry.create({
          data: {
            employeeId: employee.id,
            date: utc(d),
            startTime: new Date(d + "T08:00:00Z"),
            endTime: new Date(d + "T17:00:00Z"),
            breakMinutes: 60,
            type: "WORK",
            salonId: salon,
            isLocked: locked,
          },
        });
      }
    }

    if (opts.closedSeptember) {
      // The September snapshot as the code stored it BEFORE #1056: the adult rule (no birthDate).
      const input = pre1056MonthInput(2026, 9, hireDate, SEP_SHIFT_DAYS, 0);
      const stored = closeEmployeeMonth({ ...input, employeeId: employee.id });
      if (stored.balanceMinutes !== -120) {
        throw new Error(
          `fixture: pre-#1056 September balance ${stored.balanceMinutes}, expected -120`,
        );
      }
      const { start, end } = saldoSnapshotPeriodBounds(utc("2026-09-01"), TZ);
      await prisma.saldoSnapshot.create({
        data: {
          employeeId: employee.id,
          periodType: "MONTHLY",
          periodStart: start,
          periodEnd: end,
          workedMinutes: stored.workedMinutes,
          expectedMinutes: stored.expectedMinutes,
          balanceMinutes: stored.balanceMinutes,
          carryOver: stored.balanceMinutes,
          closedAt: new Date("2026-10-05T08:00:00Z"),
          closedBy: "test-seed-1056",
        },
      });
    }
  }

  return { tenantId, adminToken: base.adminToken, salonId, persons };
}
