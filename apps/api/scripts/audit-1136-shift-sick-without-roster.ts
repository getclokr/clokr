/**
 * Audit tool - Issue #1136.
 *
 * Before #1136 an approved sick day (SICK, SICK_CHILD, SPECIAL - the ROSTER-basis codes of
 * `leaveCreditBasisForCode`) of a SHIFT_BASED person relieved the Soll only by the planned shift
 * netto of that day and by NOTHING on a day without a planned shift. Phorest is not reliably
 * maintained for absences, so since #1136 (owner decision 26.11.2026) such a day relieves the
 * contractual O-day on a usual workday of the person's Angabe (the vacation contract-week
 * distribution with an empty Angabe, never more than the week's contract Soll). A closed month
 * keeps the figures it was closed with, an open month follows the new rule at its next computation
 * once the release is deployed.
 *
 * This script lists, per tenant, person and COMPLETE month with such a sick day, the Soll relief and
 * the saldo delta the new rule adds:
 *   - CLOSED: a stored MONTHLY snapshot exists. The snapshot id, the lock flag and the stored
 *     balance are printed so the owner sees what was stored; the stored row is NEVER recomputed or
 *     rewritten by this script or by the code.
 *   - OPEN: the month is over but not closed yet; it follows the new rule when it is closed.
 * The running month is not listed - the live saldo follows the new rule on its own.
 *
 * Both figures are read from the REAL core, never re-derived here: one `closeEmployeeMonth` run per
 * person and month over the close-path inputs reports `rosterLeaveNoShift` = what the no-shift
 * fallback changed against the same input without it (in the close path that is exactly the
 * pre-#1136 rule): `sollReliefMinutes` = C_net without minus with the fallback, `balanceDeltaMinutes`
 * = balance with minus without it (positive = the new rule gives the person MORE saldo).
 *
 * READ-ONLY. ZERO mutations. There is no write flag and none may ever be added: `--confirm` /
 * `--apply` are rejected. Closed months are never recalculated; a correction runs only by hand,
 * through a Monatskorrektur (#599, four eyes) booked in the running month, never automatically.
 * Output contains ids, months, flags and minutes only - no name, no employee number, no mail, no
 * birth date (DSGVO).
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1136-shift-sick-without-roster.ts ( --tenant-id <uuid> | --all-tenants ) [--help]
 *
 * Exit codes: 0 nothing listed; 1 error or bad CLI; 2 one or more months listed.
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  closeEmployeeMonth,
  leaveCreditBasisForCode,
  resolveMonthContract,
  toCloseMonthApprovedLeave,
  type CloseMonthResult,
} from "../src/contexts/working-time-account/close-employee-month";
import {
  periodStartWindow,
  monthlySnapshotOrder,
} from "../src/contexts/working-time-account/snapshot-period";
import {
  getTenantTimezone,
  dateStrInTz,
  monthRangeUtc,
  monthDayBounds,
  isSnapshotLocked,
} from "../src/contexts/working-time-account";
import { holidaysAtWorkLocation } from "../src/contexts/platform";
import {
  getValidWorkedEntriesInRange,
  getWorkedEntriesInRange,
} from "../src/contexts/time-tracking";
import { getShiftsInRange } from "../src/contexts/scheduling";
import {
  getActiveLeaveOverlapping,
  getAbsencesOverlapping,
  loadBsSlotOverrides,
} from "../src/contexts/absence";

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
  DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \\
    scripts/audit-1136-shift-sick-without-roster.ts ( --tenant-id <uuid> | --all-tenants ) [--help]

READ-ONLY - lists, per tenant, person and complete month, the Soll relief and the saldo delta that the
Issue #1136 rule (an approved sick day without a planned shift relieves the contractual O-day) adds for
a SHIFT_BASED person: CLOSED months with snapshot id, lock flag and stored balance, OPEN months. Ids,
months and minutes only. Closed months are never recalculated; a correction is a Monatskorrektur (#599)
by hand.

Exit codes:
  0 - nothing listed
  1 - DATABASE_URL missing, bad CLI, or a DB connection/query failure
  2 - one or more months listed
`;

/** Signed minutes: "+120", "-60", "0". ASCII hyphen on purpose (copied into issues and notes). */
export function signed(minutes: number): string {
  if (minutes > 0) return `+${minutes}`;
  return String(minutes);
}

