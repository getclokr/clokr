/**
 * The ONE implementation of "cancel a leave request and book back what it booked" for
 * SYSTEM-ORDERED cancellations - a cancellation the employer's own act causes, not a request a
 * person made and another manager reviews:
 *
 *   - Issue #614: the employment exit (DSGVO anonymization) cancels requests lying after the exit day;
 *   - Issue #1069: a change or deletion of a Betriebsurlaub, or an exception added to it, cancels the
 *     Urlaub it generated.
 *
 * Extracted UNCHANGED from `employment-exit.ts` (audit keys and values stay identical - the #614 /
 * #615 tests are the proof). Two steps, so a caller can run the first before its transaction opens:
 *
 *   1. {@link planLeaveCancellation}   pure reads: the holiday dates a VACATION / § 9 undo needs and
 *                                       the stored OVERTIME_COMP amount, plus the optimistic guard;
 *   2. {@link cancelLeaveRequestInTx}  every write plus the audit rows, inside the caller's
 *                                       transaction: status CANCELLED (guarded), invalid time entries
 *                                       of a pending cancellation revalidated, Urlaub booked back
 *                                       (`reverseVacationDays`), § 9 credits superseded
 *                                       (`supersedeSection9CreditsOfCancelledRequest`), the CANCEL
 *                                       audit row with the caller's marker, and an OVERTIME_COMP
 *                                       withdrawal reversed.
 *
 * What stays with the caller: which rows to cancel (the exit's skip rules for a closed month or an
 * active § 17 BEEG reduction, the Betriebsurlaub's own closed-month rule), the transaction, the
 * audit port, the conflict error type, and the reactive tail after the commit. The approval route's
 * cancellation branch (a person requests, ANOTHER manager approves - `leave.ts`) is untouched: it is
 * a reviewed decision, not a consequence of an employer act.
 *
 * Deliberately NOT re-exported from `contexts/absence/index.ts` (import-cycle cap 22).
 */
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Prisma } from "@clokr/db";
import { reverseOvertimeCompensation } from "../working-time-account";
import { revalidateLeaveCancellationEntries } from "../time-tracking";
import { getHolidayMap, reverseVacationDays } from "./leave-days";
import { overtimeCompReversalMinutes } from "./overtime-comp-minutes";
import {
  Section9ConcurrentCorrectionError,
  supersedeSection9CreditsOfCancelledRequest,
} from "./section9-supersede";
import { dayLabelDe } from "../../utils/day-label-de";

export type OpenLeaveStatus = "PENDING" | "APPROVED" | "CANCELLATION_REQUESTED";

/** A leave request to cancel: cancel it and book back what it booked. */
export interface CancelLeaveAction {
  kind: "cancelLeave";
  requestId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  days: number;
  /** Optimistic guard: the row must still look like this inside the transaction. */
  guard: { status: OpenLeaveStatus; startDate: Date; endDate: Date; updatedAt: Date };
  /** Holiday dates of the request range (VACATION / § 9 only), read before the transaction. */
  holidayDates: string[];
  /** The amount to give back for an OVERTIME_COMP booking (stored, else recomputed); else null. */
  overtimeReversal: { minutes: number; source: "stored" | "recomputed" } | null;
}

/**
 * The audit marker merged into every audit row the cancellation writes: the German display reason,
 * the machine trigger and, optionally, further ids or codes (never free text).
 */
export interface LeaveCancellationMarker {
  auditReason: string;
  trigger: string;
  [key: string]: string | number | boolean | null;
}

/** Writes one audit row inside the caller's transaction (the caller binds the actor and request). */
export type LeaveCancellationAuditPort = (entry: {
  action: string;
  entity: string;
  entityId: string;
  oldValue?: object;
  newValue?: object;
}) => Promise<void>;

