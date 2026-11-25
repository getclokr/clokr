/**
 * Audit tool - Issue #1080.
 *
 * Until #1080 the saldo core reduced the Soll of a Berufsschultag a second time whenever an
 * imposed absence of another code (OTHER, MATERNITY, PARENTAL) covered that day: the Berufsschule
 * already relieves the day (subtract-then-recredit for weekly-hours contracts, an Ist-only credit
 * for MONTHLY_HOURS), and the absence credited the same day again. Since #1080 "Berufsschule hat
 * Vorrang" (`bsDayPriority()` in `close-employee-month.ts`) and a day reduces the Soll exactly
 * once. Closed months are never recalculated, so months closed BEFORE the rule keep their stored
 * figures. This script lists that Bestand so the owner can decide about a deliberate, audited
 * correction.
 *
 * What it lists, per (tenant, person, month): the month, the schedule type of the contract valid
 * at the month end, whether the month is closed (a non-superseded MONTHLY SaldoSnapshot, the
 * shared `isMonthClosed` rule), `lockedEntries` (for a closed month: does a locked time entry
 * exist in it, the `isSnapshotLocked` rule - `snapshot-lock.ts` treats a closed month without any
 * locked entry as not locked, so a recalculation triggered from an earlier date could rewrite it;
 * no second lock definition is introduced here), the ids of the absences and of the Berufsschule
 * rows involved, the Berufsschultage and `doubleReducedMinutes`.
 *
 * Minutes (D-07): per affected Berufsschultag the per-day credit the old rule subtracted a second
 * time, through the same `calcLeaveAbsenceMinutesTz` call the core makes (half when only half-day
 * rows cover the day; for contracts other than SHIFT_BASED a holiday at the work location is
 * skipped, as the old dedup set skipped it), summed per month BEFORE the month's zero floor and
 * rounded per day (it may differ by a minute from a row-rounded figure). Affected day: for
 * FIXED_SCHEDULE / FLEXTIME / SHIFT_BASED a day with a PATTERN Berufsschule row and no MANUAL one
 * (a MANUAL row took part in the day dedup and was counted once already); for MONTHLY_HOURS any
 * Berufsschule row. For SHIFT_BASED the balance effect is at most this figure (the § 615 clauses).
 * Persons exempt from time tracking (§ 18) and months without a contract are skipped.
 *
 * READ-ONLY. ZERO mutations, no write flag (strict argument parsing rejects --confirm). Closed
 * months stay unchanged; a correction runs only through the month correction of #599 after an
 * owner decision. Open months correct themselves at their next computation. Output contains ids,
 * months, flags and minutes only (DSGVO) - no name, number or mail column is ever selected.
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx scripts/audit-1080-bs-day-absence-double-soll.ts \
 *     ( --tenant-id <uuid> | --all-tenants ) [--help]
 *
 * Exit codes: 0 no finding, 1 usage or database error, 2 findings.
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  getTenantTimezone,
  monthRangeUtc,
  monthDayBounds,
  dateStrInTz,
  calcLeaveAbsenceMinutesTz,
  isMonthClosed,
  isSnapshotLocked,
} from "../src/contexts/working-time-account";
import { holidaysAtWorkLocation } from "../src/contexts/platform";
import { getWorkedEntriesInRange } from "../src/contexts/time-tracking";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FINDINGS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CliArgs = { tenantId: string | null; allTenants: boolean; help: boolean };

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "tenant-id": { type: "string" },
      "all-tenants": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true, // rejects any unknown flag, in particular --confirm / --apply
  });
  return {
    tenantId: values["tenant-id"] ?? null,
    allTenants: Boolean(values["all-tenants"]),
    help: Boolean(values.help),
  };
}

export const USAGE = `
Usage:
  DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx scripts/audit-1080-bs-day-absence-double-soll.ts \\
    ( --tenant-id <uuid> | --all-tenants ) [--help]

READ-ONLY - lists months in which a Berufsschultag lay inside an imposed absence of another code
and the old saldo rule reduced its Soll twice (Issue #1080). ids and minutes only. Correction of a
closed month only through the month correction of #599.
`;

export type NonBsAbsenceRow = {
  id: string;
  startDate: Date;
  endDate: Date;
  halfDay: boolean | null;
};
export type BsAbsenceRow = { id: string; startDate: Date; endDate: Date; source: string };

export type OverlapDay = {
  absenceIds: string[];
  bsAbsenceIds: string[];
  /** At least one full-day non-Berufsschule row covers the day. */
  fullDay: boolean;
  hasPattern: boolean;
  hasManual: boolean;
};

function eachDay(start: Date, end: Date, tz: string, fn: (ds: string) => void): void {
  const last = dateStrInTz(end, tz);
  for (let cur = new Date(start.getTime()); ; cur = new Date(cur.getTime() + DAY_MS)) {
    const ds = dateStrInTz(cur, tz);
    if (ds > last) break;
    fn(ds);
  }
}

