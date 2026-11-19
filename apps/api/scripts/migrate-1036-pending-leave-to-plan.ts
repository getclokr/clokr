/**
 * Operator script — Issue #1036 (owner decision 19.11.2026): move PENDING vacation requests into
 * the OPEN leave plan of their year.
 *
 * Problem: requests filed for a year that now has an OPEN leave plan (#835) sit next to an empty
 * plan. The planner is where the year is planned, so they belong there as wishes.
 *
 * What it does per candidate — a non-deleted PENDING request of the leave type VACATION of an
 * ACTIVE tenant whose start or end year has an OPEN plan in that tenant:
 *
 *   1. Picks the plan: the OPEN plan of that year whose salon the person is homed in on at least
 *      one request day (the per-day Stammsalon rule the wish core uses, never a second rule; with
 *      several, the salon of the earliest such day).
 *   2. In ONE transaction per request: withdraws the request exactly like the PENDING path of
 *      `DELETE /leave/requests/:id` (PENDING -> CANCELLED, guarded so only a still-PENDING row
 *      flips) and writes a wish with the same start day, end day and half-day flag through the
 *      wish core (`createWishInTx`, the same validity rules as the planner), created by the plan's
 *      opener. A refused wish rolls the whole transaction back: the request stays PENDING and the
 *      refusal code is printed.
 *
 * Never touched: APPROVED requests, every other status, every other leave type (OVERTIME_COMP
 * etc.), a request that is already linked to a wish (a takeover whose approval was refused —
 * moving it would orphan that wish), a request spanning two calendar years (a wish lies inside
 * one year), a request without an OPEN plan of the person's Stammsalon.
 *
 * Revisionssicherheit: the request gets one `UPDATE LeaveRequest` audit row (system, old/new
 * status, `auditReason` "In Urlaubsplanung übernommen", `trigger` "LEAVE_PLAN_MIGRATION_1036",
 * wish id and plan id), the wish one `CREATE LeavePlanWish` row (the plan opener, same marker) —
 * both inside the same transaction. Nothing is deleted. Idempotent: a moved request is CANCELLED
 * and is not a candidate again.
 *
 * Notifications (orchestrator decision): after a successful `--confirm` commit the approvers' open
 * `LEAVE_REQUEST` notices that point at the withdrawn request are dismissed (reactive: after the
 * commit, a failure is only logged and never fails the run).
 *
 * DRY RUN is the default (the identical transaction ends in a rollback; writes ZERO rows).
 * `--confirm` writes. `--tenant <id>` and `--year <YYYY>` narrow the run. The output carries ids,
 * dates, codes and counts only — never a name, an employee number or an e-mail address (DSGVO).
 *
 * Operator step: dry run, read it, `--confirm` on int and prod (docs/migrations.md, "Phase 1036").
 *
 * Usage:
 *   pnpm --filter @clokr/api exec tsx scripts/migrate-1036-pending-leave-to-plan.ts [--tenant <id>] [--year <YYYY>] [--confirm] [--help]
 *   (from /app/apps/api in the runtime image with the entrypoint overridden, see the runbook)
 *
 * Exit codes: 0 — done (skips are not failures); 1 — usage error, DATABASE_URL missing, or at
 * least one candidate was refused or failed.
 */
import type { FastifyInstance } from "fastify";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ACTIVE_TENANT_WHERE, homeSalonsForDays } from "../src/contexts/platform";
import { isHomedInSalonOnAnyDay } from "../src/contexts/absence";
import { lockEmployeeForLeavePricing } from "../src/contexts/absence/employee-leave-lock";
import { createWishInTx, dayOf } from "../src/contexts/absence/leave-plan";
import { isWishOverlapExclusion } from "../src/contexts/absence/leave-plan/db-refusals";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;

/** The machine marker and the German display reason written to every audit row of this run. */
export const MIGRATION_MARKER = {
  auditReason: "In Urlaubsplanung übernommen",
  trigger: "LEAVE_PLAN_MIGRATION_1036",
} as const;

/** The notification type the creation path of a leave request emits to the approvers. */
const LEAVE_REQUEST_NOTICE_TYPE = "LEAVE_REQUEST";

export type PlanRef = { id: string; salonId: string; year: number; openedByUserId: string };

export type Candidate = {
  tenantId: string;
  requestId: string;
  employeeId: string;
  startDay: string;
  endDay: string;
  halfDay: boolean;
  /** Id of a wish already linked to this request (a refused takeover), else null. */
  linkedWishId: string | null;
  /** The OPEN plans of this tenant, by year (shared reference for every candidate of the tenant). */
  plans: PlanRef[];
};

