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
 * Deliberately NOT re-exported from `contexts/absence/index.ts` (import-cycle cap 22); importers:
 * `api/company-shutdowns.ts`. The only writer of the code COMPANY_SHUTDOWN (vocabulary guard G5).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@clokr/db";
import {
  accessContextFromRequest,
  hasPermission,
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
import { findClosedMonthsInRange } from "../closed-month-guard";
import { createLeaveRequestCore, notifyLeaveRequestApprovers } from "../leave-request-create";
import {
  approveLeaveRequestCore,
  leaveDecisionGuard,
  loadLeaveRequestForReview,
  type AuditRequestMeta,
} from "../leave-decision";
import { absenceTypeFields } from "../leave-type";
import {
  COMPANY_SHUTDOWN_TRIGGER,
  limitExceptionReasonFor,
  type COMPANY_SHUTDOWN_BOOKED,
} from "./constants";

// A same-file literal (not the imported constant) so the audit-label walk resolves the action; the
// type ties it to the constant of `constants.ts`.
const BOOKED_ACTION: typeof COMPANY_SHUTDOWN_BOOKED = "COMPANY_SHUTDOWN_BOOKED";
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_AND_HALF_MS_NS = 1_500_000n;

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

export type BookOutcome = { ok: true; counts: ShutdownBookingCounts };

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

/** Splits `[from, to]` (`YYYY-MM-DD`, inclusive) at calendar month boundaries. */
function splitByMonth(from: string, to: string): Array<{ start: string; end: string }> {
  const segments: Array<{ start: string; end: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const lastOfMonth = dayOf(new Date(Date.UTC(year, month, 0)));
    segments.push({ start: cursor, end: lastOfMonth < to ? lastOfMonth : to });
    cursor = dayOf(new Date(Date.UTC(year, month, 1)));
  }
  return segments;
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

export async function bookCompanyShutdown(
  app: FastifyInstance,
  input: {
    tenantId: string;
    shutdownId: string;
    actor: ShutdownActor;
    /** Narrows the run to these persons (later hire, exception removal); absent = everybody affected. */
    employeeIds?: readonly string[];
    request: AuditRequestMeta;
  },
): Promise<BookOutcome> {
  const { tenantId, actor } = input;
  const counts = emptyBookingCounts();

  const shutdown = await app.prisma.companyShutdown.findFirst({
    where: { id: input.shutdownId, tenantId, deletedAt: null },
    include: { exceptions: { select: { employeeId: true } } },
  });
  if (!shutdown) return { ok: true, counts };

  const tz = await getTenantTimezone(app.prisma, tenantId);
  const startDay = dayOf(shutdown.startDate);
  const endDay = dayOf(shutdown.endDate);
  const excepted = new Set(shutdown.exceptions.map((e) => e.employeeId));
  const today = todayInTz(tz);
  const currentMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const limitReason = limitExceptionReasonFor(shutdown);

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

  const refreshEmployeeIds = new Set<string>();
  const touchedEmployeeIds: string[] = [];

  for (const person of population) {
    if (excepted.has(person.id)) continue;
    const hireDay = dateStrInTz(person.hireDate, tz);
    const exitDay = person.exitDate ? dateStrInTz(person.exitDate, tz) : null;
    const from = hireDay > startDay ? hireDay : startDay;
    const to = exitDay !== null && exitDay < endDay ? exitDay : endDay;
    if (from > to) continue;
    counts.persons += 1;
    const own = actor.employeeId === person.id;

    for (const segment of splitByMonth(from, to)) {
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
        counts.skippedClosedMonths += 1;
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
      touchedEmployeeIds.push(person.id);

      if (!shutdown.deductsFromVacation) continue;

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
      const willApprove =
        !own &&
        (await isStammsalonScopeMatch(
          app.prisma,
          tenantId,
          actor.approveReach,
          person.id,
          segmentStart,
        ));

      const created = await createLeaveRequestCore(
        app,
        {
          tenantId,
          employeeId: person.id,
          actorUserId: actor.userId,
          body: {
            type: "VACATION",
            startDate: segment.start,
            endDate: segment.end,
            halfDay: false,
          },
          isOnBehalfOf: !own,
          auditExtra: { trigger: COMPANY_SHUTDOWN_TRIGGER, companyShutdownId: shutdown.id },
          notifyApprovers: !willApprove,
          employerOrdered: true,
        },
        {
          inTransaction: async (tx: Prisma.TransactionClient, row: { id: string }) => {
            await tx.leaveRequest.updateMany({
              where: { id: row.id, employee: { tenantId } },
              data: { companyShutdownId: shutdown.id },
            });
          },
        },
      );
      if (!created.ok) {
        bump(counts.refused, created.reason);
        continue;
      }
      // D-835-27: the next create of this run must be stamped strictly after this row's createdAt.
      await waitOneTick(process.hrtime.bigint());

      if (!willApprove) {
        counts.vacationPending += 1;
        continue;
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
        if (segmentStart.getTime() <= currentMonthEnd.getTime()) refreshEmployeeIds.add(person.id);
      } else {
        // Stays PENDING for another approver; they are told, exactly like for any request.
        counts.vacationPending += 1;
        const reason = guard?.reason ?? (decided && !decided.ok ? decided.reason : "NOT_DECIDABLE");
        bump(counts.refused, `APPROVAL_${reason}`);
        await notifyLeaveRequestApprovers(app, {
          tenantId,
          request: created.request,
          typeCode: "VACATION",
          startDay: segment.start,
          endDay: segment.end,
        });
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

  return { ok: true, counts };
}
