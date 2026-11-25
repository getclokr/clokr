/**
 * Audit tool — Issue #1069 (O-7).
 *
 * Before #1069 a Betriebsurlaub with "Vom Urlaubskonto abziehen" booked nothing: no Urlaub, no
 * Soll reduction. Since #1069 `bookCompanyShutdown` (`contexts/absence/company-shutdown/booking.ts`)
 * writes, for every person employed on the shutdown's days and not on its exception list, one
 * imposed absence of the code COMPANY_SHUTDOWN per calendar month and - with the deduction - the
 * Urlaub requests linked by `LeaveRequest.companyShutdownId`. Shutdowns created before the fix, and
 * persons whose booking failed or whose hire date was changed afterwards, have none of it.
 *
 * What it lists: one line per (shutdown, person, calendar month of the person's employment inside
 * the shutdown) with the state
 *   BOOKED        an active COMPANY_SHUTDOWN absence of that shutdown covers the month,
 *   MISSING       an active shutdown, the person is affected, the month is open and nothing is booked,
 *   CLOSED_MONTH  nothing is booked and the month is closed (the Monatskorrektur, #599, is the way),
 *   EXCEPTED      the person is on the shutdown's exception list (nothing is booked by design),
 * the count of the shutdown's generated requests of that month by status, and the number of calendar
 * days of the month's shutdown days that other Urlaub requests (PENDING or effective) already hold.
 * A soft-deleted shutdown is listed only where something generated is still active (closed months
 * keep their rows by design). A totals line follows.
 *
 * READ-ONLY. ZERO mutations: only Prisma reads run, there is no write flag, and none may ever be
 * added. Ids, dates, codes and counts only - no name, no mail address; the script never selects
 * those columns.
 *
 * Correction: never by this script. The owner decides after the run what gets re-booked; that runs
 * through the booking module (an edit or re-save of the Betriebsurlaub in the web app), which books
 * open months only, audited, and leaves closed months to the Monatskorrektur.
 *
 * Usage:
 *   DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \
 *     scripts/audit-1069-company-shutdown-bookings.ts [--tenant <uuid>] [--help]
 *
 * Exit codes:
 *   0 — no MISSING line
 *   1 — DATABASE_URL missing, bad CLI, or a DB connection/query failure
 *   2 — one or more MISSING lines
 */
import { PrismaClient } from "@clokr/db";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { reportPopulationWhere } from "../src/contexts/platform";
import {
  dateStrInTz,
  dayRangeUtc,
  getTenantTimezone,
  isMonthClosed,
  monthRangeUtc,
} from "../src/contexts/working-time-account";

// ── Exit codes ──────────────────────────────────────────────────────────────
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FINDINGS = 2;

// ── CLI parsing ───────────────────────────────────────────────────────────────
export type CliArgs = { help: boolean; tenantId: string | null };

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false },
      tenant: { type: "string" },
    },
    strict: true, // rejects any unknown flag, in particular --confirm / --apply
  });
  return { help: Boolean(values.help), tenantId: values.tenant ?? null };
}

export const USAGE = `
Usage:
  DATABASE_URL=<dsn> pnpm --filter @clokr/api exec tsx \\
    scripts/audit-1069-company-shutdown-bookings.ts [--tenant <uuid>] [--help]

READ-ONLY — lists every Betriebsurlaub per affected person and month with its booking state
(BOOKED / MISSING / CLOSED_MONTH / EXCEPTED), the generated requests by status and the days other
Urlaub already holds (Issue #1069). Ids, dates, codes and counts only. Exit 0 / 1 / 2 (MISSING).
`;

// ── Pure classification ───────────────────────────────────────────────────────
export type ShutdownRow = {
  id: string;
  tenantId: string;
  /** `YYYY-MM-DD`. */
  startDay: string;
  endDay: string;
  deductsFromVacation: boolean;
  deleted: boolean;
  exceptedEmployeeIds: readonly string[];
};

export type PersonRow = {
  id: string;
  /** Tenant-local hire day and exit day, `YYYY-MM-DD`. */
  hireDay: string;
  exitDay: string | null;
};

export type RequestRow = {
  employeeId: string;
  status: string;
  startDay: string;
  endDay: string;
  companyShutdownId: string | null;
};

export type AbsenceRow = {
  employeeId: string;
  type: string;
  startDay: string;
  endDay: string;
  companyShutdownId: string | null;
  deleted: boolean;
};

export type BookingState = "BOOKED" | "MISSING" | "CLOSED_MONTH" | "EXCEPTED";

export type BookingLine = {
  shutdownId: string;
  tenantId: string;
  employeeId: string;
  /** `YYYY-MM`. */
  month: string;
  state: BookingState;
  shutdownDeleted: boolean;
  deductsFromVacation: boolean;
  /** Generated requests of this shutdown that month, counted per status. */
  generatedRequests: Record<string, number>;
  /** Calendar days of the month's shutdown days that other Urlaub requests already hold. */
  otherLeaveDays: number;
};