export type MonthMeta = {
  tenantId: string;
  employeeId: string;
  monthLabel: string; // YYYY-MM
  state: "CLOSED" | "OPEN";
  snapshotId: string | null;
  locked: boolean | null;
  storedBalanceMinutes: number | null;
};

export type MonthFinding = MonthMeta & {
  sollReliefMinutes: number;
  balanceDeltaMinutes: number;
};

/**
 * The finding of one core run: `null` when the no-shift fallback changed nothing for the month
 * (relief and delta both 0), else the figures the core reports in `rosterLeaveNoShift`.
 */
export function monthFindingFromCore(
  result: Pick<CloseMonthResult, "rosterLeaveNoShift">,
  meta: MonthMeta,
): MonthFinding | null {
  const { sollReliefMinutes, balanceDeltaMinutes } = result.rosterLeaveNoShift;
  if (sollReliefMinutes === 0 && balanceDeltaMinutes === 0) return null;
  return { ...meta, sollReliefMinutes, balanceDeltaMinutes };
}

export function formatMonthLine(f: MonthFinding): string {
  const head = `month tenantId=${f.tenantId} employeeId=${f.employeeId} month=${f.monthLabel} state=${f.state}`;
  const tail = `sollReliefMinutes=${signed(f.sollReliefMinutes)} balanceDeltaMinutes=${signed(f.balanceDeltaMinutes)}`;
  if (f.state === "OPEN") return `${head} ${tail}`;
  return `${head} snapshotId=${f.snapshotId} locked=${f.locked} storedBalanceMinutes=${f.storedBalanceMinutes} ${tail}`;
}

