/**
 * Audit tool — Issue #1011 (Teilurlaub counts full months of employment).
 *
 * Since #1011 the hire-year Teilurlaub counts FULL MONTHS OF EMPLOYMENT from the hire day per
 * §§ 187 Abs. 2, 188 Abs. 2/3 BGB (§ 5 Abs. 1 BUrlG), not calendar months: a hire on 16.11.
 * is one twelfth, not two. The rule change writes nothing — a stored LeaveEntitlement row keeps
 * its value until an audited recompute touches it. So a VACATION row of a person hired mid-month
 * after 1 July may still hold the old, higher value.
 *
 * What it lists: every VACATION LeaveEntitlement row whose year is the UTC year of the person's
 * hire date, whose UTC hire day is NOT the 1st of a month (the only hires the rule can change) and
 * whose stored `totalDays` differs (2 decimals, `daysDiffer`) from the legal value
 * `resolveRegularVacationDays()` — the very function the audited #447/#450 recomputes use, never a
 * re-derivation in this script. One line per finding: tenant id, employee id, entitlement id, year,
 * stored and legal total days, used days, `humanWrite` (a person typed the stored value, so it is
 * never silently replaced) and `usedAboveLegal` (days already used exceed the legal value). A totals
 * line follows.
 *
 * READ-ONLY. ZERO mutations: only Prisma reads run, there is no write flag, and none may ever be
 * added. Ids and numbers only — no name, no mail address, no birth date; the script never selects
 * those columns.
 *
 * Correction: never by this script. Whether and how a stored row is corrected is an owner decision
 * (an audited write, never below the days already used or approved).
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1011-hire-year-entitlements.ts [--help]
 *
 * Exit codes:
 *   0 — no row differs from the legal value
 *   1 — DATABASE_URL missing, bad CLI, or a DB connection/query failure
 *   2 — one or more rows were listed
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  daysDiffer,
  hasHumanVacationWrite,
  resolveRegularVacationDays,
} from "../src/contexts/absence/leave-days";
import { getLeaveTypeByCode } from "../src/contexts/absence/facade/leave-types";

// ── Exit codes ──────────────────────────────────────────────────────────────
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FINDINGS = 2;

// ── CLI parsing ───────────────────────────────────────────────────────────────
export type CliArgs = { help: boolean };

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false },
    },
    strict: true, // rejects any unknown flag, in particular --confirm / --apply
  });
  return { help: Boolean(values.help) };
}

export const USAGE = `
Usage:
  DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \\
    scripts/audit-1011-hire-year-entitlements.ts [--help]

READ-ONLY — lists every hire-year VACATION LeaveEntitlement row of a person hired mid-month whose
stored total days differ from the legal value (Issue #1011, § 5 Abs. 1 BUrlG, §§ 187/188 BGB):
ids and numbers only, then a totals line. Writes nothing.
`;

// ── Pure classification ─────────────────────────────────────────────────────────
/** One stored VACATION row with the facts the classification needs (all already read). */
export type HireYearRow = {
  tenantId: string;
  employeeId: string;
  entitlementId: string;
  hireDate: Date;
  year: number;
  totalDays: number;
  usedDays: number;
  /** `resolveRegularVacationDays()` for this row's year; read by the caller, never derived here. */
  legalTotalDays: number;
  humanWrite: boolean;
};

export type Finding = {
  tenantId: string;
  employeeId: string;
  entitlementId: string;
  year: number;
  storedTotalDays: number;
  legalTotalDays: number;
  usedDays: number;
  humanWrite: boolean;
  usedAboveLegal: boolean;
};

/**
 * The set of rows the #1011 rule can change: the row of the UTC hire year of a person whose UTC hire
 * day is not the 1st of a month. Used by the caller to decide for which rows the legal value is
 * computed at all, and again by {@link classifyHireYearRows} so the two can never disagree.
 */
export function isHireYearMidMonthRow(hireDate: Date, year: number): boolean {
  return hireDate.getUTCFullYear() === year && hireDate.getUTCDate() !== 1;
}

/** Pure classification: a finding per hire-year mid-month row whose stored value is not the legal one. */
export function classifyHireYearRows(rows: readonly HireYearRow[]): Finding[] {
  const findings: Finding[] = [];
  for (const row of rows) {
    if (!isHireYearMidMonthRow(row.hireDate, row.year)) continue;
    if (!daysDiffer(row.totalDays, row.legalTotalDays)) continue;
    findings.push({
      tenantId: row.tenantId,
      employeeId: row.employeeId,
      entitlementId: row.entitlementId,
      year: row.year,
      storedTotalDays: row.totalDays,
      legalTotalDays: row.legalTotalDays,
      usedDays: row.usedDays,
      humanWrite: row.humanWrite,
      usedAboveLegal: row.usedDays > row.legalTotalDays,
    });
  }
  return findings;
}

/**
 * Exported for unit-testability — pass a PrismaClient to inject a test connection (run against the
 * worker test DB only); without one the CLI entrypoint below bootstraps its own connection from
 * DATABASE_URL.
 */
export async function main(argv: string[], injectedPrisma?: PrismaClient): Promise<number> {
  const args = parseCli(argv);

  if (args.help) {
    console.info(USAGE);
    return EXIT_OK;
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

  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });

    let rowsChecked = 0;
    const findings: Finding[] = [];
    for (const tenant of tenants) {
      const vacationType = await getLeaveTypeByCode(prisma, tenant.id, "VACATION");
      if (!vacationType) continue;

      // Only ids, the hire date and the entitlement figures are selected.
      const entitlements = await prisma.leaveEntitlement.findMany({
        where: { leaveTypeId: vacationType.id, employee: { tenantId: tenant.id } },
        select: {
          id: true,
          employeeId: true,
          year: true,
          totalDays: true,
          usedDays: true,
          employee: { select: { hireDate: true } },
        },
        orderBy: [{ employeeId: "asc" }, { year: "asc" }],
      });

      const rows: HireYearRow[] = [];
      for (const e of entitlements) {
        if (!isHireYearMidMonthRow(e.employee.hireDate, e.year)) continue;
        rowsChecked += 1;
        rows.push({
          tenantId: tenant.id,
          employeeId: e.employeeId,
          entitlementId: e.id,
          hireDate: e.employee.hireDate,
          year: e.year,
          totalDays: Number(e.totalDays),
          usedDays: Number(e.usedDays),
          legalTotalDays: await resolveRegularVacationDays(prisma, e.employeeId, tenant.id, e.year),
          humanWrite: await hasHumanVacationWrite(prisma, e.id),
        });
      }
      findings.push(...classifyHireYearRows(rows));
    }

    for (const f of findings) {
      console.info(
        `tenantId=${f.tenantId} employeeId=${f.employeeId} entitlementId=${f.entitlementId} ` +
          `year=${f.year} storedTotalDays=${f.storedTotalDays} legalTotalDays=${f.legalTotalDays} ` +
          `usedDays=${f.usedDays} humanWrite=${f.humanWrite} usedAboveLegal=${f.usedAboveLegal}`,
      );
    }
    console.info(
      `Totals: rowsChecked=${rowsChecked} rowsListed=${findings.length} ` +
        `humanWritten=${findings.filter((f) => f.humanWrite).length} ` +
        `usedAboveLegal=${findings.filter((f) => f.usedAboveLegal).length}`,
    );
    if (findings.length === 0) {
      console.info("No hire-year entitlement row differs from the legal value.");
    } else {
      console.info("This script writes nothing.");
    }

    return findings.length > 0 ? EXIT_FINDINGS : EXIT_OK;
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