/**
 * Pure: the tenant-local days that a Berufsschule row AND a non-Berufsschule row both cover, with
 * the ids involved and what kind of rows they are.
 */
export function overlapDays(
  nonBs: readonly NonBsAbsenceRow[],
  bs: readonly BsAbsenceRow[],
  tz: string,
): Map<string, OverlapDay> {
  const covered = new Map<string, { ids: string[]; full: boolean }>();
  for (const ab of nonBs) {
    eachDay(ab.startDate, ab.endDate, tz, (ds) => {
      const cur = covered.get(ds) ?? { ids: [], full: false };
      cur.ids.push(ab.id);
      if (!ab.halfDay) cur.full = true;
      covered.set(ds, cur);
    });
  }
  const out = new Map<string, OverlapDay>();
  for (const row of bs) {
    eachDay(row.startDate, row.endDate, tz, (ds) => {
      const cover = covered.get(ds);
      if (!cover) return;
      const cur = out.get(ds) ?? {
        absenceIds: [...new Set(cover.ids)],
        bsAbsenceIds: [],
        fullDay: cover.full,
        hasPattern: false,
        hasManual: false,
      };
      cur.bsAbsenceIds.push(row.id);
      if (row.source === "PATTERN") cur.hasPattern = true;
      else cur.hasManual = true;
      out.set(ds, cur);
    });
  }
  return out;
}

/** D-07: does the old rule's second reduction apply to this day for this schedule type? */
export function isAffectedDay(scheduleType: string, d: OverlapDay): boolean {
  return scheduleType === "MONTHLY_HOURS" ? true : d.hasPattern && !d.hasManual;
}

export type Finding = {
  tenantId: string;
  employeeId: string;
  month: string; // YYYY-MM
  scheduleType: string;
  closed: boolean;
  lockedEntries: boolean | "n/a";
  absenceIds: string[];
  bsAbsenceIds: string[];
  bsDays: string[];
  doubleReducedMinutes: number;
};

export function formatFindingLine(f: Finding): string {
  return (
    `finding tenantId=${f.tenantId} employeeId=${f.employeeId} month=${f.month} ` +
    `scheduleType=${f.scheduleType} closed=${f.closed} lockedEntries=${f.lockedEntries} ` +
    `absenceIds=${f.absenceIds.join(",")} bsAbsenceIds=${f.bsAbsenceIds.join(",")} ` +
    `bsDays=${f.bsDays.join(",")} doubleReducedMinutes=${f.doubleReducedMinutes}`
  );
}

