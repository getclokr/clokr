/**
 * Issue #1069 - the ONE place a Betriebsurlaub becomes bookings.
 *
 * What is booked (owner decision 25.11.2026, O-1..O-4; planner decisions D-01..D-08):
 *   - for EVERY person employed on the shutdown's days (never anonymised, not on the exception list)
 *     and every calendar month of the shutdown, ONE imposed `Absence` of the code COMPANY_SHUTDOWN
 *     over the person's shutdown days of that month - whatever `deductsFromVacation` says. It is
 *     the day "Betrieb geschlossen": through the close core's day dedup (approved leave and holidays
 *     claim a day first) it reduces the Soll on exactly the days no approved Urlaub covers, so a
 *     refused, pending or cancelled Urlaub never leaves a minus (§ 615 BGB, paid release);
 *   - with `deductsFromVacation`, Urlaub requests (type VACATION, whole days) through the existing
 *     leave cores: `createLeaveRequestCore` (option `employerOrdered`, § 7 Abs. 1 BUrlG: the employer
 *     fixes the timing) and `approveLeaveRequestCore`. Every other check of the cores runs
 *     unchanged; nothing here validates a request itself.
 *
 * Who may do what (D-06): the actor is the user whose request triggers the booking. A request is
 * created only inside the actor's `leave-request:create:ZUGEWIESEN` reach (the own row: with
 * `leave-request:create:EIGENE`) and approved only inside the `leave-request:approve:ZUGEWIESEN`
 * reach and never the actor's own - four-eyes is never bypassed, there is no SYSTEM approver.
 * `company-shutdown:manage` goes around no leave permission.
 *
 * A (person, month) whose month is closed is never written (D-08); a run is idempotent per person
 * and month (an active absence of this shutdown there means it was booked).
 *
 * Reversal (O-5, D-09): `reverseCompanyShutdown` / `rebookCompanyShutdown` cancel the generated rows
 * of OPEN months - requests through the cancellation core shared with the employment exit
 * (`leave-cancellation.ts`: Urlaub booked back, § 9 credits superseded, entries revalidated),
 * absences soft-deleted - and an edit books again, all inside the one lock of the shutdown. A
 * closed month is never changed (the Monatskorrektur, #599, corrects it).
 *
 * Deliberately NOT re-exported from `contexts/absence/index.ts` (import-cycle cap 22); importers:
 * `api/company-shutdowns.ts`. The only writer of the code COMPANY_SHUTDOWN (vocabulary guard G5).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@clokr/db";
import {
  accessContextFromRequest,
  hasPermission,
  homeSalonsForDays,
  isStammsalonScopeMatch,
  reportPopulationWhere,
  resolveAccessReach,
  type AccessReach,
} from "../../platform";
import {
  dateStrInTz,
  dayRangeUtc,
  getTenantTimezone,
  todayInTz,
  updateOvertimeAccount,
} from "../../working-time-account";
import { getWorkedEntriesInRange } from "../../time-tracking";
import { findClosedMonthsInRange } from "../closed-month-guard";
import { EFFECTIVE_LEAVE_STATUSES } from "../effective-leave-statuses";
import { ensureLeaveType } from "../ensure-leave-type";
import { getAbsencesOverlapping } from "../facade/absences";
import { getVacationBalance } from "../facade/vacation-balance";
import {
  REGULAR_ENTITLEMENT_REASON_LEAVE_REQUEST,
  daysDiffer,
  ensureRegularVacationEntitlement,
  getHolidayMap,
  resolveLeaveDays,
} from "../leave-days";
import {
  autoCarryOver,
  createLeaveRequestCore,
  notifyLeaveRequestApprovers,
} from "../leave-request-create";
import {
  approveLeaveRequestCore,
  leaveDecisionGuard,
  loadLeaveRequestForReview,
  type AuditRequestMeta,
} from "../leave-decision";
import { absenceTypeFields } from "../leave-type";
import {
  cancelLeaveRequestInTx,
  planLeaveCancellation,
  type LeaveCancellationAuditPort,
  type LeaveCancellationMarker,
} from "../leave-cancellation";
import {
  shutdownAffectedRuns,
  shutdownBookingSegments,
  shutdownScopesConflict,
} from "./affected-days";
import {
  COMPANY_SHUTDOWN_BOOKING_RUNNING,
  COMPANY_SHUTDOWN_REVERSED_TRIGGER,
  COMPANY_SHUTDOWN_TRIGGER,
  REVERSAL_AUDIT_REASONS,
  companyShutdownLockName,
  limitExceptionReasonFor,
  type COMPANY_SHUTDOWN_BOOKED,
  type COMPANY_SHUTDOWN_REVERSED,
  type ShutdownReversalReason,
} from "./constants";

// A same-file literal (not the imported constant) so the audit-label walk resolves the action; the
// type ties it to the constant of `constants.ts`.
const BOOKED_ACTION: typeof COMPANY_SHUTDOWN_BOOKED = "COMPANY_SHUTDOWN_BOOKED";
const REVERSED_ACTION: typeof COMPANY_SHUTDOWN_REVERSED = "COMPANY_SHUTDOWN_REVERSED";
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_AND_HALF_MS_NS = 1_500_000n;

/** How long one run may pin its lock connection (a run is many short transactions). */
const BOOKING_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Who triggers a booking and how far they reach (D-06). Built once per request. */
export type ShutdownActor = {
  userId: string;
  employeeId: string | null;
  /** The actor's `leave-request:create:ZUGEWIESEN` reach. */
  createReach: AccessReach;
  /** The actor's `leave-request:approve:ZUGEWIESEN` reach. */
  approveReach: AccessReach;
  /** Whether the actor holds `leave-request:create:EIGENE` (the actor's own row). */
  mayCreateOwn: boolean;
};

