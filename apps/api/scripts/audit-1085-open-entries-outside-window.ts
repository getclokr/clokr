/**
 * Audit tool — Issue #1085.
 *
 * A time entry that was started and never ended („Ausstempeln fehlt“) can be ended by the person
 * themself only inside the retro window (`TenantConfig.retroEntryWindowDays`, default 10 days).
 * Older ones need a correction request, which a manager approves (Issue #1021). Before #1085 the
 * Zeiten dialog filed the wrong request for such a day (a new entry, refused as an overlap with the
 * open one), so these entries stayed open. This script lists them — the Bestand the owner decides
 * about. It does not end any of them.
 *
 * What it lists: every non-deleted TimeEntry with no end whose day lies before the tenant's
 * window (`computeRetroLimitStr`, the same boundary as the write guard, in the tenant time zone).
 * A row that is itself a pending Zeitnachtrag request is not an open entry in this sense and is
 * skipped. Per entry one line: entry id, employee id, tenant id, the day, its age in days, the
 * tenant's window and whether the row is locked (closed month). A totals block follows: rows, rows
 * per month and locked rows.
 *
 * READ-ONLY. ZERO mutations: only Prisma reads run, there is no write flag, and none may ever be
 * added (an unknown flag such as --confirm or --apply is refused). The output carries ids, dates and
 * counts only — no name, no mail address, no note (DSGVO); the script never selects those columns.
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1085-open-entries-outside-window.ts [--help]
 *
 * Exit codes:
 *   0 — no open entry older than its tenant's window exists
 *   1 — DATABASE_URL missing, bad CLI, or a DB connection/query failure
 *   2 — one or more were listed (the owner decides how they are ended)
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { dateStrInTz, getTenantTimezone, todayInTz } from "../src/contexts/working-time-account";
import {
  computeEntryAgeInDays,
  computeRetroLimitStr,
  getRetroEntryWindowDays,
} from "../src/contexts/time-tracking/retro-config";
import { isPendingRetroRow } from "../src/contexts/time-tracking/day-entries";

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
    scripts/audit-1085-open-entries-outside-window.ts [--help]

READ-ONLY — lists every open time entry (no end) whose day lies before the tenant's retro window
(Issue #1085): entry id, employee id, tenant id, day, age in days, the window and whether the row is
locked. Ids, dates and counts only. Nothing is ended; ending them needs a separate owner decision.
`;

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
    // Only ids, the day and the flags the pending-request test reads are selected — never a note.
    const open = await prisma.timeEntry.findMany({
      where: { endTime: null, deletedAt: null },
      select: {
        id: true,
        employeeId: true,
        date: true,
        isLocked: true,
        isInvalid: true,
        invalidReasonCode: true,
        retroRequestId: true,
        startTime: true,
        endTime: true,
        employee: { select: { tenantId: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    // Per tenant: its window, its time zone and the earliest day a person may still end themself.
    const tenantIds = [...new Set(open.map((r) => r.employee.tenantId))];
    const boundary = new Map<string, { windowDays: number; limit: string; today: string }>();
    for (const tenantId of tenantIds) {
      const tz = await getTenantTimezone(prisma, tenantId);
      const windowDays = await getRetroEntryWindowDays(prisma, tenantId);
      boundary.set(tenantId, {
        windowDays,
        limit: computeRetroLimitStr(tz, windowDays),
        today: dateStrInTz(todayInTz(tz), tz),
      });
    }

    const perMonth = new Map<string, number>();
    let rows = 0;
    let locked = 0;
    for (const entry of open) {
      if (isPendingRetroRow(entry)) continue; // a pending Zeitnachtrag request, not an open entry
      const tenantId = entry.employee.tenantId;
      const window = boundary.get(tenantId);
      if (!window) continue;
      const day = entry.date.toISOString().slice(0, 10);
      if (day >= window.limit) continue; // inside the window: the person can end it themself

      rows += 1;
      if (entry.isLocked) locked += 1;
      perMonth.set(day.slice(0, 7), (perMonth.get(day.slice(0, 7)) ?? 0) + 1);
      console.info(
        `entryId=${entry.id} employeeId=${entry.employeeId} tenantId=${tenantId} date=${day} ` +
          `ageDays=${computeEntryAgeInDays(window.today, day)} windowDays=${window.windowDays} ` +
          `locked=${entry.isLocked ? "true" : "false"}`,
      );
    }

    console.info(`Totals: rows=${rows}`);
    for (const [month, n] of [...perMonth.entries()].sort()) {
      console.info(`Month ${month}: ${n}`);
    }
    console.info(`Locked: ${locked}`);
    if (rows === 0) {
      console.info("No open entry older than its tenant's retro window found.");
    } else {
      console.info(
        "Nothing was ended: this script writes nothing. Ending these entries needs a separate " +
          "owner decision (a correction request approved by a manager, Issue #1021).",
      );
    }

    return rows > 0 ? EXIT_FINDINGS : EXIT_OK;
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
