/**
 * Issue #1075 — shared fixtures of the roster write-path tests (`shift-write-single-1075.test.ts`,
 * `shift-write-collective-1075.test.ts`): a future week anchored on the live clock, persons with a
 * contract and a Stammsalon, and stored shifts. No test lives here (not a `.test.ts` file).
 *
 * Synthetic names only.
 */
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { grantSystemRole, type seedTestData } from "./setup";
import { dbDateStr, dowOf, futureDateStr, utcMidnight } from "./test-dates";

export type SeedData = Awaited<ReturnType<typeof seedTestData>>;

const add = (iso: string, n: number): string =>
  dbDateStr(new Date(utcMidnight(iso).getTime() + n * 86_400_000));

/** The first Monday at least 14 days ahead, so every day of its week and the next is in the future. */
function anchorMonday(): string {
  let d = futureDateStr(14);
  while (dowOf(d) !== 1) d = add(d, 1);
  return d;
}

export const WEEK_MONDAY = anchorMonday();

/** `n` days after the anchor Monday (0..6 this week, 7..13 the following week). */
export const day = (n: number): string => add(WEEK_MONDAY, n);

/** Monday-based weekday index (0 = Monday) of a day offset: the anchor is a Monday. */
export const weekdayIndex = (n: number): number => n % 7;

export interface PersonOptions {
  birth?: string | null;
  /** `validFrom` of the contract (default 2024-09-01). */
  contractFrom?: string;
  /** No contract row at all. */
  noContract?: boolean;
}

export async function mkPerson(
  app: FastifyInstance,
  data: SeedData,
  label: string,
  opts: PersonOptions = {},
): Promise<string> {
  const s = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const user = await app.prisma.user.create({
    data: {
      email: `${s}@example.invalid`,
      passwordHash: await bcrypt.hash("test1234", 4),
      isActive: true,
    },
  });
  const employee = await app.prisma.employee.create({
    data: {
      tenantId: data.tenant.id,
      userId: user.id,
      employeeNumber: s.toUpperCase().slice(0, 20),
      firstName: label,
      lastName: "Write1075",
      hireDate: new Date("2024-09-01T00:00:00Z"),
      birthDate: opts.birth ? new Date(`${opts.birth}T00:00:00Z`) : null,
    },
  });
  await grantSystemRole(app.prisma, {
    tenantId: data.tenant.id,
    userId: user.id,
    role: "EMPLOYEE",
  });
  if (!opts.noContract) {
    await app.prisma.workSchedule.create({
      data: {
        employeeId: employee.id,
        type: "SHIFT_BASED",
        weeklyHours: 40,
        validFrom: new Date(`${opts.contractFrom ?? "2024-09-01"}T00:00:00Z`),
      },
    });
  }
  await app.prisma.employeeSalonAssignment.create({
    data: {
      tenantId: data.tenant.id,
      employeeId: employee.id,
      salonId: data.salonId,
      kind: "HOME",
      validFrom: new Date("2024-09-01T00:00:00Z"),
      validUntil: null,
    },
  });
  return employee.id;
}

export async function storedShift(
  app: FastifyInstance,
  data: SeedData,
  employeeId: string,
  dateIso: string,
  start: string,
  end: string,
  extra: {
    deletedAt?: Date;
    deletedReason?: string;
    conflictsWithLeave?: boolean;
    salonId?: string;
  } = {},
) {
  return app.prisma.shift.create({
    data: {
      employeeId,
      salonId: extra.salonId ?? data.salonId,
      date: new Date(`${dateIso}T00:00:00Z`),
      startTime: start,
      endTime: end,
      ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
      ...(extra.deletedReason ? { deletedReason: extra.deletedReason } : {}),
      ...(extra.conflictsWithLeave ? { conflictsWithLeave: true } : {}),
    },
  });
}

/** The person's live (not removed) shifts in a stable order. */
export async function liveShifts(app: FastifyInstance, employeeId: string) {
  return app.prisma.shift.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });
}

/** Count of Shift CREATE / SHIFT_COPIED audit rows of the given persons' shifts (ids resolved from the table). */
export async function shiftCreateAuditCount(app: FastifyInstance): Promise<number> {
  return app.prisma.auditLog.count({
    where: { entity: "Shift", action: { in: ["CREATE", "SHIFT_COPIED"] } },
  });
}
