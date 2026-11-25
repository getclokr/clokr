/**
 * Audit tool - Issue #1056.
 *
 * Before #1056 the Arbeitszeitkonto netted the SHIFT_BASED roster Soll (R) with the ADULT break
 * (§ 4 ArbZG). For a person under 18 on the shift date § 11 JArbSchG applies instead (§ 18 Abs. 2
 * ArbZG: more than 4.5 h -> 30 min, more than 6 h -> 60 min), so a minor who worked a shift with the
 * prescribed break was booked a false minus (`undertime = max(0, R - W)`, up to 30 min per shift).
 * Since #1056 the roster Soll uses the one break rule `breakAmountFor` with the age decided per shift
 * date. Open months recompute naturally; CLOSED months stay exactly as stored.
 *
 * This script lists, per person with a birth date, every COMPLETE month with a shift on a day the
 * person was under 18 on a SHIFT_BASED contract whose figures the rule change moves:
 *   - CLOSED: a stored MONTHLY snapshot exists. The stored balance, the snapshot id and the lock flag
 *     are printed so the owner sees what was stored; the stored row is NEVER recomputed or rewritten
 *     by this script or by the code.
 *   - OPEN: the month is over but not closed yet; it follows the new rule when it is closed.
 * and the live-saldo delta per person (the running month and every open month together).
 *
 * delta = the rule since #1056 minus the rule before it (positive = the § 11 break gives the person
 * MORE saldo). Both figures are recomputed by the shared core `closeEmployeeMonth` over the same
 * close-path inputs, once with the birth date (the rule since #1056) and once without (the rule
 * before: absent birth date = the adult break). Corrections move both runs equally, so the delta is
 * unaffected; the stored figure is printed from the snapshot, never recomputed.
 *
 * READ-ONLY. ZERO mutations. There is no write flag and none may ever be added: `--confirm` /
 * `--apply` are rejected. Closed months are never recalculated; a correction runs only by hand,
 * through a Monatskorrektur (#599, four eyes) booked in the running month, never automatically.
 * Output contains ids and minutes only - no name, no employee number, no birth date (DSGVO).
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1056-minor-shift-soll.ts ( --tenant-id <uuid> | --all-tenants ) [--help]
 *
 * Exit codes: 0 nobody listed; 1 error or bad CLI; 2 one or more persons listed.
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  closeEmployeeMonth,
  resolveMonthContract,
  toCloseMonthApprovedLeave,
} from "../src/contexts/working-time-account/close-employee-month";
import {
  periodStartWindow,
  monthlySnapshotOrder,
} from "../src/contexts/working-time-account/snapshot-period";
import {
  computeOvertimeBalanceBreakdown,
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
  isMinorAtDate,
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
    scripts/audit-1056-minor-shift-soll.ts ( --tenant-id <uuid> | --all-tenants ) [--help]

READ-ONLY - lists the complete months (CLOSED with the stored figures, OPEN) whose SHIFT_BASED roster
Soll the § 11 JArbSchG break of Issue #1056 changes, and each person's live-saldo delta. Ids and
minutes only. Closed months are never recalculated; a correction is a Monatskorrektur (#599) by hand.

Exit codes:
  0 - nobody listed
  1 - DATABASE_URL missing, bad CLI, or a DB connection/query failure
  2 - one or more persons listed
`;

/** Signed minutes: "+120", "-60", "0". ASCII hyphen on purpose (copied into issues and notes). */
export function signed(minutes: number): string {
  if (minutes > 0) return `+${minutes}`;
  return String(minutes);
}

export type MonthFinding = {
  tenantId: string;
  employeeId: string;
  monthLabel: string; // YYYY-MM
  state: "CLOSED" | "OPEN";
  snapshotId: string | null;
  locked: boolean | null;
  storedBalanceMinutes: number | null;
  balanceDeltaMinutes: number;
  expectedDeltaMinutes: number;
};

export function formatMonthLine(f: MonthFinding): string {
  const head = `month tenantId=${f.tenantId} employeeId=${f.employeeId} month=${f.monthLabel} state=${f.state}`;
  const tail = `balanceDeltaMinutes=${signed(f.balanceDeltaMinutes)} expectedDeltaMinutes=${signed(f.expectedDeltaMinutes)}`;
  if (f.state === "OPEN") return `${head} ${tail}`;
  return `${head} snapshotId=${f.snapshotId} locked=${f.locked} storedBalanceMinutes=${f.storedBalanceMinutes} ${tail}`;
}

export type PersonFinding = {
  tenantId: string;
  employeeId: string;
  closedMonths: number;
  closedBalanceDeltaMinutes: number;
  openMonths: number;
  liveDeltaMinutes: number;
};

export function formatPersonLine(p: PersonFinding): string {
  return (
    `person tenantId=${p.tenantId} employeeId=${p.employeeId} closedMonths=${p.closedMonths} ` +
    `closedBalanceDeltaMinutes=${signed(p.closedBalanceDeltaMinutes)} openMonths=${p.openMonths} ` +
    `liveDeltaMinutes=${signed(p.liveDeltaMinutes)}`
  );
}

/**
 * A read-only view of the client in which every employee row read answers `birthDate: null` - the
 * pre-#1056 live figure (an absent birth date reads as the adult break). Every other delegate and
 * call is the real client's.
 */
