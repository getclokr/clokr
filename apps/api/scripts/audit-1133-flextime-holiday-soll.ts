/**
 * Audit tool - Issue #1133.
 *
 * Until #1133 the saldo core reduced the month Soll of a FLEXTIME contract for every public
 * holiday by the holiday weekday's `{day}Hours` column. For FLEXTIME those columns are a legacy
 * 1/0 flag, not hours (.claude/rules/schedule-types.md), while the month Soll itself is the
 * Ø-Methode over the contract workdays. So a holiday on a contract workday reduced the Soll by
 * 1:00 instead of the Ø-day, and a holiday on a flagged non-contract weekday reduced it by 1:00
 * although that day held no Soll. Since #1133 a holiday takes exactly the Ø-day share
 * (`calcLeaveAbsenceMinutesTz`, the same kernel as a leave day). Closed months are never
 * recalculated, so months closed BEFORE the fix keep their stored figures. This script lists
 * that Bestand so the owner can decide about a deliberate, audited correction.
 *
 * What it lists, per (tenant, person, month) from the contract's first month through the
 * tenant-local current month: the month, whether it is closed (the shared `isMonthClosed` rule),
 * `lockedEntries` (the `isSnapshotLocked` rule, closed months only), the contract id, the
 * holidays at the work location inside the employment window, and `sollTooHighMinutes` =
 * Σ (Ø-day share − old `{day}Hours` × 60) over those holidays. Positive: the old rule left the
 * Soll too high (the saldo too low) by that many minutes; negative: too low. Months with a zero
 * difference are not listed. The contract is the one valid at the month end (a mid-month contract
 * change is approximated, as in audit-1080). Persons exempt from time tracking (§ 18) are skipped.
 *
 * READ-ONLY. ZERO mutations, no write flag (strict argument parsing rejects --confirm). Closed
 * months stay unchanged; a correction runs only through the month correction of #599 after an
 * owner decision. Open months correct themselves at their next computation. Output contains ids,
 * months, dates, flags and minutes only (DSGVO) - no name, number or mail column is ever selected.
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx scripts/audit-1133-flextime-holiday-soll.ts \
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
  todayInTz,
  calcLeaveAbsenceMinutesTz,
  getDayHoursFromSchedule,
  getDayOfWeekInTz,
  isMonthClosed,
  isSnapshotLocked,
} from "../src/contexts/working-time-account";
import { holidaysAtWorkLocation } from "../src/contexts/platform";
import { getWorkedEntriesInRange } from "../src/contexts/time-tracking";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FINDINGS = 2;

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
  DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx scripts/audit-1133-flextime-holiday-soll.ts \\
    ( --tenant-id <uuid> | --all-tenants ) [--help]

READ-ONLY - lists FLEXTIME months whose holiday Soll reduction the old rule took from the 1/0
{day}Hours flag instead of the Ø-day (Issue #1133). ids and minutes only. Correction of a closed
month only through the month correction of #599.
`;

/**
 * Pure: per holiday, the new reduction (Ø-day share, 0 on a non-contract weekday) minus the old
 * one (`{day}Hours` × 60). The sum is how much the old rule left the Soll too high.
 */
export function holidaySollDifference(
  schedule: Record<string, unknown>,
  holidayDates: readonly string[],
  tz: string,
): { dates: string[]; sollTooHighMinutes: number } {
  let diff = 0;
  const dates: string[] = [];
  for (const ds of holidayDates) {
    const d = new Date(ds + "T00:00:00Z");
    const now = calcLeaveAbsenceMinutesTz(schedule, d, d, tz);
    const old = getDayHoursFromSchedule(schedule, getDayOfWeekInTz(d, tz)) * 60;
    if (now === old) continue;
    diff += now - old;
    dates.push(ds);
  }
  return { dates, sollTooHighMinutes: Math.round(diff) };
}

export type Finding = {
  tenantId: string;
  employeeId: string;
  month: string; // YYYY-MM
  scheduleId: string;
  closed: boolean;
  lockedEntries: boolean | "n/a";
  holidays: string[];
  sollTooHighMinutes: number;
};