/** The columns of a leave request {@link planLeaveCancellation} reads. */
export interface CancelableRow {
  id: string;
  leaveTypeId: string;
  status: string;
  days: { toString(): string };
  halfDay: boolean;
  overtimeCompMinutes: number | null;
  startDate: Date;
  endDate: Date;
  updatedAt: Date;
  leaveType: { code: string };
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Phase 1 - pure reads. Builds the cancel action of `row`; the caller has already decided that the
 * row is to be cancelled (its own protection rules, e.g. a closed month, come before this).
 */
export async function planLeaveCancellation(
  prisma: FastifyInstance["prisma"],
  log: Pick<FastifyBaseLogger, "warn">,
  input: {
    tenantId: string;
    employeeId: string;
    row: CancelableRow;
    /** The tenant time zone, read lazily (only an OVERTIME_COMP recomputation needs it). */
    tenantTz: () => Promise<string>;
  },
): Promise<CancelLeaveAction> {
  const { tenantId, employeeId, row } = input;
  // Issue #662: a live § 9 credit no longer protects the row - the cancellation supersedes it
  // (section9-supersede.ts, the rule the cancellation approval runs). The holiday set is then
  // needed for the ledger undo of a CONFIRMED credit even on a non-vacation (sick) row.
  const hasSection9Credit =
    (await prisma.section9Credit.count({
      where: {
        employeeId,
        employee: { tenantId },
        status: { not: "SUPERSEDED" },
        OR: [{ vacationRequestId: row.id }, { sickRequestId: row.id }],
      },
    })) > 0;

  // A PENDING request booked nothing; every other status reverses what its approval booked.
  const booked = row.status !== "PENDING";
  const code = row.leaveType.code;
  let holidayDates: string[] = [];
  if (booked && (code === "VACATION" || hasSection9Credit)) {
    const holidays = await getHolidayMap(prisma, tenantId, employeeId, row.startDate, row.endDate);
    holidayDates = [...holidays.keys()];
  }
  let overtimeReversal: CancelLeaveAction["overtimeReversal"] = null;
  if (booked && code === "OVERTIME_COMP") {
    // Issue #468 (A-4/D-02): the STORED booking is reversed; only a legacy row is recomputed.
    overtimeReversal = await overtimeCompReversalMinutes(
      prisma,
      tenantId,
      { ...row, employeeId },
      async () => {
        const holidays = await getHolidayMap(
          prisma,
          tenantId,
          employeeId,
          row.startDate,
          row.endDate,
        );
        return { holidays: new Set(holidays.keys()), tz: await input.tenantTz() };
      },
    );
    if (overtimeReversal.source === "recomputed") {
      log.warn(
        { leaveRequestId: row.id, employeeId },
        "OVERTIME_COMP reversal without a stored booking — recomputed (Issue #468 A-4 legacy fallback)",
      );
    }
  }
  return {
    kind: "cancelLeave",
    requestId: row.id,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: code,
    days: Number(row.days),
    guard: {
      status: row.status as OpenLeaveStatus,
      startDate: row.startDate,
      endDate: row.endDate,
      updatedAt: row.updatedAt,
    },
    holidayDates,
    overtimeReversal,
  };
}

/**
 * Phase 2 - cancels one request and books back exactly what an approved cancellation books back.
 * `marker` is merged into every audit row; `cancelExtra` only into the CANCEL row (the exit's
 * `exitDate`). `conflict` builds the caller's error for a row that changed between plan and apply
 * (a guarded update that matched no row, or a concurrent § 9 correction).
 */
export async function cancelLeaveRequestInTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    employeeId: string;
    action: CancelLeaveAction;
    marker: LeaveCancellationMarker;
    cancelExtra?: Record<string, string | number | boolean | null>;
    audit: LeaveCancellationAuditPort;
    conflict: (entity: "LeaveRequest", id: string) => Error;
  },
): Promise<void> {
  const { tenantId, employeeId, action, marker, audit, conflict } = input;

  // The cancellation is not a review: no reviewedBy / reviewNote change. The guard makes the
  // update an optimistic lock - 0 rows means the request changed between plan and apply.
  const { count } = await tx.leaveRequest.updateMany({
    where: {
      id: action.requestId,
      employeeId,
      employee: { tenantId },
      deletedAt: null,
      status: action.guard.status,
      startDate: action.guard.startDate,
      endDate: action.guard.endDate,
      updatedAt: action.guard.updatedAt,
    },
    data: { status: "CANCELLED" },
  });
  if (count !== 1) throw conflict("LeaveRequest", action.requestId);

  if (action.guard.status !== "PENDING") {
    // Time entries created while a cancellation was pending become valid again (as the approval
    // does), one UPDATE audit per revalidated row (Issue #370, D-04).
    const revalidated = await revalidateLeaveCancellationEntries(
      tx,
      employeeId,
      tenantId,
      action.guard.startDate,
      action.guard.endDate,
    );
    for (const row of revalidated) {
      await audit({
        action: "UPDATE",
        entity: "TimeEntry",
        entityId: row.id,
        oldValue: row.oldValue,
        newValue: { ...row.newValue, ...marker },
      });
    }

    if (action.leaveTypeCode === "VACATION") {
      await reverseVacationDays(
        tx,
        employeeId,
        action.leaveTypeId,
        action.guard.startDate,
        action.guard.endDate,
        action.days,
        new Set(action.holidayDates),
        tenantId,
      );
    }
  }

  // Issue #662: a cancelled request leaves no § 9 credit standing - the same shared supersession
  // the cancellation approval runs (section9-supersede.ts), audited with the caller's marker.
  try {
    await supersedeSection9CreditsOfCancelledRequest(tx, {
      requestId: action.requestId,
      employeeId,
      tenantId,
      holidays: new Set(action.holidayDates),
      audit: (entry) => audit({ ...entry, newValue: { ...(entry.newValue ?? {}), ...marker } }),
    });
  } catch (err) {
    if (err instanceof Section9ConcurrentCorrectionError) {
      throw conflict("LeaveRequest", action.requestId);
    }
    throw err;
  }

  await audit({
    action: "CANCEL",
    entity: "LeaveRequest",
    entityId: action.requestId,
    oldValue: {
      status: action.guard.status,
      startDate: isoDay(action.guard.startDate),
      endDate: isoDay(action.guard.endDate),
      days: action.days,
      leaveTypeCode: action.leaveTypeCode,
    },
    newValue: { status: "CANCELLED", ...marker, ...input.cancelExtra },
  });

  if (action.overtimeReversal) {
    const { minutes, source } = action.overtimeReversal;
    await reverseOvertimeCompensation(
      tx,
      employeeId,
      tenantId,
      minutes / 60,
      `Stornierung Überstundenausgleich ${dayLabelDe(action.guard.startDate)} (${marker.auditReason})`,
    );
    await audit({
      action: "OVERTIME_COMP_REVERSED",
      entity: "LeaveRequest",
      entityId: action.requestId,
      newValue: { overtimeCompMinutes: minutes, hours: minutes / 60, source },
    });
  }
}