export function withoutBirthDates(prisma: PrismaClient): PrismaClient {
  const strip = (row: unknown): unknown =>
    row && typeof row === "object" && "birthDate" in row
      ? { ...(row as Record<string, unknown>), birthDate: null }
      : row;
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === "employee") {
        const real = Reflect.get(target, prop, target) as PrismaClient["employee"];
        return new Proxy(real, {
          get(t, p) {
            if (p === "findUnique" || p === "findFirst") {
              return async (args: never) =>
                strip(
                  await (t as never as Record<string, (a: never) => Promise<unknown>>)[p]!(args),
                );
            }
            if (p === "findMany") {
              return async (args: never) => {
                const rows = await t.findMany(args);
                return rows.map(strip);
              };
            }
            return Reflect.get(t, p, t);
          },
        });
      }
      return Reflect.get(target, prop, target);
    },
  });
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
    throw new Error(
      "Tenant-Auswahl erforderlich: bitte --tenant-id <uuid> ODER --all-tenants angeben.",
    );
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

  // The computations only read `app.prisma` / `app.log` (same shim as audit-780 / audit-494).
  const log = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn: (...a: any[]) => console.warn(...a),
    info: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appNew: any = { prisma, log };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appOld: any = { prisma: withoutBirthDates(prisma), log };

  try {
    const tenantIds = args.allTenants
      ? (await prisma.tenant.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map(
          (t) => t.id,
        )
      : [args.tenantId!];

    const employees = await prisma.employee.findMany({
      where: {
        tenantId: { in: tenantIds },
        birthDate: { not: null },
        isTimeTrackingExempt: false,
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
    let closedListed = 0;
    let openListed = 0;
    let personsListed = 0;

    for (const emp of employees) {
      if (!emp.birthDate) continue;
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
      // Age only grows: nobody who was an adult on the hire day was ever a minor in employment.
      if (!isMinorAtDate(emp.birthDate, hireDay)) continue;

      const todayStr = dateStrInTz(new Date(), tz);
      const yesterday = new Date(todayStr + "T00:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const scope = { kind: "employee" as const, employeeId: emp.id, tenantId: emp.tenantId };

      const shifts = await getShiftsInRange(prisma, scope, hireDay, yesterday);
      const monthKeys = new Set<string>();
      for (const sh of shifts) {
        if (!isMinorAtDate(emp.birthDate, sh.date)) continue;
        monthKeys.add(dateStrInTz(sh.date, tz).slice(0, 7));
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
        // The running month (and a month not over yet) is covered by the live delta only.
        if (monthLastDay.toISOString().slice(0, 10) >= todayStr) continue;

        const midMonth = new Date((monthStart.getTime() + monthEnd.getTime()) / 2);
        const schedule = await resolveMonthContract(appNew, emp.id, monthEnd, midMonth);
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

        const coreInput = {
          employeeId: emp.id,
          monthStart,
          monthEnd,
          monthFirstDay,
          monthLastDay,
          tz,
          carryOverIn: 0, // the delta is independent of the carry-in
          schedule: schedule as unknown as Record<string, unknown>,
          hireDate: emp.hireDate,
          exitDate: emp.exitDate ?? null,
          isTimeTrackingExempt: false as const,
          breakOver6hOverride: emp.breakOver6hOverride ?? null,
          breakOver9hOverride: emp.breakOver9hOverride ?? null,
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
        };
        const after = closeEmployeeMonth({ ...coreInput, birthDate: emp.birthDate });
        const before = closeEmployeeMonth({ ...coreInput, birthDate: null });
        const balanceDeltaMinutes = after.balanceMinutes - before.balanceMinutes;
        const expectedDeltaMinutes = after.expectedMinutes - before.expectedMinutes;
        if (balanceDeltaMinutes === 0 && expectedDeltaMinutes === 0) continue;

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
        if (snapshot) {
          const locked = await isSnapshotLocked(
            prisma,
            emp.id,
            emp.tenantId,
            monthStart,
            snapshot.periodEnd,
          );
          months.push({
            tenantId: emp.tenantId,
            employeeId: emp.id,
            monthLabel: key,
            state: "CLOSED",
            snapshotId: snapshot.id,
            locked,
            storedBalanceMinutes: snapshot.balanceMinutes,
            balanceDeltaMinutes,
            expectedDeltaMinutes,
          });
        } else {
          months.push({
            tenantId: emp.tenantId,
            employeeId: emp.id,
            monthLabel: key,
            state: "OPEN",
            snapshotId: null,
            locked: null,
            storedBalanceMinutes: null,
            balanceDeltaMinutes,
            expectedDeltaMinutes,
          });
        }
      }

      // Live delta: the account chain twice, with and without the birth date. Closed months are read
      // verbatim in both runs, so they contribute 0.
      const liveAfter = await computeOvertimeBalanceBreakdown(appNew, emp.id);
      const liveBefore = await computeOvertimeBalanceBreakdown(appOld, emp.id);
      const liveDeltaMinutes =
        liveAfter === null || liveBefore === null
          ? 0
          : Math.round(liveAfter.totalHours * 60) - Math.round(liveBefore.totalHours * 60);

      if (months.length === 0 && liveDeltaMinutes === 0) continue;
      personsListed++;
      const closed = months.filter((m) => m.state === "CLOSED");
      const open = months.filter((m) => m.state === "OPEN");
      closedListed += closed.length;
      openListed += open.length;
      for (const m of months) console.info(formatMonthLine(m));
      console.info(
        formatPersonLine({
          tenantId: emp.tenantId,
          employeeId: emp.id,
          closedMonths: closed.length,
          closedBalanceDeltaMinutes: closed.reduce((s, m) => s + m.balanceDeltaMinutes, 0),
          openMonths: open.length,
          liveDeltaMinutes,
        }),
      );
    }

    console.info(
      `\nSummary: ${checked} person(s) with a shift under 18 checked in ${tenantIds.length} tenant(s); ` +
        `${personsListed} person(s) listed, ${closedListed} CLOSED and ${openListed} OPEN month(s). ` +
        `This script writes nothing. A CLOSED month stays as stored; a correction is a Monatskorrektur ` +
        `(#599, four eyes) booked by hand in the running month.`,
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