export async function main(argv: string[], injectedPrisma?: PrismaClient): Promise<number> {
  const args = parseCli(argv);
  if (args.help) {
    console.info(USAGE);
    return EXIT_OK;
  }
  if ((!args.tenantId && !args.allTenants) || (args.tenantId && args.allTenants)) {
    console.error(
      "Tenant-Auswahl erforderlich: bitte --tenant-id <uuid> ODER --all-tenants angeben.",
    );
    return EXIT_ERROR;
  }
  if (!injectedPrisma && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    return EXIT_ERROR;
  }

  let pool: pg.Pool | undefined;
  let prisma: PrismaClient;
  if (injectedPrisma) {
    prisma = injectedPrisma;
  } else {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma = new PrismaClient({ adapter: new PrismaPg(pool as any) });
  }

  try {
    const tenants = args.allTenants
      ? await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: "asc" } })
      : [{ id: args.tenantId! }];
    let findingCount = 0;
    let closedMonths = 0;
    let openMonths = 0;
    let totalMinutes = 0;

    for (const tenant of tenants) {
      const tz = await getTenantTimezone(prisma, tenant.id);
      const tenantConfig = await prisma.tenantConfig.findFirst({
        where: { tenantId: tenant.id },
        select: { defaultWorkDays: true },
      });

      // Ids, dates, codes and flags only - never a name, number or mail column.
      const [nonBs, bs] = await Promise.all([
        prisma.absence.findMany({
          where: {
            employee: { tenantId: tenant.id },
            deletedAt: null,
            type: { not: "VOCATIONAL_SCHOOL" },
          },
          select: { id: true, employeeId: true, startDate: true, endDate: true, halfDay: true },
          orderBy: [{ employeeId: "asc" }, { startDate: "asc" }, { id: "asc" }],
        }),
        prisma.absence.findMany({
          where: {
            employee: { tenantId: tenant.id },
            deletedAt: null,
            type: "VOCATIONAL_SCHOOL",
          },
          select: { id: true, employeeId: true, startDate: true, endDate: true, source: true },
          orderBy: [{ employeeId: "asc" }, { startDate: "asc" }, { id: "asc" }],
        }),
      ]);
      const personIds = [...new Set(nonBs.map((a) => a.employeeId))].filter((id) =>
        bs.some((b) => b.employeeId === id),
      );
      if (personIds.length === 0) continue;

      const employees = await prisma.employee.findMany({
        where: { tenantId: tenant.id, id: { in: personIds } },
        select: { id: true, hireDate: true, exitDate: true, isTimeTrackingExempt: true },
        orderBy: { id: "asc" },
      });

      for (const emp of employees) {
        if (emp.isTimeTrackingExempt) continue; // § 18: no Soll
        const overlap = overlapDays(
          nonBs.filter((a) => a.employeeId === emp.id),
          bs.filter((b) => b.employeeId === emp.id),
          tz,
        );
        // Inside the employment window (tenant-local days).
        const hireStr = dateStrInTz(emp.hireDate, tz);
        const exitStr = emp.exitDate ? dateStrInTz(emp.exitDate, tz) : null;
        const byMonth = new Map<string, string[]>();
        for (const ds of [...overlap.keys()].sort()) {
          if (ds < hireStr || (exitStr !== null && ds > exitStr)) continue;
          const key = ds.slice(0, 7);
          byMonth.set(key, [...(byMonth.get(key) ?? []), ds]);
        }

        for (const [monthKey, monthDays] of byMonth) {
          const year = Number(monthKey.slice(0, 4));
          const monthNo = Number(monthKey.slice(5, 7));
          const { start: monthStart, end: monthEnd } = monthRangeUtc(year, monthNo, tz);
          const { firstDay, lastDay } = monthDayBounds(monthStart, monthEnd, tz);

          // The contract valid at the month end; none -> no Soll to double-reduce.
          const schedule = await prisma.workSchedule.findFirst({
            where: { employeeId: emp.id, validFrom: { lte: monthEnd } },
            orderBy: { validFrom: "desc" },
          });
          if (!schedule) continue;
          const scheduleType = String(schedule.type);

          const affected = monthDays.filter((ds) => isAffectedDay(scheduleType, overlap.get(ds)!));
          if (affected.length === 0) continue;

          // A holiday at the work location was already skipped by the old dedup set - except
          // for SHIFT_BASED, whose contract side is not holiday-reduced.
          let holidays = new Set<string>();
          if (scheduleType !== "SHIFT_BASED") {
            const workEntries = await getWorkedEntriesInRange(
              prisma,
              { kind: "employee", employeeId: emp.id, tenantId: tenant.id },
              firstDay,
              lastDay,
            );
            const byEmployee = await holidaysAtWorkLocation(
              prisma,
              tenant.id,
              [emp.id],
              dateStrInTz(firstDay, tz),
              dateStrInTz(lastDay, tz),
              workEntries,
            );
            holidays = new Set<string>(byEmployee.get(emp.id)?.keys() ?? []);
          }

          let minutes = 0;
          const countedDays: string[] = [];
          const absenceIds = new Set<string>();
          const bsAbsenceIds = new Set<string>();
          for (const ds of affected) {
            if (holidays.has(ds)) continue;
            const d = overlap.get(ds)!;
            const dayDate = new Date(ds + "T00:00:00Z");
            const credit = calcLeaveAbsenceMinutesTz(
              schedule as unknown as Record<string, unknown>,
              dayDate,
              dayDate,
              tz,
              { halfDay: !d.fullDay, defaultWorkDays: tenantConfig?.defaultWorkDays },
            );
            if (credit <= 0) continue;
            minutes += credit;
            countedDays.push(ds);
            d.absenceIds.forEach((id) => absenceIds.add(id));
            d.bsAbsenceIds.forEach((id) => bsAbsenceIds.add(id));
          }
          if (minutes <= 0) continue;

          const closed = await isMonthClosed(prisma, emp.id, tenant.id, monthStart);
          const lockedEntries = closed
            ? await isSnapshotLocked(prisma, emp.id, tenant.id, monthStart, monthEnd)
            : ("n/a" as const);

          findingCount++;
          totalMinutes += minutes;
          if (closed) closedMonths++;
          else openMonths++;
          console.info(
            formatFindingLine({
              tenantId: tenant.id,
              employeeId: emp.id,
              month: monthKey,
              scheduleType,
              closed,
              lockedEntries,
              absenceIds: [...absenceIds].sort(),
              bsAbsenceIds: [...bsAbsenceIds].sort(),
              bsDays: countedDays,
              doubleReducedMinutes: minutes,
            }),
          );
        }
      }
    }
    console.info(
      `summary findings=${findingCount} closedMonths=${closedMonths} openMonths=${openMonths} ` +
        `minutes=${totalMinutes} readOnly=true`,
    );
    return findingCount > 0 ? EXIT_FINDINGS : EXIT_OK;
  } finally {
    if (pool) await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(EXIT_ERROR);
    });
}
