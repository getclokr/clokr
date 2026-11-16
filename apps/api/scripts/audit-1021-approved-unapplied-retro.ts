/**
 * Audit tool — Issue #1021.
 *
 * Before #1021 the approval of a correction proposal (a RetroEntryRequest that is not coupled to
 * any TimeEntry) only set the status APPROVED and waited for a grant redemption that no client
 * ever sends; the approved times never reached the record. Since #1021 the approval applies them
 * (`contexts/time-tracking/retro-correction-apply.ts`). Requests approved BEFORE the fix stay
 * APPROVED and unapplied: this script lists them. Applying them is a separate owner decision —
 * the script does not do it.
 *
 * What it lists: every RetroEntryRequest with status APPROVED, not soft-deleted and with no
 * coupled TimeEntry row — exactly the set the grant guard (`status APPROVED + timeEntry is null`)
 * still treats as redeemable. Per request one line: request id, employee id, tenant id, target
 * day, the day of the approval, the number of non-deleted entries on the target day and the
 * outcome an approval would have today (NO_TIMES, MONTH_CLOSED, CORRECT, CREATE or AMBIGUOUS). A
 * totals block follows: rows, rows per month of the target day and rows per outcome.
 *
 * READ-ONLY. ZERO mutations: only Prisma reads run, there is no write flag, and none may ever be
 * added. The output carries ids, dates and counts only — no name, no mail address, no reason and
 * no review note (DSGVO); the script never selects those columns.
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1021-approved-unapplied-retro.ts [--help]
 *
 * Exit codes:
 *   0 — no approved, unapplied correction proposal exists
 *   1 — DATABASE_URL missing, bad CLI, or a DB connection/query failure
 *   2 — one or more were listed (the owner decides whether and how they are applied)
 */
import { PrismaClient } from "@clokr/db";
import type { Prisma } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { isMonthClosed, monthRangeUtc } from "../src/contexts/working-time-account";
import { findEntriesOfDay } from "../src/contexts/time-tracking/day-entries";
import { selectRetroApplyTarget } from "../src/contexts/time-tracking/retro-correction-apply";

// ── Exit codes ──────────────────────────────────────────────────────────────
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FINDINGS = 2;

export type WouldBeOutcome = "NO_TIMES" | "MONTH_CLOSED" | "CORRECT" | "CREATE" | "AMBIGUOUS";

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
    scripts/audit-1021-approved-unapplied-retro.ts [--help]

READ-ONLY — lists every approved correction proposal that was never applied (Issue #1021):
request id, employee id, tenant id, target day, approval day, entries on the day and the outcome
an approval would have today. Ids, dates and counts only. Nothing is applied; applying them needs
a separate owner decision.
`;

/** Everything a PrismaClient or an interactive-transaction client can run. */
type Db = Prisma.TransactionClient;

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
    const db = prisma as unknown as Db;
    // Only ids, dates and the proposed time strings are selected — never reason or reviewNote.
    const rows = await prisma.retroEntryRequest.findMany({
      where: { status: "APPROVED", deletedAt: null, timeEntry: { is: null } },
      select: {
        id: true,
        employeeId: true,
        targetDate: true,
        startTime: true,
        endTime: true,
        reviewedAt: true,
        employee: { select: { tenantId: true } },
      },
      orderBy: [{ targetDate: "asc" }, { id: "asc" }],
    });

    const tenantIds = [...new Set(rows.map((r) => r.employee.tenantId))];
    const configs = await prisma.tenantConfig.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, timezone: true },
    });
    const tzOf = new Map(configs.map((c) => [c.tenantId, c.timezone || "Europe/Berlin"]));

    const perMonth = new Map<string, number>();
    const perOutcome = new Map<WouldBeOutcome, number>();
    for (const row of rows) {
      const tenantId = row.employee.tenantId;
      const tz = tzOf.get(tenantId) ?? "Europe/Berlin";
      const day = row.targetDate.toISOString().slice(0, 10);
      const dayRows = await findEntriesOfDay(db, {
        tenantId,
        employeeId: row.employeeId,
        date: row.targetDate,
      });

      let outcome: WouldBeOutcome;
      if (!row.startTime || !row.endTime) {
        outcome = "NO_TIMES";
      } else if (
        await isMonthClosed(
          db,
          row.employeeId,
          tenantId,
          monthRangeUtc(row.targetDate.getUTCFullYear(), row.targetDate.getUTCMonth() + 1, tz)
            .start,
        )
      ) {
        outcome = "MONTH_CLOSED";
      } else {
        outcome = selectRetroApplyTarget(dayRows).kind;
      }

      perMonth.set(day.slice(0, 7), (perMonth.get(day.slice(0, 7)) ?? 0) + 1);
      perOutcome.set(outcome, (perOutcome.get(outcome) ?? 0) + 1);
      console.info(
        `requestId=${row.id} employeeId=${row.employeeId} tenantId=${tenantId} ` +
          `targetDate=${day} approvedOn=${row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : "unknown"} ` +
          `entriesOnDay=${dayRows.length} outcome=${outcome}`,
      );
    }

    console.info(`Totals: rows=${rows.length}`);
    for (const [month, n] of [...perMonth.entries()].sort()) {
      console.info(`Month ${month}: ${n}`);
    }
    for (const [outcome, n] of [...perOutcome.entries()].sort()) {
      console.info(`Outcome ${outcome}: ${n}`);
    }
    if (rows.length === 0) {
      console.info("No approved, unapplied correction proposal found.");
    } else {
      console.info(
        "Nothing was applied: this script writes nothing. Applying these requests needs a " +
          "separate owner decision.",
      );
    }

    return rows.length > 0 ? EXIT_FINDINGS : EXIT_OK;
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