export function formatFindingLine(f: Finding): string {
  return (
    `finding tenantId=${f.tenantId} employeeId=${f.employeeId} month=${f.month} ` +
    `scheduleId=${f.scheduleId} closed=${f.closed} lockedEntries=${f.lockedEntries} ` +
    `holidays=${f.holidays.join(",")} sollTooHighMinutes=${f.sollTooHighMinutes}`
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
      const todayStr = dateStrInTz(todayInTz(tz), tz);

      // Persons who ever held a FLEXTIME contract. Ids and dates only.
      const flexRows = await prisma.workSchedule.findMany({
        where: { type: "FLEXTIME", employee: { tenantId: tenant.id } },
        select: { employeeId: true, validFrom: true },
        orderBy: [{ employeeId: "asc" }, { validFrom: "asc" }],
      });
      const personIds = [...new Set(flexRows.map((r) => r.employeeId))];
      if (personIds.length === 0) continue;

      const employees = await prisma.employee.findMany({
        where: { tenantId: tenant.id, id: { in: personIds } },
        select: { id: true, hireDate: true, exitDate: true, isTimeTrackingExempt: true },
        orderBy: { id: "asc" },
      });

      for (const emp of employees) {
        if (emp.isTimeTrackingExempt) continue; // § 18: no Soll
        const firstFlex = flexRows.find((r) => r.employeeId === emp.id)!.validFrom;
        const hireStr = dateStrInTz(emp.hireDate, tz);
        const exitStr = emp.exitDate ? dateStrInTz(emp.exitDate, tz) : null;
        const startStr = [dateStrInTz(firstFlex, tz), hireStr].sort()[1];
        const lastStr = exitStr !== null && exitStr < todayStr ? exitStr : todayStr;

        let year = Number(startStr.slice(0, 4));
        let monthNo = Number(startStr.slice(5, 7));
        while (`${year}-${String(monthNo).padStart(2, "0")}` <= lastStr.slice(0, 7)) {
          const monthKey = `${year}-${String(monthNo).padStart(2, "0")}`;
          const { start: monthStart, end: monthEnd } = monthRangeUtc(year, monthNo, tz);
          const { firstDay, lastDay } = monthDayBounds(monthStart, monthEnd, tz);
          monthNo++;
          if (monthNo > 12) {
            monthNo = 1;
            year++;
          }

          const schedule = await prisma.workSchedule.findFirst({
            where: { employeeId: emp.id, validFrom: { lte: monthEnd } },
            orderBy: { validFrom: "desc" },
          });
          if (!schedule || String(schedule.type) !== "FLEXTIME") continue;

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
          const holidayDates = [...(byEmployee.get(emp.id)?.keys() ?? [])]
            .filter((ds) => ds >= hireStr && (exitStr === null || ds <= exitStr))
            .sort();
          const { dates, sollTooHighMinutes } = holidaySollDifference(
            schedule as unknown as Record<string, unknown>,
            holidayDates,
            tz,
          );
          if (sollTooHighMinutes === 0) continue;

          const closed = await isMonthClosed(prisma, emp.id, tenant.id, monthStart);
          const lockedEntries = closed
            ? await isSnapshotLocked(prisma, emp.id, tenant.id, monthStart, monthEnd)
            : ("n/a" as const);

          findingCount++;
          totalMinutes += sollTooHighMinutes;
          if (closed) closedMonths++;
          else openMonths++;
          console.info(
            formatFindingLine({
              tenantId: tenant.id,
              employeeId: emp.id,
              month: monthKey,
              scheduleId: schedule.id,
              closed,
              lockedEntries,
              holidays: dates,
              sollTooHighMinutes,
            }),
          );
        }
      }
    }
    console.info(
      `summary findings=${findingCount} closedMonths=${closedMonths} openMonths=${openMonths} ` +
        `sollTooHighMinutes=${totalMinutes} readOnly=true`,
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