/** Counts only - no ids, no names (D-21). */
export type ShutdownBookingCounts = {
  persons: number;
  absencesWritten: number;
  vacationApproved: number;
  vacationPending: number;
  paidReleaseOnly: number;
  partlyPaidRelease: number;
  outsideCreateReach: number;
  skippedClosedMonths: number;
  existingLeavePersons: number;
  refused: Record<string, number>;
  reversedRequests: number;
  reversedAbsences: number;
};

export function emptyBookingCounts(): ShutdownBookingCounts {
  return {
    persons: 0,
    absencesWritten: 0,
    vacationApproved: 0,
    vacationPending: 0,
    paidReleaseOnly: 0,
    partlyPaidRelease: 0,
    outsideCreateReach: 0,
    skippedClosedMonths: 0,
    existingLeavePersons: 0,
    refused: {},
    reversedRequests: 0,
    reversedAbsences: 0,
  };
}

export type BookOutcome =
  | { ok: true; counts: ShutdownBookingCounts }
  | { ok: false; code: typeof COMPANY_SHUTDOWN_BOOKING_RUNNING };

/**
 * The actor of a booking, from the authenticated request: the same three reach resolutions the
 * leave-planner takeover makes for its taker (`api/leave-plans.ts`).
 */
export async function resolveShutdownActor(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<ShutdownActor> {
  const context = accessContextFromRequest(req);
  return {
    userId: req.user.sub,
    employeeId: req.user.employeeId ?? null,
    createReach: await resolveAccessReach(app.prisma, context, "leave-request:create:ZUGEWIESEN"),
    approveReach: await resolveAccessReach(app.prisma, context, "leave-request:approve:ZUGEWIESEN"),
    mayCreateOwn: await hasPermission(req, "leave-request:create:EIGENE"),
  };
}

/** `YYYY-MM-DD` of a `@db.Date` value (UTC midnight). */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar days of the inclusive range `[start, end]` (both `YYYY-MM-DD`). */
function calendarDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
}

/**
 * Resolves once at least 1.5 ms of MONOTONIC time have passed since `since`, so two creates of one
 * run carry strictly increasing `createdAt` (D-835-27: SHIFT_BASED sibling pricing sorts by it).
 */
