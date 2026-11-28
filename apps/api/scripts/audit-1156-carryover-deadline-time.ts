/**
 * Audit tool - Issue #1156.
 *
 * `LeaveEntitlement.carryOverDeadline` is a Timestamptz that names a calendar DAY (the Stichtag). Two
 * writers (`recalculateCarryOver`, `autoCarryOver`) used to build it with
 * `new Date(y, m - 1, d, 23, 59, 59)` in the HOST time zone, while every reader names the day by its
 * UTC date part. The value is now `YYYY-MM-DD 23:59:59Z` (`contexts/absence/carry-over-deadline.ts`).
 *
 * A row written by the old code on a non-UTC host does not end in 23:59:59.000Z. This script lists
 * every stored deadline by its UTC time-of-day class:
 *   - END_OF_DAY    23:59:59.000Z - the canonical value; not listed.
 *   - START_OF_DAY  00:00:00.000Z - a date-only value typed into the admin form (PUT
 *                   /settings/vacation); names the right day, but as an instant it lies at the START
 *                   of the Stichtag. Listed as INFO only (not a host-zone artefact).
 *   - OTHER         anything else - a host-zone artefact (or a hand-written value). Listed as FINDING
 *                   with the day it names today (UTC date part) and the day the host-zone reading
 *                   would have meant (`meansDay`, the nearest day boundary), so the owner can decide.
 * Production ran in UTC containers throughout, so no OTHER row is expected.
 *
 * READ-ONLY. ZERO mutations. There is no write flag and none may ever be added: `--confirm` /
 * `--apply` are rejected. Output contains ids, years and timestamps only - no name, no employee
 * number, no mail (DSGVO).
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1156-carryover-deadline-time.ts ( --tenant-id <uuid> | --all-tenants ) [--help]
 *
 * Exit codes: 0 nothing to fix; 1 error or bad CLI; 2 one or more OTHER rows listed.
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

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
    scripts/audit-1156-carryover-deadline-time.ts ( --tenant-id <uuid> | --all-tenants ) [--help]

READ-ONLY - lists LeaveEntitlement rows whose carryOverDeadline is not the canonical
YYYY-MM-DD 23:59:59Z (OTHER = host-zone artefact, FINDING; START_OF_DAY = date-only admin input, INFO).
Ids, years and timestamps only.

Exit codes:
  0 - no OTHER row
  1 - DATABASE_URL missing, bad CLI, or a DB connection/query failure
  2 - one or more OTHER rows listed
`;

export type DeadlineClass = "END_OF_DAY" | "START_OF_DAY" | "OTHER";

const DAY_MS = 24 * 60 * 60 * 1000;
const END_OF_DAY_MS = DAY_MS - 1000; // 23:59:59.000

/** The UTC time-of-day class of a stored deadline. */
export function classifyDeadline(deadline: Date): DeadlineClass {
  const msOfDay = ((deadline.getTime() % DAY_MS) + DAY_MS) % DAY_MS;
  if (msOfDay === END_OF_DAY_MS) return "END_OF_DAY";
  if (msOfDay === 0) return "START_OF_DAY";
  return "OTHER";
}

/**
 * The day an OTHER value most likely meant: the UTC day whose 23:59:59Z is nearest. A host-zone
 * write lands within a day of it (offset of the writing host), so the nearest end-of-day names it.
 * A heuristic, exact for a writing host within 12 hours of UTC (Europe, the Americas); a hint for the
 * owner, never used to rewrite anything.
 */
export function intendedDay(deadline: Date): string {
  const t = deadline.getTime();
  const lowerEnd = Math.floor((t - END_OF_DAY_MS) / DAY_MS) * DAY_MS + END_OF_DAY_MS;
  const upperEnd = lowerEnd + DAY_MS;
  const nearest = t - lowerEnd <= upperEnd - t ? lowerEnd : upperEnd;
  return new Date(nearest).toISOString().slice(0, 10);
}

export type DeadlineRow = {
  tenantId: string;
  entitlementId: string;
  year: number;
  carryOverDeadline: Date;
};

export function formatRowLine(row: DeadlineRow, cls: DeadlineClass): string {
  const parts = [
    cls === "OTHER" ? "FINDING" : "INFO",
    `class=${cls}`,
    `tenantId=${row.tenantId}`,
    `entitlementId=${row.entitlementId}`,
    `year=${row.year}`,
    `deadline=${row.carryOverDeadline.toISOString()}`,
    `namesDay=${row.carryOverDeadline.toISOString().slice(0, 10)}`,
  ];
  if (cls === "OTHER") parts.push(`meansDay=${intendedDay(row.carryOverDeadline)}`);
  return parts.join(" ");
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

  try {
    const rows = await prisma.leaveEntitlement.findMany({
      where: {
        carryOverDeadline: { not: null },
        employee: args.allTenants ? {} : { tenantId: args.tenantId! },
      },
      select: {
        id: true,
        year: true,
        carryOverDeadline: true,
        employee: { select: { tenantId: true } },
      },
      orderBy: [{ year: "asc" }, { id: "asc" }],
    });

    let checked = 0;
    let findings = 0;
    let info = 0;
    for (const r of rows) {
      checked++;
      const row: DeadlineRow = {
        tenantId: r.employee.tenantId,
        entitlementId: r.id,
        year: r.year,
        carryOverDeadline: r.carryOverDeadline as Date,
      };
      const cls = classifyDeadline(row.carryOverDeadline);
      if (cls === "END_OF_DAY") continue;
      if (cls === "OTHER") findings++;
      else info++;
      console.info(formatRowLine(row, cls));
    }
    console.info(
      `checked=${checked} findingsOther=${findings} infoStartOfDay=${info}. This script writes nothing.`,
    );
    return findings > 0 ? EXIT_FINDINGS : EXIT_OK;
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