/** Month keys (YYYY-MM, tenant-local) a date range touches, clipped to [from, to] day strings. */
function monthKeysOfRange(
  startStr: string,
  endStr: string,
  fromStr: string,
  toStr: string,
): string[] {
  const first = startStr > fromStr ? startStr : fromStr;
  const last = endStr < toStr ? endStr : toStr;
  const keys: string[] = [];
  if (first > last) return keys;
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const lastKey = last.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    keys.push(key);
    if (key >= lastKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return keys;
}

/**
 * Exported for unit-testability - pass a PrismaClient to inject a test connection (worker test DB
 * only); without one the CLI entrypoint below bootstraps its own connection from DATABASE_URL.
 */
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
    const adapter = new PrismaPg(pool as any);
    prisma = new PrismaClient({ adapter });
  }

  // The computations only read `app.prisma` / `app.log` (same shim as audit-1056 / audit-780).
  const log = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn: (...a: any[]) => console.warn(...a),
    info: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app: any = { prisma, log };

  try {
    const tenantIds = args.allTenants
      ? (await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(
          (t) => t.id,
        )
      : [args.tenantId!];

    // Every person who has, or ever had, a SHIFT_BASED contract row in the tenant.
    const employees = await prisma.employee.findMany({
      where: {
        tenantId: { in: tenantIds },
        isTimeTrackingExempt: false,
        workSchedules: { some: { type: "SHIFT_BASED" } },
      },
      select: {
        id: true,
        tenantId: true,
        hireDate: true,
        exitDate: true,
        birthDate: true,
        breakOver6hOverride: true,
        breakOver9hOverride: true,
      },
      orderBy: [{ tenantId: "asc" }, { id: "asc" }],
    });

    const tzByTenant = new Map<string, string>();
    const configByTenant = new Map<
      string,
      Awaited<ReturnType<typeof prisma.tenantConfig.findUnique>>
    >();

    let checked = 0;
    let personsListed = 0;
    let closedListed = 0;
    let openListed = 0;
    let sollReliefSum = 0;
    let balanceDeltaSum = 0;

    for (const emp of employees) {
      if (!tzByTenant.has(emp.tenantId)) {
        tzByTenant.set(emp.tenantId, await getTenantTimezone(prisma, emp.tenantId));
        configByTenant.set(
          emp.tenantId,
          await prisma.tenantConfig.findUnique({ where: { tenantId: emp.tenantId } }),
        );
      }
      const tz = tzByTenant.get(emp.tenantId)!;
      const tenantConfigRow = configByTenant.get(emp.tenantId) ?? null;

      const hireDay = new Date(dateStrInTz(emp.hireDate, tz) + "T00:00:00Z");
      const todayStr = dateStrInTz(new Date(), tz);
      const lastDayStr =
        emp.exitDate && dateStrInTz(emp.exitDate, tz) < todayStr
          ? dateStrInTz(emp.exitDate, tz)
          : todayStr;
      const scope = { kind: "employee" as const, employeeId: emp.id, tenantId: emp.tenantId };

      const leaveInSpan = await getActiveLeaveOverlapping(
        prisma,
        scope,
        hireDay,
        new Date(lastDayStr + "T00:00:00Z"),
      );
      const monthKeys = new Set<string>();
      for (const row of leaveInSpan) {
        if (leaveCreditBasisForCode(row.leaveType?.code) !== "ROSTER") continue;
        for (const key of monthKeysOfRange(
          dateStrInTz(row.startDate, tz),
          dateStrInTz(row.endDate, tz),
          dateStrInTz(hireDay, tz),
          lastDayStr,
        )) {
          monthKeys.add(key);
        }
      }
      if (monthKeys.size === 0) continue;
      checked++;

      const months: MonthFinding[] = [];
      for (const key of [...monthKeys].sort()) {
        const year = Number(key.slice(0, 4));
        const month = Number(key.slice(5, 7));
        const { start: monthStart, end: monthEnd } = monthRangeUtc(year, month, tz);
        const { firstDay: monthFirstDay, lastDay: monthLastDay } = monthDayBounds(
          monthStart,
          monthEnd,
          tz,
        );
        // The running month (and a month not over yet) follows the new rule live; it is not listed.
        if (monthLastDay.toISOString().slice(0, 10) >= todayStr) continue;

        // The close convention: the contract in force at the month's midpoint.
        const midMonth = new Date((monthStart.getTime() + monthEnd.getTime()) / 2);
        const schedule = await resolveMonthContract(app, emp.id, monthEnd, midMonth);
        if (String((schedule as { type?: unknown }).type) !== "SHIFT_BASED") continue;

        const effectiveStart = hireDay > monthFirstDay ? hireDay : monthFirstDay;
        const workLocationEntries = await getWorkedEntriesInRange(
          prisma,
          scope,
          effectiveStart,
          monthLastDay,
        );
        const holidaysByEmployee = await holidaysAtWorkLocation(
          prisma,
          emp.tenantId,
          [emp.id],
          dateStrInTz(effectiveStart, tz),
          dateStrInTz(monthEnd, tz),
          workLocationEntries,
        );
        const holidayDateStrings = new Set<string>(holidaysByEmployee.get(emp.id)?.keys() ?? []);

        const [entries, monthShifts, leaveRows, absenceRows, bsSlots] = await Promise.all([
          getValidWorkedEntriesInRange(prisma, scope, effectiveStart, monthLastDay),
          getShiftsInRange(prisma, scope, effectiveStart, monthLastDay),
          getActiveLeaveOverlapping(prisma, scope, monthStart, monthEnd),
          getAbsencesOverlapping(prisma, scope, effectiveStart, monthEnd),
          loadBsSlotOverrides(prisma, emp.id, monthFirstDay),
        ]);

        const result = closeEmployeeMonth({
          employeeId: emp.id,
          monthStart,
          monthEnd,
          monthFirstDay,
          monthLastDay,
          tz,
          carryOverIn: 0, // the figures are independent of the carry-in
          schedule: schedule as unknown as Record<string, unknown>,
          hireDate: emp.hireDate,
          exitDate: emp.exitDate ?? null,
          isTimeTrackingExempt: false as const,
          breakOver6hOverride: emp.breakOver6hOverride ?? null,
          breakOver9hOverride: emp.breakOver9hOverride ?? null,
          birthDate: emp.birthDate ?? null,
          entries: entries.map((e) => ({
            date: e.date,
            startTime: e.startTime,
            endTime: e.endTime!,
            breakMinutes: e.breakMinutes,
          })),
          shifts: monthShifts.map((sh) => ({
            date: sh.date,
            startTime: sh.startTime,
            endTime: sh.endTime,
          })),
          approvedLeave: toCloseMonthApprovedLeave(leaveRows),
          absences: absenceRows.map((ab) => ({
            startDate: ab.startDate,
            endDate: ab.endDate,
            type: ab.type,
            source: ab.source,
            halfDay: ab.halfDay,
            unterrichtsMinutes: ab.unterrichtsMinutes ?? null,
          })),
          holidayDateStrings,
          accountCorrections: [],
          tenantConfig: tenantConfigRow
            ? {
                defaultBreakOver6h: tenantConfigRow.defaultBreakOver6h,
                defaultBreakOver9h: tenantConfigRow.defaultBreakOver9h,
                defaultWorkDays: tenantConfigRow.defaultWorkDays ?? undefined,
                vocationalSchoolMinutesPerDay:
                  tenantConfigRow.vocationalSchoolMinutesPerDay ?? undefined,
                vocationalSchoolBlockMinutesPerWeek:
                  tenantConfigRow.vocationalSchoolBlockMinutesPerWeek ?? undefined,
                bsSlotFirstLongDayMinutes: tenantConfigRow.bsSlotFirstLongDayMinutes ?? undefined,
                bsSlotSecondLongDayMinutes: tenantConfigRow.bsSlotSecondLongDayMinutes ?? undefined,
                bsSlotShortDayMinutes: tenantConfigRow.bsSlotShortDayMinutes ?? undefined,
                bsSlotBlockWeekMinutes: tenantConfigRow.bsSlotBlockWeekMinutes ?? undefined,
              }
            : null,
          employeeSlots: bsSlots.employeeSlots,
          patternSlots: bsSlots.patternSlots,
          patternUnterrichtsMinutenByDow: bsSlots.patternUnterrichtsMinutenByDow,
        });

        // A closed month is found by the one rule of Issue #595, never by an exact periodStart match.
        const snapshot = await prisma.saldoSnapshot.findFirst({
          where: {
            employeeId: emp.id,
            periodType: "MONTHLY",
            periodStart: periodStartWindow(monthStart),
            superseded: false,
          },
          orderBy: monthlySnapshotOrder(),
          select: { id: true, balanceMinutes: true, periodEnd: true },
        });
        const locked = snapshot
          ? await isSnapshotLocked(prisma, emp.id, emp.tenantId, monthStart, snapshot.periodEnd)
          : null;
        const finding = monthFindingFromCore(result, {
          tenantId: emp.tenantId,
          employeeId: emp.id,
          monthLabel: key,
          state: snapshot ? "CLOSED" : "OPEN",
          snapshotId: snapshot?.id ?? null,
          locked,
          storedBalanceMinutes: snapshot?.balanceMinutes ?? null,
        });
        if (finding) months.push(finding);
      }

      if (months.length === 0) continue;
      personsListed++;
      for (const m of months) {
        console.info(formatMonthLine(m));
        if (m.state === "CLOSED") closedListed++;
        else openListed++;
        sollReliefSum += m.sollReliefMinutes;
        balanceDeltaSum += m.balanceDeltaMinutes;
      }
    }

    console.info(
      `\nSummary: ${checked} person(s) with an approved sick-type day checked in ${tenantIds.length} tenant(s); ` +
        `${personsListed} person(s) listed, ${closedListed} CLOSED and ${openListed} OPEN month(s); ` +
        `sollReliefMinutes=${signed(sollReliefSum)} balanceDeltaMinutes=${signed(balanceDeltaSum)}. ` +
        `This script writes nothing. A CLOSED month stays as stored; a correction is a Monatskorrektur ` +
        `(#599, four eyes) booked by hand in the running month. OPEN months follow the new rule at their ` +
        `next computation.`,
    );
    return personsListed > 0 ? EXIT_FINDINGS : EXIT_OK;
  } finally {
    if (!injectedPrisma) {
      await prisma.$disconnect();
      await pool?.end();
    }
  }
}

// Run-guard: only bootstrap the DB + execute when invoked as a script, so importing the module
// for unit tests is side-effect-free (no connection, no process.exit).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = EXIT_ERROR;
    });
}