export type CandidateResult = {
  tenantId: string;
  requestId: string;
  employeeId: string;
  planId: string | null;
  startDay: string;
  endDay: string;
  halfDay: boolean;
  wishId: string | null;
  /** `MOVED`, `WOULD_MOVE`, a skip (`NO_PLAN` ...), a wish-core refusal code or `failed:<CODE>`. */
  outcome: string;
};

export type MigrationOptions = { confirm: boolean; tenantId?: string; year?: number };

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Thrown at the end of a dry-run transaction so every write of the candidate is rolled back. */
class DryRunRollback extends Error {
  constructor() {
    super("dry run rollback");
    this.name = "DryRunRollback";
  }
}

/** Thrown when the guarded PENDING -> CANCELLED flip matched no row (decided meanwhile). */
class NotPendingSkip extends Error {
  constructor() {
    super("request is no longer pending");
    this.name = "NotPendingSkip";
  }
}

/** Thrown when the wish core refuses: rolls the whole transaction (incl. the cancel) back. */
class WishRefusal extends Error {
  constructor(readonly refusalCode: string) {
    super(refusalCode);
    this.name = "WishRefusal";
  }
}

/** Reads every candidate; decides nothing but "a plan of that year is OPEN in the tenant". */
export async function collectCandidates(
  app: FastifyInstance,
  options: { tenantId?: string; year?: number },
): Promise<Candidate[]> {
  const planRows = await app.prisma.leavePlan.findMany({
    where: {
      status: "OPEN",
      tenant: ACTIVE_TENANT_WHERE,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.year !== undefined ? { year: options.year } : {}),
    },
    select: { id: true, tenantId: true, salonId: true, year: true, openedByUserId: true },
  });
  const plansByTenant = new Map<string, PlanRef[]>();
  for (const row of planRows) {
    const list = plansByTenant.get(row.tenantId) ?? [];
    list.push({
      id: row.id,
      salonId: row.salonId,
      year: row.year,
      openedByUserId: row.openedByUserId,
    });
    plansByTenant.set(row.tenantId, list);
  }

  const candidates: Candidate[] = [];
  for (const [tenantId, plans] of plansByTenant) {
    const years = new Set(plans.map((p) => p.year));
    const rows = await app.prisma.leaveRequest.findMany({
      where: {
        deletedAt: null,
        status: "PENDING",
        leaveType: { code: "VACATION" },
        employee: { tenantId },
        ...(options.year !== undefined
          ? {
              OR: [
                { startDate: { gte: new Date(`${options.year}-01-01T00:00:00Z`) } },
                { endDate: { gte: new Date(`${options.year}-01-01T00:00:00Z`) } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        halfDay: true,
        leavePlanWish: { select: { id: true } },
      },
    });
    for (const row of rows) {
      const startDay = dayOf(row.startDate);
      const endDay = dayOf(row.endDate);
      const startYear = Number(startDay.slice(0, 4));
      const endYear = Number(endDay.slice(0, 4));
      if (!years.has(startYear) && !years.has(endYear)) continue;
      candidates.push({
        tenantId,
        requestId: row.id,
        employeeId: row.employeeId,
        startDay,
        endDay,
        halfDay: row.halfDay,
        linkedWishId: row.leavePlanWish?.id ?? null,
        plans,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      compareStrings(a.tenantId, b.tenantId) ||
      compareStrings(a.employeeId, b.employeeId) ||
      compareStrings(a.startDay, b.startDay) ||
      compareStrings(a.requestId, b.requestId),
  );
  return candidates;
}

/**
 * The plan a candidate belongs to: the OPEN plan of the request's year whose salon the person is
 * homed in on a request day (the wish core's rule); with several, the salon of the earliest day.
 */
async function resolvePlan(app: FastifyInstance, candidate: Candidate): Promise<PlanRef | null> {
  const year = Number(candidate.startDay.slice(0, 4));
  const yearPlans = candidate.plans.filter((p) => p.year === year);
  if (yearPlans.length === 0) return null;
  const homes = await homeSalonsForDays(
    app.prisma,
    candidate.tenantId,
    [candidate.employeeId],
    candidate.startDay,
    candidate.endDay,
  );
  const dayMap = homes.get(candidate.employeeId);
  const eligible = yearPlans.filter((p) =>
    isHomedInSalonOnAnyDay(dayMap, p.salonId, candidate.startDay, candidate.endDay),
  );
  if (eligible.length === 0) return null;
  if (eligible.length === 1 || !dayMap) return eligible[0];
  for (const day of [...dayMap.keys()].sort()) {
    const salon = dayMap.get(day);
    const match = eligible.find((p) => p.salonId === salon);
    if (match && day >= candidate.startDay && day <= candidate.endDay) return match;
  }
  return eligible[0];
}

/** Moves one candidate; never throws for a data outcome. Exported for the test. */
export async function moveCandidate(
  app: FastifyInstance,
  candidate: Candidate,
  options: { confirm: boolean; now: Date },
): Promise<CandidateResult> {
  const base = {
    tenantId: candidate.tenantId,
    requestId: candidate.requestId,
    employeeId: candidate.employeeId,
    startDay: candidate.startDay,
    endDay: candidate.endDay,
    halfDay: candidate.halfDay,
  };
  const result = (planId: string | null, wishId: string | null, outcome: string) => ({
    ...base,
    planId,
    wishId,
    outcome,
  });

  const plan = await resolvePlan(app, candidate);
  if (candidate.startDay.slice(0, 4) !== candidate.endDay.slice(0, 4)) {
    return result(plan?.id ?? null, null, "SPANS_YEARS");
  }
  if (candidate.linkedWishId !== null) {
    return result(plan?.id ?? null, candidate.linkedWishId, "LINKED_TO_WISH");
  }
  if (!plan) return result(null, null, "NO_PLAN");

  let wishId: string | null = null;
  try {
    await app.prisma.$transaction(async (tx) => {
      // Lock order of every wish writer: the Employee row first.
      await lockEmployeeForLeavePricing(tx, candidate.tenantId, candidate.employeeId);
      const flipped = await tx.leaveRequest.updateMany({
        where: {
          id: candidate.requestId,
          status: "PENDING",
          deletedAt: null,
          employee: { tenantId: candidate.tenantId },
        },
        data: { status: "CANCELLED" },
      });
      if (flipped.count !== 1) throw new NotPendingSkip();

      const outcome = await createWishInTx(app, tx, {
        tenantId: candidate.tenantId,
        planId: plan.id,
        employeeId: candidate.employeeId,
        actor: { userId: plan.openedByUserId, kind: "MANAGER", isManagerOfPerson: true },
        now: options.now,
        startDay: candidate.startDay,
        endDay: candidate.endDay,
        halfDay: candidate.halfDay,
        auditMarker: MIGRATION_MARKER,
      });
      if (!outcome.ok) {
        throw new WishRefusal(outcome.body.code ?? `REFUSED_${outcome.statusCode}`);
      }
      wishId = outcome.wish.id;

      await app.audit({
        tx,
        action: "UPDATE",
        entity: "LeaveRequest",
        entityId: candidate.requestId,
        oldValue: { status: "PENDING" },
        newValue: {
          status: "CANCELLED",
          ...MIGRATION_MARKER,
          leavePlanWishId: outcome.wish.id,
          leavePlanId: plan.id,
        },
      });

      if (!options.confirm) throw new DryRunRollback();
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return result(plan.id, wishId, "WOULD_MOVE");
    if (err instanceof NotPendingSkip) return result(plan.id, null, "NOT_PENDING");
    if (err instanceof WishRefusal) return result(plan.id, null, err.refusalCode);
    if (isWishOverlapExclusion(err)) return result(plan.id, null, "LEAVE_PLAN_WISH_OVERLAP");
    const code = (err as { code?: unknown }).code;
    return result(
      plan.id,
      null,
      `failed:${typeof code === "string" ? code : ((err as Error).name ?? "ERROR")}`,
    );
  }

  // Reactive, after the commit: the approvers' open notices about the withdrawn request. A failure
  // is logged and never fails the run (orchestrator decision).
  try {
    await app.dismissByRelated("LeaveRequest", candidate.requestId, LEAVE_REQUEST_NOTICE_TYPE);
  } catch (err) {
    app.log.warn(
      { err, requestId: candidate.requestId },
      "Leave plan migration: notification dismissal failed",
    );
  }
  return result(plan.id, wishId, "MOVED");
}

const SKIP_OUTCOMES = new Set(["NO_PLAN", "SPANS_YEARS", "NOT_PENDING", "LINKED_TO_WISH"]);
const SUCCESS_OUTCOMES = new Set(["MOVED", "WOULD_MOVE"]);

/** Lists and moves every candidate, one transaction each. Exported for the test. */
export async function runMigration(
  app: FastifyInstance,
  options: MigrationOptions,
): Promise<CandidateResult[]> {
  const candidates = await collectCandidates(app, options);
  const now = new Date();
  const results: CandidateResult[] = [];
  for (const candidate of candidates) {
    results.push(await moveCandidate(app, candidate, { confirm: options.confirm, now }));
  }
  return results;
}

export function formatResult(r: CandidateResult): string {
  return (
    `tenant=${r.tenantId} request=${r.requestId} employee=${r.employeeId} plan=${r.planId ?? "none"} ` +
    `type=VACATION start=${r.startDay} end=${r.endDay} halfDay=${r.halfDay} ` +
    `wish=${r.wishId ?? "none"} result=${r.outcome}`
  );
}

export function formatTotals(results: CandidateResult[]): string {
  const count = (pred: (r: CandidateResult) => boolean) => results.filter(pred).length;
  const is = (outcome: string) => (r: CandidateResult) => r.outcome === outcome;
  return (
    `Totals: candidates=${results.length} moved=${count(is("MOVED"))} ` +
    `wouldMove=${count(is("WOULD_MOVE"))} ` +
    `refused=${count((r) => !SKIP_OUTCOMES.has(r.outcome) && !SUCCESS_OUTCOMES.has(r.outcome))} ` +
    `noPlan=${count(is("NO_PLAN"))} spansYears=${count(is("SPANS_YEARS"))} ` +
    `notPending=${count(is("NOT_PENDING"))} linkedToWish=${count(is("LINKED_TO_WISH"))}`
  );
}

export type CliArgs = {
  help: boolean;
  confirm: boolean;
  tenant: string | undefined;
  year: number | undefined;
};

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false },
      confirm: { type: "boolean", default: false },
      tenant: { type: "string" },
      year: { type: "string" },
    },
    strict: true,
  });
  let year: number | undefined;
  if (values.year !== undefined) {
    if (!/^\d{4}$/.test(values.year)) throw new Error("--year must be a four-digit year");
    year = Number(values.year);
  }
  return {
    help: Boolean(values.help),
    confirm: Boolean(values.confirm),
    tenant: values.tenant,
    year,
  };
}

export const USAGE = `
Usage:
  pnpm --filter @clokr/api exec tsx scripts/migrate-1036-pending-leave-to-plan.ts [--tenant <id>] [--year <YYYY>] [--confirm] [--help]

Moves PENDING VACATION requests into the OPEN leave plan of their year (Issue #1036): per request,
in ONE transaction, the request is withdrawn (PENDING -> CANCELLED) and a wish with the same days
and half-day flag is written through the wish core. A refused wish rolls the transaction back and
the request stays PENDING.

  (none)     Dry run: prints the outcome per request, writes ZERO rows.
  --confirm  Writes; every write is audited (LEAVE_PLAN_MIGRATION_1036).
  --tenant   Restrict to one tenant id.
  --year     Restrict to plans (and requests) of one year, e.g. 2027.

Outcomes: WOULD_MOVE (dry run), MOVED (--confirm), NO_PLAN, SPANS_YEARS, NOT_PENDING,
LINKED_TO_WISH (skips, left alone), or a wish-core refusal code such as LEAVE_PLAN_WISH_OVERLAP
(refused, request stays PENDING).

Ids, dates, counts and codes only - never a name or an employee number.
Exit codes: 0 done, 1 usage error / DATABASE_URL missing / a candidate was refused or failed.
`;

/**
 * Exported for the test: pass the app to inject a test app (worker test DB only); without one the
 * entrypoint below builds the real app from DATABASE_URL.
 */
export async function main(argv: string[], injectedApp?: FastifyInstance): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return EXIT_ERROR;
  }
  if (args.help) {
    console.info(USAGE);
    return EXIT_OK;
  }
  if (!injectedApp && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    return EXIT_ERROR;
  }

  // Lazy import: importing this module for a test must not load the whole app.
  const app = injectedApp ?? (await (await import("../src/app")).buildApp());
  try {
    if (!injectedApp) await app.ready();
    const results = await runMigration(app, {
      confirm: args.confirm,
      tenantId: args.tenant,
      year: args.year,
    });
    for (const result of results) console.info(formatResult(result));
    console.info(formatTotals(results));
    console.info(args.confirm ? "Written (--confirm)." : "Dry run: this run wrote nothing.");
    const failed = results.some(
      (r) => !SKIP_OUTCOMES.has(r.outcome) && !SUCCESS_OUTCOMES.has(r.outcome),
    );
    return failed ? EXIT_ERROR : EXIT_OK;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_ERROR;
  } finally {
    if (!injectedApp) await app.close();
  }
}

// Run-guard: bootstrap only when invoked as a script, so importing the module is side-effect-free.
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