async function waitOneTick(since: bigint): Promise<void> {
  while (process.hrtime.bigint() - since < ONE_AND_HALF_MS_NS) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * D-05 (Issue #1079, revises #1069 D-11): another ACTIVE Betriebsurlaub of the tenant that shares a
 * day with `[start, end]` (`YYYY-MM-DD`, inclusive) AND whose scope meets `salonIds` - either side
 * has no salons (the whole Unternehmen) or the salon sets intersect - or null. Because a person has
 * exactly one Stammsalon per day, disjoint scopes keep the invariant that one person never gets two
 * absences or two Urlaub attempts for one day. `excludeId` is the shutdown being edited.
 */
export async function findOverlappingShutdown(
  app: FastifyInstance,
  tenantId: string,
  start: string,
  end: string,
  salonIds: readonly string[],
  excludeId?: string,
): Promise<{ id: string } | null> {
  const candidates = await app.prisma.companyShutdown.findMany({
    where: {
      tenantId,
      deletedAt: null,
      startDate: { lte: new Date(end) },
      endDate: { gte: new Date(start) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      salons: { select: { salonId: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const hit = candidates.find((candidate) =>
    shutdownScopesConflict(
      { start, end, salonIds },
      {
        start: dayOf(candidate.startDate),
        end: dayOf(candidate.endDate),
        salonIds: candidate.salons.map((row) => row.salonId),
      },
    ),
  );
  return hit ? { id: hit.id } : null;
}

/** Every `YYYY-MM-DD` of the inclusive range `[start, end]`. */
function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let cursor = Date.parse(start); cursor <= Date.parse(end); cursor += DAY_MS) {
    days.push(dayOf(new Date(cursor)));
  }
  return days;
}

/** Splits an ascending day list into runs of consecutive calendar days. */
function contiguousRuns(days: readonly string[]): string[][] {
  const runs: string[][] = [];
  for (const day of days) {
    const run = runs[runs.length - 1];
    if (run && Date.parse(day) - Date.parse(run[run.length - 1]) === DAY_MS) run.push(day);
    else runs.push([day]);
  }
  return runs;
}

/**
 * Runs the booking of one Betriebsurlaub. One run per shutdown at a time (D-19): the lock is a
 * transaction-scoped advisory lock held on a connection PINNED by this outer transaction for the
 * whole run, while the run's own queries go through the pool (the pattern of
 * `utils/with-advisory-lock.ts`: a session-level unlock could reach another pooled connection and
 * leak the lock). A route-triggered run uses the try-lock and answers
 * COMPANY_SHUTDOWN_BOOKING_RUNNING when another run holds it; a hire run waits.
 */
export async function bookCompanyShutdown(
  app: FastifyInstance,
  input: {
    tenantId: string;
    shutdownId: string;
    actor: ShutdownActor;
    /** Narrows the run to these persons (later hire, exception removal); absent = everybody affected. */
    employeeIds?: readonly string[];
    request: AuditRequestMeta;
    /** `try` (default): refuse while another run holds the lock. `wait`: queue behind it. */
    lock?: "try" | "wait";
  },
): Promise<BookOutcome> {
  const locked = await withShutdownLock(app, input.shutdownId, input.lock, () =>
    runBooking(app, input, emptyBookingCounts()),
  );
  return locked.ok ? { ok: true, counts: locked.value } : locked;
}

type Locked<T> =
  { ok: true; value: T } | { ok: false; code: typeof COMPANY_SHUTDOWN_BOOKING_RUNNING };

/**
 * Runs `run` while holding the shutdown's transaction-scoped advisory lock on a pinned connection
 * (see {@link bookCompanyShutdown}). `try` answers `{ ok: false }` when another run holds it.
 */
async function withShutdownLock<T>(
  app: FastifyInstance,
  shutdownId: string,
  mode: "try" | "wait" | undefined,
  run: () => Promise<T>,
): Promise<Locked<T>> {
  const name = companyShutdownLockName(shutdownId);
  return app.prisma.$transaction(
    async (lockTx) => {
      if (mode === "wait") {
        await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
      } else {
        const rows = await lockTx.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${name}, 0)) AS acquired`;
        if (rows[0]?.acquired !== true) {
          return { ok: false, code: COMPANY_SHUTDOWN_BOOKING_RUNNING } as const;
        }
      }
      return { ok: true, value: await run() } as const;
    },
    { timeout: BOOKING_RUN_TIMEOUT_MS },
  );
}

async function runBooking(
  app: FastifyInstance,
  input: {
    tenantId: string;
    shutdownId: string;
    actor: ShutdownActor;
    employeeIds?: readonly string[];
    request: AuditRequestMeta;
  },
  counts: ShutdownBookingCounts,
): Promise<ShutdownBookingCounts> {
  const { tenantId, actor } = input;

  // Re-read after the lock: a run that waited behind a delete finds nothing to do.
  const shutdown = await app.prisma.companyShutdown.findFirst({
    where: { id: input.shutdownId, tenantId, deletedAt: null },
    include: {
      exceptions: { select: { employeeId: true } },
      salons: { select: { salonId: true } },
    },
  });
  if (!shutdown) return counts;
  const shutdownId = shutdown.id;
  const salonIds = shutdown.salons.map((row) => row.salonId);

  const tz = await getTenantTimezone(app.prisma, tenantId);
  const startDay = dayOf(shutdown.startDate);
  const endDay = dayOf(shutdown.endDate);
  const excepted = new Set(shutdown.exceptions.map((e) => e.employeeId));
  const today = todayInTz(tz);
  const currentMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const limitReason = limitExceptionReasonFor(shutdown);
  const leaveTypeId = shutdown.deductsFromVacation
    ? await ensureLeaveType(app.prisma, app.log, tenantId, "VACATION")
    : null;

  // D-01: affected = employed on a day of the shutdown (the #613 population), tenant-local days.
  const population = await app.prisma.employee.findMany({
    where: {
      tenantId,
      ...(input.employeeIds ? { id: { in: [...input.employeeIds] } } : {}),
      AND: [reportPopulationWhere(dayRangeUtc(startDay, tz).start, dayRangeUtc(endDay, tz).end)],
    },
    select: { id: true, hireDate: true, exitDate: true },
    orderBy: [{ id: "asc" }],
  });

  // D-02 (Issue #1079): a salon-scoped Betriebsurlaub affects a person on the days whose Stammsalon
  // (HOME assignment of that tenant-local day) is a named salon - one batched read for everybody.
  const homeSalonDays =
    salonIds.length > 0
      ? await homeSalonsForDays(
          app.prisma,
          tenantId,
          population.map((person) => person.id),
          startDay,
          endDay,
        )
      : null;

  const refreshEmployeeIds = new Set<string>();
  const touchedEmployeeIds: string[] = [];

  /**
   * The days of the segment that no other leave, recorded work or non-Berufsschule absence holds
   * (D-03), and whether the person has any such other occupation (D-15). Requests generated by this
   * very shutdown hold their days too, but are no "existing" leave.
   */
  async function freeDaysOf(
    personId: string,
    segment: { start: string; end: string },
  ): Promise<{ free: string[]; hasExisting: boolean }> {
    const from = new Date(segment.start);
    const to = new Date(segment.end);
    const occupied = new Set<string>();
    let hasExisting = false;
    const blocking = await app.prisma.leaveRequest.findMany({
      where: {
        employeeId: personId,
        employee: { tenantId },
        deletedAt: null,
        status: { in: ["PENDING", ...EFFECTIVE_LEAVE_STATUSES] },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { startDate: true, endDate: true, companyShutdownId: true },
    });
    for (const request of blocking) {
      if (request.companyShutdownId !== shutdownId) hasExisting = true;
      for (const day of eachDay(dayOf(request.startDate), dayOf(request.endDate))) {
        occupied.add(day);
      }
    }
    const worked = await getWorkedEntriesInRange(
      app.prisma,
      { kind: "employee", employeeId: personId, tenantId },
      from,
      to,
    );
    for (const entry of worked) {
      hasExisting = true;
      occupied.add(dayOf(entry.date));
    }
    const absences = await getAbsencesOverlapping(
      app.prisma,
      { kind: "employee", employeeId: personId, tenantId },
      from,
      to,
    );
    for (const absence of absences) {
      if (absence.type === "VOCATIONAL_SCHOOL" || absence.type === "COMPANY_SHUTDOWN") continue;
      hasExisting = true;
      for (const day of eachDay(dayOf(absence.startDate), dayOf(absence.endDate))) {
        occupied.add(day);
      }
    }
    return {
      free: eachDay(segment.start, segment.end).filter((day) => !occupied.has(day)),
      hasExisting,
    };
  }

  /** The price of a whole-day VACATION request over the range, from the one pricing function. */
  async function priceOf(personId: string, start: string, end: string) {
    const holidays = new Set(
      (await getHolidayMap(app.prisma, tenantId, personId, new Date(start), new Date(end))).keys(),
    );
    return resolveLeaveDays(
      app.prisma,
      personId,
      tenantId,
      new Date(start),
      new Date(end),
      false,
      holidays,
      { mode: "request", leaveTypeCode: "VACATION" },
    );
  }

  /**
   * Creates the request through the create core and approves it only inside the actor's approve
   * reach (never the own request). Returns the stored price on success, `null` when the core
   * refused (counted by its reason).
   */
  async function createAndApprove(
    personId: string,
    own: boolean,
    range: { start: string; end: string },
    willApprove: boolean,
  ): Promise<boolean> {
    const created = await createLeaveRequestCore(
      app,
      {
        tenantId,
        employeeId: personId,
        actorUserId: actor.userId,
        body: { type: "VACATION", startDate: range.start, endDate: range.end, halfDay: false },
        isOnBehalfOf: !own,
        auditExtra: { trigger: COMPANY_SHUTDOWN_TRIGGER, companyShutdownId: shutdownId },
        notifyApprovers: !willApprove,
        employerOrdered: true,
      },
      {
        inTransaction: async (tx: Prisma.TransactionClient, row: { id: string }) => {
          await tx.leaveRequest.updateMany({
            where: { id: row.id, employee: { tenantId } },
            data: { companyShutdownId: shutdownId },
          });
        },
      },
    );
    if (!created.ok) {
      bump(counts.refused, created.reason);
      return false;
    }
    // D-835-27: the next create of this run must be stamped strictly after this row's createdAt.
    await waitOneTick(process.hrtime.bigint());

    if (!willApprove) {
      counts.vacationPending += 1;
      return true;
    }
    const existing = await loadLeaveRequestForReview(app, created.request.id);
    const guard = existing
      ? await leaveDecisionGuard(app, { existing, reviewerUserId: actor.userId })
      : null;
    const decided =
      existing && !guard
        ? await approveLeaveRequestCore(app, {
            existing,
            reviewerUserId: actor.userId,
            // D-07: a staffing limit cannot apply while the business is closed - an explicit,
            // audited exception, not a skipped check.
            limitException: { reason: limitReason },
            // The stored balance is refreshed once per person after the run.
            deferOvertimeRecompute: true,
            request: input.request,
          })
        : null;
    if (decided?.ok) {
      counts.vacationApproved += 1;
      if (new Date(range.start).getTime() <= currentMonthEnd.getTime()) {
        refreshEmployeeIds.add(personId);
      }
    } else {
      // Stays PENDING for another approver; they are told, exactly like for any request.
      counts.vacationPending += 1;
      const reason = guard?.reason ?? (decided && !decided.ok ? decided.reason : "NOT_DECIDABLE");
      bump(counts.refused, `APPROVAL_${reason}`);
      await notifyLeaveRequestApprovers(app, {
        tenantId,
        request: created.request,
        typeCode: "VACATION",
        startDay: range.start,
        endDay: range.end,
      });
    }
    return true;
  }

  for (const person of population) {
    if (excepted.has(person.id)) continue;
    const hireDay = dateStrInTz(person.hireDate, tz);
    const exitDay = person.exitDate ? dateStrInTz(person.exitDate, tz) : null;
    const from = hireDay > startDay ? hireDay : startDay;
    const to = exitDay !== null && exitDay < endDay ? exitDay : endDay;
    // The one rule of who is affected on which day (AC3): the pure `affected-days` module.
    const runs = shutdownAffectedRuns({
      from,
      to,
      salonIds,
      homeSalonByDay: homeSalonDays?.get(person.id),
    });
    if (runs.length === 0) continue;
    counts.persons += 1;
    const closedMonthsSeen = new Set<string>();
    const own = actor.employeeId === person.id;
    // What the person's free days cost in total and how much of it was charged as Urlaub.
    let pricedFreeDays = 0;
    let chargedDays = 0;
    let booked = false;
    let existingLeave = false;

    for (const segment of shutdownBookingSegments(runs)) {
      const segmentStart = new Date(segment.start);
      const segmentEnd = new Date(segment.end);

      // D-08: a closed month is never written.
      const closed = await findClosedMonthsInRange(
        app.prisma,
        person.id,
        tenantId,
        segmentStart,
        segmentEnd,
      );
      if (closed.length > 0) {
        // Counted once per (person, month): two runs in one closed month are one skipped month.
        const monthKey = segment.start.slice(0, 7);
        if (!closedMonthsSeen.has(monthKey)) {
          closedMonthsSeen.add(monthKey);
          counts.skippedClosedMonths += 1;
        }
        continue;
      }

      // Idempotency per person and month: the absence of this shutdown is the "booked" marker. The
      // unique key is (employee, start, type), so a soft-deleted row of an earlier booking is
      // restored instead of blocking the write.
      const stored = await app.prisma.absence.findFirst({
        where: {
          employeeId: person.id,
          employee: { tenantId },
          startDate: segmentStart,
          type: "COMPANY_SHUTDOWN",
        },
        select: { id: true, deletedAt: true },
      });
      if (stored && stored.deletedAt === null) continue;

      const days = calendarDays(segment.start, segment.end);
      const absenceValues = {
        ...absenceTypeFields("COMPANY_SHUTDOWN"),
        startDate: segment.start,
        endDate: segment.end,
        days,
        companyShutdownId: shutdown.id,
      };
      await app.prisma.$transaction(async (tx) => {
        if (stored) {
          await tx.absence.updateMany({
            where: { id: stored.id, employee: { tenantId } },
            data: {
              deletedAt: null,
              endDate: segmentEnd,
              days,
              halfDay: false,
              source: "MANUAL",
              companyShutdownId: shutdown.id,
              createdBy: actor.userId,
            },
          });
          await app.audit({
            userId: actor.userId,
            action: "UPDATE",
            entity: "Absence",
            entityId: stored.id,
            oldValue: { deletedAt: stored.deletedAt },
            newValue: { ...absenceValues, deletedAt: null, trigger: COMPANY_SHUTDOWN_TRIGGER },
            request: input.request,
            tx,
          });
        } else {
          const created = await tx.absence.create({
            data: {
              employeeId: person.id,
              ...absenceTypeFields("COMPANY_SHUTDOWN"),
              source: "MANUAL",
              startDate: segmentStart,
              endDate: segmentEnd,
              days,
              halfDay: false,
              note: null,
              createdBy: actor.userId,
              companyShutdownId: shutdown.id,
            },
            select: { id: true },
          });
          await app.audit({
            userId: actor.userId,
            action: "CREATE",
            entity: "Absence",
            entityId: created.id,
            newValue: { ...absenceValues, trigger: COMPANY_SHUTDOWN_TRIGGER },
            request: input.request,
            tx,
          });
        }
      });
      counts.absencesWritten += 1;
      booked = true;
      touchedEmployeeIds.push(person.id);

      if (!shutdown.deductsFromVacation || leaveTypeId === null) continue;

      // D-06: a request is created only inside the actor's create reach.
      const mayCreate = own
        ? actor.mayCreateOwn
        : await isStammsalonScopeMatch(
            app.prisma,
            tenantId,
            actor.createReach,
            person.id,
            segmentStart,
          );
      if (!mayCreate) {
        counts.outsideCreateReach += 1;
        continue;
      }

      // D-03: only the free days are candidates for Urlaub, run by run, oldest first.
      const { free, hasExisting } = await freeDaysOf(person.id, segment);
      if (hasExisting) existingLeave = true;
      const year = segmentStart.getUTCFullYear();
      let yearExhausted = false;

      for (const run of contiguousRuns(free)) {
        const runStart = run[0];
        const runEnd = run[run.length - 1];
        const full = await priceOf(person.id, runStart, runEnd);
        pricedFreeDays += full.days;
        // Nothing chargeable at all (holidays, days off): no request. A run of Berufsschultage only
        // still goes to the core, which refuses it by its own rule (BS_ONLY).
        if (full.days <= 0 && !full.vocationalSchoolOnly) continue;
        if (yearExhausted) continue;

        // D-04: the same preparations the create core runs, then the one Resturlaub function.
        await autoCarryOver(app.prisma, tenantId, person.id, leaveTypeId, year);
        await ensureRegularVacationEntitlement(
          app.prisma,
          person.id,
          tenantId,
          year,
          leaveTypeId,
          REGULAR_ENTITLEMENT_REASON_LEAVE_REQUEST,
        );
        const balance = await getVacationBalance(
          app.prisma,
          person.id,
          tenantId,
          year,
          new Date(runStart),
        );
        const allowance = balance ? balance.remainingDays - balance.pendingDays : 0;
        const fits = (price: number) => price < allowance || !daysDiffer(price, allowance);

        let chargeEnd: string | null = null;
        let charged = full.days;
        if (fits(full.days)) {
          chargeEnd = runEnd;
        } else {
          // The longest prefix whose price fits, whole days only; the rest stays paid release and
          // so does every later run of this year.
          yearExhausted = true;
          for (let k = run.length - 2; k >= 0; k--) {
            const prefix = await priceOf(person.id, runStart, run[k]);
            if (prefix.days > 0 && fits(prefix.days)) {
              chargeEnd = run[k];
              charged = prefix.days;
              break;
            }
          }
        }
        if (chargeEnd === null) continue;

        const willApprove =
          !own &&
          (await isStammsalonScopeMatch(
            app.prisma,
            tenantId,
            actor.approveReach,
            person.id,
            new Date(runStart),
          ));
        const requested = await createAndApprove(
          person.id,
          own,
          { start: runStart, end: chargeEnd },
          willApprove,
        );
        if (requested) chargedDays += charged;
      }
    }

    if (existingLeave) counts.existingLeavePersons += 1;
    if (!booked) continue;
    if (!shutdown.deductsFromVacation) {
      counts.paidReleaseOnly += 1;
    } else if (pricedFreeDays > 0) {
      if (chargedDays <= 0) counts.paidReleaseOnly += 1;
      else if (daysDiffer(chargedDays, pricedFreeDays) && chargedDays < pricedFreeDays) {
        counts.partlyPaidRelease += 1;
      }
    }
  }

  for (const employeeId of refreshEmployeeIds) {
    try {
      await updateOvertimeAccount(app, employeeId);
    } catch (err) {
      app.log.warn(
        { err, employeeId },
        "Failed to refresh the overtime balance after a Betriebsurlaub booking",
      );
    }
  }

  // One summary row per run: ids and counts only, no free text (D-20).
  await app.audit({
    userId: actor.userId,
    action: BOOKED_ACTION,
    entity: "CompanyShutdown",
    entityId: shutdown.id,
    newValue: { ...counts, employeeIds: touchedEmployeeIds },
    request: input.request,
  });

  return counts;
}

// ── Reversal (Issue #1069, O-5, D-08, D-09) ───────────────────────────────────────────────────────

/** Thrown inside one cancellation transaction when a planned request changed meanwhile. */
class ShutdownReversalConflictError extends Error {
  constructor(entity: string, id: string) {
    super(`company shutdown reversal: ${entity} ${id} changed concurrently`);
  }
}

type ReversalInput = {
  tenantId: string;
  shutdownId: string;
  /** Narrows the run to these persons (an exception was added); absent = everybody. */
  employeeIds?: readonly string[];
  reason: ShutdownReversalReason;
  actorUserId: string;
  request: AuditRequestMeta;
};

/**
 * Cancels the generated rows of one Betriebsurlaub in OPEN months (D-09): every generated request
 * (PENDING, APPROVED, CANCELLATION_REQUESTED) through the cancellation core the employment exit
 * shares (`leave-cancellation.ts`: Urlaub booked back, § 9 credits superseded, entries
 * revalidated), every active COMPANY_SHUTDOWN absence soft-deleted. REJECTED and CANCELLED rows are
 * never touched. A row in a closed month is left exactly as it is and counted (D-08). Reads no
 * CompanyShutdown row: a soft-deleted shutdown is reversed the same way (its rows carry the link).
 */
async function runReversal(
  app: FastifyInstance,
  input: ReversalInput,
  counts: ShutdownBookingCounts,
): Promise<ShutdownBookingCounts> {
  const { tenantId, shutdownId, actorUserId } = input;
  const marker: LeaveCancellationMarker = {
    auditReason: REVERSAL_AUDIT_REASONS[input.reason],
    trigger: COMPANY_SHUTDOWN_REVERSED_TRIGGER,
    companyShutdownId: shutdownId,
  };
  const personFilter = input.employeeIds ? { employeeId: { in: [...input.employeeIds] } } : {};
  const tz = await getTenantTimezone(app.prisma, tenantId);
  const today = todayInTz(tz);
  const currentMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const auditIn =
    (tx: Prisma.TransactionClient): LeaveCancellationAuditPort =>
    (entry) =>
      app.audit({ userId: actorUserId, ...entry, request: input.request, tx });

  const skippedMonths = new Set<string>();
  const touchedEmployeeIds = new Set<string>();
  const cancelledRequestIds: string[] = [];
  const refreshEmployeeIds = new Set<string>();
  const closedKey = (employeeId: string, start: Date) =>
    `${employeeId}:${dayOf(start).slice(0, 7)}`;

  const requests = await app.prisma.leaveRequest.findMany({
    where: {
      companyShutdownId: shutdownId,
      employee: { tenantId },
      deletedAt: null,
      status: { in: ["PENDING", "APPROVED", "CANCELLATION_REQUESTED"] },
      ...personFilter,
    },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      status: true,
      days: true,
      halfDay: true,
      overtimeCompMinutes: true,
      startDate: true,
      endDate: true,
      updatedAt: true,
      leaveType: { select: { code: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  for (const row of requests) {
    const closed = await findClosedMonthsInRange(
      app.prisma,
      row.employeeId,
      tenantId,
      row.startDate,
      row.endDate,
    );
    if (closed.length > 0) {
      skippedMonths.add(closedKey(row.employeeId, row.startDate));
      continue;
    }
    const action = await planLeaveCancellation(app.prisma, app.log, {
      tenantId,
      employeeId: row.employeeId,
      row,
      tenantTz: async () => tz,
    });
    try {
      await app.prisma.$transaction(async (tx) => {
        await cancelLeaveRequestInTx(tx, {
          tenantId,
          employeeId: row.employeeId,
          action,
          marker,
          audit: auditIn(tx),
          conflict: (entity, id) => new ShutdownReversalConflictError(entity, id),
        });
      });
    } catch (err) {
      if (err instanceof ShutdownReversalConflictError) {
        // The request changed between the plan and the write (decided, edited): it stays as it is.
        bump(counts.refused, "REVERSAL_CONFLICT");
        continue;
      }
      throw err;
    }
    counts.reversedRequests += 1;
    cancelledRequestIds.push(row.id);
    touchedEmployeeIds.add(row.employeeId);
    if (row.status !== "PENDING" && row.startDate.getTime() <= currentMonthEnd.getTime()) {
      refreshEmployeeIds.add(row.employeeId);
    }
  }

  const absences = await app.prisma.absence.findMany({
    where: {
      companyShutdownId: shutdownId,
      employee: { tenantId },
      deletedAt: null,
      type: "COMPANY_SHUTDOWN",
      ...personFilter,
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  for (const absence of absences) {
    const closed = await findClosedMonthsInRange(
      app.prisma,
      absence.employeeId,
      tenantId,
      absence.startDate,
      absence.endDate,
    );
    if (closed.length > 0) {
      skippedMonths.add(closedKey(absence.employeeId, absence.startDate));
      continue;
    }
    const deleted = await app.prisma.$transaction(async (tx) => {
      const { count } = await tx.absence.updateMany({
        where: { id: absence.id, employee: { tenantId }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count !== 1) return false;
      await app.audit({
        userId: actorUserId,
        action: "DELETE",
        entity: "Absence",
        entityId: absence.id,
        oldValue: {
          type: absence.type,
          startDate: dayOf(absence.startDate),
          endDate: dayOf(absence.endDate),
          days: Number(absence.days),
          source: absence.source,
          companyShutdownId: shutdownId,
        },
        newValue: { deleted: true, ...marker },
        request: input.request,
        tx,
      });
      return true;
    });
    if (!deleted) continue;
    counts.reversedAbsences += 1;
    touchedEmployeeIds.add(absence.employeeId);
  }
  counts.skippedClosedMonths += skippedMonths.size;

  // Reactive tail (ADR 0002 Entscheidung 10): the managers' notices of the cancelled requests are
  // dismissed and the stored overtime balance refreshed once per person; failures are logged only.
  for (const requestId of cancelledRequestIds) {
    try {
      await app.dismissByRelated("LeaveRequest", requestId);
    } catch (err) {
      app.log.warn({ err, requestId }, "Betriebsurlaub reversal: notification dismissal failed");
    }
  }
  for (const employeeId of refreshEmployeeIds) {
    try {
      await updateOvertimeAccount(app, employeeId);
    } catch (err) {
      app.log.warn(
        { err, employeeId },
        "Failed to refresh the overtime balance after a Betriebsurlaub reversal",
      );
    }
  }

  // One summary row per run that changed or protected something: ids and counts only (D-20).
  if (counts.reversedRequests + counts.reversedAbsences + counts.skippedClosedMonths > 0) {
    await app.audit({
      userId: actorUserId,
      action: REVERSED_ACTION,
      entity: "CompanyShutdown",
      entityId: shutdownId,
      newValue: {
        reason: input.reason,
        reversedRequests: counts.reversedRequests,
        reversedAbsences: counts.reversedAbsences,
        skippedClosedMonths: counts.skippedClosedMonths,
        refused: counts.refused,
        employeeIds: [...touchedEmployeeIds],
      },
      request: input.request,
    });
  }
  return counts;
}

/**
 * Reverses the generated rows of a Betriebsurlaub in open months under the shutdown's lock.
 * `applyChange` (the route's update or soft delete of the CompanyShutdown row) runs INSIDE the lock
 * and before the reversal, so a contended lock answers COMPANY_SHUTDOWN_BOOKING_RUNNING with
 * nothing changed.
 */
export async function reverseCompanyShutdown(
  app: FastifyInstance,
  input: ReversalInput & { lock?: "try" | "wait"; applyChange?: () => Promise<void> },
): Promise<BookOutcome> {
  const locked = await withShutdownLock(app, input.shutdownId, input.lock, async () => {
    await input.applyChange?.();
    return runReversal(app, input, emptyBookingCounts());
  });
  return locked.ok ? { ok: true, counts: locked.value } : locked;
}

/**
 * An edit of the period or of the deduction flag (D-09): reverse the generated rows of open months
 * and book again from the changed shutdown, in ONE locked run. `applyChange` writes the changed
 * CompanyShutdown row inside the lock, before the reversal.
 */
export async function rebookCompanyShutdown(
  app: FastifyInstance,
  input: {
    tenantId: string;
    shutdownId: string;
    actor: ShutdownActor;
    request: AuditRequestMeta;
    lock?: "try" | "wait";
    applyChange?: () => Promise<void>;
  },
): Promise<BookOutcome> {
  const locked = await withShutdownLock(app, input.shutdownId, input.lock, async () => {
    await input.applyChange?.();
    const counts = emptyBookingCounts();
    await runReversal(
      app,
      {
        tenantId: input.tenantId,
        shutdownId: input.shutdownId,
        reason: "CHANGED",
        actorUserId: input.actor.userId,
        request: input.request,
      },
      counts,
    );
    return runBooking(app, input, counts);
  });
  return locked.ok ? { ok: true, counts: locked.value } : locked;
}

/**
 * A person created later (Issue #1069, O-6, D-18): books every ACTIVE Betriebsurlaub of the tenant
 * that has a day on or after the person's tenant-local hire day, for this person only. Each shutdown
 * runs under its own lock and WAITS behind a running booking (a hire must not lose its booking to a
 * concurrent edit). Everything else - the affected-person rule, the free days, the Teilurlaub bound
 * of the hire year's entitlement, four-eyes - is the one `bookCompanyShutdown`.
 *
 * The actor is resolved lazily: a tenant without a future Betriebsurlaub (the common case) costs one
 * query and no permission reads. The caller is reactive and must catch (the hire decoration does).
 */
export async function bookCompanyShutdownsForHire(
  app: FastifyInstance,
  input: {
    tenantId: string;
    employeeId: string;
    resolveActor: () => Promise<ShutdownActor>;
    request: AuditRequestMeta;
  },
): Promise<void> {
  const { tenantId, employeeId } = input;
  const employee = await app.prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { hireDate: true },
  });
  if (!employee) return;
  const tz = await getTenantTimezone(app.prisma, tenantId);
  const hireDay = dateStrInTz(employee.hireDate, tz);
  const candidates = await app.prisma.companyShutdown.findMany({
    where: { tenantId, deletedAt: null, endDate: { gte: new Date(hireDay) } },
    select: { id: true, startDate: true, endDate: true, salons: { select: { salonId: true } } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  // Issue #1079: a salon-scoped Betriebsurlaub whose salons the new person is never homed in on or
  // after the hire day is skipped, so a hire in a chain writes no empty booking summary per salon.
  const scopedCandidates = candidates.filter((shutdown) => shutdown.salons.length > 0);
  const homeDays =
    scopedCandidates.length > 0
      ? await homeSalonsForDays(
          app.prisma,
          tenantId,
          [employeeId],
          scopedCandidates.reduce(
            (min, shutdown) => (dayOf(shutdown.startDate) < min ? dayOf(shutdown.startDate) : min),
            hireDay,
          ),
          scopedCandidates.reduce(
            (max, shutdown) => (dayOf(shutdown.endDate) > max ? dayOf(shutdown.endDate) : max),
            hireDay,
          ),
        )
      : null;
  const shutdowns = candidates.filter((shutdown) => {
    if (shutdown.salons.length === 0) return true;
    const from = dayOf(shutdown.startDate) > hireDay ? dayOf(shutdown.startDate) : hireDay;
    return (
      shutdownAffectedRuns({
        from,
        to: dayOf(shutdown.endDate),
        salonIds: shutdown.salons.map((row) => row.salonId),
        homeSalonByDay: homeDays?.get(employeeId),
      }).length > 0
    );
  });
  if (shutdowns.length === 0) return;

  const actor = await input.resolveActor();
  for (const shutdown of shutdowns) {
    await bookCompanyShutdown(app, {
      tenantId,
      shutdownId: shutdown.id,
      actor,
      employeeIds: [employeeId],
      request: input.request,
      lock: "wait",
    });
  }
}

/**
 * A later Stammsalon change (Issue #1079, D-07): re-books the person for every active salon-scoped
 * Betriebsurlaub with a day on or after `fromDay` (the new `validFrom`). Per shutdown it compares the
 * person's expected affected days (open months, on or after `fromDay`, never an exception) with the
 * days of the person's active absences of that shutdown; only where they differ it
 *   1. cancels the person's generated rows of open months (reason HOME_SALON_CHANGED, the #1069
 *      cancellation core) for ALL differing shutdowns first, and then
 *   2. books each of them for the person again,
 * so a newly affected shutdown never finds days still held by the one the person left. Closed
 * months are never touched (the comparison ignores them). Everything else - the free days, the
 * Teilurlaub bound, four-eyes - is the one `bookCompanyShutdown`.
 *
 * The actor is resolved lazily: a tenant without a salon-scoped Betriebsurlaub in the future (the
 * common case) costs one query and no permission reads. The caller is reactive and must catch (the
 * home-salon decoration does).
 */
export async function rebookCompanyShutdownsForHomeSalonChange(
  app: FastifyInstance,
  input: {
    tenantId: string;
    employeeId: string;
    /** First day of the new Stammsalon, `YYYY-MM-DD`. */
    fromDay: string;
    resolveActor: () => Promise<ShutdownActor>;
    request: AuditRequestMeta;
  },
): Promise<void> {
  const { tenantId, employeeId, fromDay } = input;
  const shutdowns = await app.prisma.companyShutdown.findMany({
    where: {
      tenantId,
      deletedAt: null,
      endDate: { gte: new Date(fromDay) },
      salons: { some: {} },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      salons: { select: { salonId: true } },
      exceptions: { where: { employeeId }, select: { employeeId: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  if (shutdowns.length === 0) return;

  const employee = await app.prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { hireDate: true, exitDate: true },
  });
  if (!employee) return;
  const tz = await getTenantTimezone(app.prisma, tenantId);
  const hireDay = dateStrInTz(employee.hireDate, tz);
  const exitDay = employee.exitDate ? dateStrInTz(employee.exitDate, tz) : null;
  const spanStart = shutdowns.reduce(
    (min, shutdown) => (dayOf(shutdown.startDate) < min ? dayOf(shutdown.startDate) : min),
    dayOf(shutdowns[0].startDate),
  );
  const spanEnd = shutdowns.reduce(
    (max, shutdown) => (dayOf(shutdown.endDate) > max ? dayOf(shutdown.endDate) : max),
    dayOf(shutdowns[0].endDate),
  );
  const homeDays = (
    await homeSalonsForDays(app.prisma, tenantId, [employeeId], spanStart, spanEnd)
  ).get(employeeId);

  const differing: string[] = [];
  for (const shutdown of shutdowns) {
    const startDay = dayOf(shutdown.startDate);
    const endDay = dayOf(shutdown.endDate);
    let from = startDay > hireDay ? startDay : hireDay;
    if (fromDay > from) from = fromDay;
    const to = exitDay !== null && exitDay < endDay ? exitDay : endDay;

    const closedMonths = new Set<string>();
    if (from <= to) {
      for (const { year, month } of await findClosedMonthsInRange(
        app.prisma,
        employeeId,
        tenantId,
        new Date(from),
        new Date(to),
      )) {
        closedMonths.add(`${year}-${String(month).padStart(2, "0")}`);
      }
    }
    const openDay = (day: string) => !closedMonths.has(day.slice(0, 7));

    const expected = new Set<string>();
    if (shutdown.exceptions.length === 0) {
      for (const run of shutdownAffectedRuns({
        from,
        to,
        salonIds: shutdown.salons.map((row) => row.salonId),
        homeSalonByDay: homeDays,
      })) {
        for (const day of eachDay(run.start, run.end)) if (openDay(day)) expected.add(day);
      }
    }

    const booked = new Set<string>();
    const absences = await app.prisma.absence.findMany({
      where: {
        employeeId,
        employee: { tenantId },
        companyShutdownId: shutdown.id,
        type: "COMPANY_SHUTDOWN",
        deletedAt: null,
      },
      select: { startDate: true, endDate: true },
    });
    for (const absence of absences) {
      for (const day of eachDay(dayOf(absence.startDate), dayOf(absence.endDate))) {
        if (day >= fromDay && openDay(day)) booked.add(day);
      }
    }

    const same = expected.size === booked.size && [...expected].every((day) => booked.has(day));
    if (!same) differing.push(shutdown.id);
  }
  if (differing.length === 0) return;

  const actor = await input.resolveActor();
  // Phase 1: release what the person no longer belongs to - for every differing shutdown first.
  for (const shutdownId of differing) {
    await reverseCompanyShutdown(app, {
      tenantId,
      shutdownId,
      employeeIds: [employeeId],
      reason: "HOME_SALON_CHANGED",
      actorUserId: actor.userId,
      request: input.request,
      lock: "wait",
    });
  }
  // Phase 2: book what the person now belongs to.
  for (const shutdownId of differing) {
    await bookCompanyShutdown(app, {
      tenantId,
      shutdownId,
      actor,
      employeeIds: [employeeId],
      request: input.request,
      lock: "wait",
    });
  }
}