/** Statuses that hold a day against a Betriebsurlaub (PENDING plus the effective ones). */
const BLOCKING_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "APPROVED",
  "CANCELLATION_REQUESTED",
]);
/** Generated requests that still stand (a cancelled or rejected one is history). */
const STANDING_STATUSES = BLOCKING_STATUSES;

const DAY_MS = 24 * 60 * 60 * 1000;

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}
function minDay(a: string, b: string): string {
  return a < b ? a : b;
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/** Splits `[from, to]` (`YYYY-MM-DD`) at calendar month boundaries. */
export function monthSegments(from: string, to: string): Array<{ start: string; end: string }> {
  const segments: Array<{ start: string; end: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const lastOfMonth = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    segments.push({ start: cursor, end: minDay(lastOfMonth, to) });
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  return segments;
}

/**
 * Pure classification: one line per (shutdown, person, month of the person's employment inside the
 * shutdown). `closedMonths` holds `"<employeeId>|<YYYY-MM>"` for every closed (person, month).
 */
export function classifyShutdownBookings(input: {
  shutdowns: readonly ShutdownRow[];
  persons: readonly PersonRow[];
  requests: readonly RequestRow[];
  absences: readonly AbsenceRow[];
  closedMonths: ReadonlySet<string>;
}): BookingLine[] {
  const lines: BookingLine[] = [];
  for (const shutdown of input.shutdowns) {
    const excepted = new Set(shutdown.exceptedEmployeeIds);
    for (const person of input.persons) {
      const from = maxDay(shutdown.startDay, person.hireDay);
      const to = person.exitDay ? minDay(shutdown.endDay, person.exitDay) : shutdown.endDay;
      if (from > to) continue;
      for (const segment of monthSegments(from, to)) {
        const month = segment.start.slice(0, 7);
        const activeAbsences = input.absences.filter(
          (a) =>
            a.employeeId === person.id &&
            a.companyShutdownId === shutdown.id &&
            a.type === "COMPANY_SHUTDOWN" &&
            !a.deleted &&
            overlaps(a.startDay, a.endDay, segment.start, segment.end),
        );
        const generated = input.requests.filter(
          (r) =>
            r.employeeId === person.id &&
            r.companyShutdownId === shutdown.id &&
            overlaps(r.startDay, r.endDay, segment.start, segment.end),
        );
        const generatedRequests: Record<string, number> = {};
        for (const request of generated) {
          generatedRequests[request.status] = (generatedRequests[request.status] ?? 0) + 1;
        }
        const standing = generated.some((r) => STANDING_STATUSES.has(r.status));

        let state: BookingState;
        if (excepted.has(person.id)) state = "EXCEPTED";
        else if (activeAbsences.length > 0) state = "BOOKED";
        else if (input.closedMonths.has(`${person.id}|${month}`)) state = "CLOSED_MONTH";
        else state = "MISSING";

        if (shutdown.deleted) {
          // A deleted shutdown owes nothing: listed only where generated rows still stand.
          if (activeAbsences.length === 0 && !standing) continue;
          if (state === "MISSING") continue;
        }

        const held = new Set<string>();
        for (const request of input.requests) {
          if (
            request.employeeId !== person.id ||
            request.companyShutdownId === shutdown.id ||
            !BLOCKING_STATUSES.has(request.status)
          ) {
            continue;
          }
          const start = maxDay(request.startDay, segment.start);
          const end = minDay(request.endDay, segment.end);
          for (let t = Date.parse(start); t <= Date.parse(end); t += DAY_MS) {
            held.add(new Date(t).toISOString().slice(0, 10));
          }
        }

        lines.push({
          shutdownId: shutdown.id,
          tenantId: shutdown.tenantId,
          employeeId: person.id,
          month,
          state,
          shutdownDeleted: shutdown.deleted,
          deductsFromVacation: shutdown.deductsFromVacation,
          generatedRequests,
          otherLeaveDays: held.size,
        });
      }
    }
  }
  return lines;
}

function formatRequests(counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort();
  return keys.length === 0 ? "-" : keys.map((k) => `${k}:${counts[k]}`).join(",");
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
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const shutdowns = await prisma.companyShutdown.findMany({
      where: args.tenantId ? { tenantId: args.tenantId } : {},
      select: {
        id: true,
        tenantId: true,
        startDate: true,
        endDate: true,
        deductsFromVacation: true,
        deletedAt: true,
        exceptions: { select: { employeeId: true } },
      },
      orderBy: [{ tenantId: "asc" }, { startDate: "asc" }, { id: "asc" }],
    });

    const lines: BookingLine[] = [];
    const tenantIds = [...new Set(shutdowns.map((s) => s.tenantId))];
    for (const tenantId of tenantIds) {
      const tz = await getTenantTimezone(prisma, tenantId);
      const tenantShutdowns = shutdowns.filter((s) => s.tenantId === tenantId);
      const first = tenantShutdowns.reduce(
        (a, s) => (s.startDate < a ? s.startDate : a),
        tenantShutdowns[0].startDate,
      );
      const last = tenantShutdowns.reduce(
        (a, s) => (s.endDate > a ? s.endDate : a),
        tenantShutdowns[0].endDate,
      );

      // The affected population: the one #613 rule over the whole span of the tenant's shutdowns.
      // Only ids and the two employment instants are selected (no name, no mail address).
      const employees = await prisma.employee.findMany({
        where: {
          tenantId,
          ...reportPopulationWhere(
            dayRangeUtc(day(first), tz).start,
            dayRangeUtc(day(last), tz).end,
          ),
        },
        select: { id: true, hireDate: true, exitDate: true },
        orderBy: [{ id: "asc" }],
      });
      const persons: PersonRow[] = employees.map((e) => ({
        id: e.id,
        hireDay: dateStrInTz(e.hireDate, tz),
        exitDay: e.exitDate ? dateStrInTz(e.exitDate, tz) : null,
      }));
      if (persons.length === 0) continue;
      const personIds = persons.map((p) => p.id);

      const requestRows = await prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: personIds },
          employee: { tenantId },
          deletedAt: null,
          startDate: { lte: last },
          endDate: { gte: first },
        },
        select: {
          employeeId: true,
          status: true,
          startDate: true,
          endDate: true,
          companyShutdownId: true,
        },
      });
      const absenceRows = await prisma.absence.findMany({
        where: {
          employeeId: { in: personIds },
          employee: { tenantId },
          type: "COMPANY_SHUTDOWN",
          startDate: { lte: last },
          endDate: { gte: first },
        },
        select: {
          employeeId: true,
          type: true,
          startDate: true,
          endDate: true,
          companyShutdownId: true,
          deletedAt: true,
        },
      });
      const requests: RequestRow[] = requestRows.map((r) => ({
        employeeId: r.employeeId,
        status: r.status,
        startDay: day(r.startDate),
        endDay: day(r.endDate),
        companyShutdownId: r.companyShutdownId,
      }));
      const absences: AbsenceRow[] = absenceRows.map((a) => ({
        employeeId: a.employeeId,
        type: a.type,
        startDay: day(a.startDate),
        endDay: day(a.endDate),
        companyShutdownId: a.companyShutdownId,
        deleted: a.deletedAt !== null,
      }));
      const shutdownRows: ShutdownRow[] = tenantShutdowns.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        startDay: day(s.startDate),
        endDay: day(s.endDate),
        deductsFromVacation: s.deductsFromVacation,
        deleted: s.deletedAt !== null,
        exceptedEmployeeIds: s.exceptions.map((e) => e.employeeId),
      }));

      // Closed months, by the one rule of the application (#595 windows inside `isMonthClosed`),
      // asked only for the (person, month) pairs that matter.
      const wanted = classifyShutdownBookings({
        shutdowns: shutdownRows,
        persons,
        requests,
        absences,
        closedMonths: new Set<string>(),
      });
      const closedMonths = new Set<string>();
      for (const key of new Set(wanted.map((l) => `${l.employeeId}|${l.month}`))) {
        const [employeeId, month] = key.split("|");
        const [year, monthNumber] = month.split("-").map(Number);
        const { start } = monthRangeUtc(year, monthNumber, tz);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (await isMonthClosed(prisma as any, employeeId, tenantId, start)) {
          closedMonths.add(key);
        }
      }
      lines.push(
        ...classifyShutdownBookings({
          shutdowns: shutdownRows,
          persons,
          requests,
          absences,
          closedMonths,
        }),
      );
    }

    const totals: Record<BookingState, number> = {
      BOOKED: 0,
      MISSING: 0,
      CLOSED_MONTH: 0,
      EXCEPTED: 0,
    };
    for (const line of lines) {
      totals[line.state] += 1;
      console.info(
        `tenantId=${line.tenantId} shutdownId=${line.shutdownId} employeeId=${line.employeeId} ` +
          `month=${line.month} state=${line.state} deleted=${line.shutdownDeleted} ` +
          `deducts=${line.deductsFromVacation} requests=${formatRequests(line.generatedRequests)} ` +
          `otherLeaveDays=${line.otherLeaveDays}`,
      );
    }
    console.info(
      `Totals: shutdowns=${shutdowns.length} lines=${lines.length} BOOKED=${totals.BOOKED} ` +
        `MISSING=${totals.MISSING} CLOSED_MONTH=${totals.CLOSED_MONTH} EXCEPTED=${totals.EXCEPTED}`,
    );
    console.info("This script writes nothing.");

    return totals.MISSING > 0 ? EXIT_FINDINGS : EXIT_OK;
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
