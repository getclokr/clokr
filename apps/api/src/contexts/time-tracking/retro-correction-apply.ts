/**
 * retro-correction-apply.ts
 *
 * Issue #1021 — the ONE place the rule lives that APPLIES an approved correction proposal.
 *
 * A correction proposal (`POST /retro-entry-requests`) is a RetroEntryRequest that is not coupled
 * to any TimeEntry: the person proposes times for a past day outside the retro window. Until
 * #1021 its approval only flipped the status to APPROVED and waited for a grant redemption
 * (`grantId` on POST/PUT /time-entries) that no client ever sends, so the approved times never
 * reached the record. The approval now writes them, in the SAME transaction as the decision,
 * through the building blocks every other interval writer uses (month lock, overlap re-check,
 * travel neighbour check, activity share check, audit with old and new values).
 *
 * Outcomes, by the recorded WORK entries of the day (`selectRetroApplyTarget`):
 *   - exactly one  -> CORRECT: its times are overwritten; the request ends USED, with a
 *                     RETRO_ENTRY_APPROVED_USED audit — byte-for-byte the end state of a redeemed
 *                     PUT grant. The entry is NOT coupled to the request: `TimeEntry.retroRequestId`
 *                     is `@unique`, the entry may already be coupled to an earlier approved
 *                     entry-first request (overwriting would turn THAT request into a redeemable
 *                     grant, a four-eyes bypass), and any coupled row changes clock consolidation
 *                     (`retro_row` guard in services/clock/consolidate.ts).
 *   - none         -> CREATE: one entry is created and coupled to the request (`retroRequestId`);
 *                     the request stays APPROVED — byte-for-byte the end state of an approved
 *                     entry-first Nachtrag (a coupled entry exists BECAUSE of the request).
 *   - two or more  -> AMBIGUOUS: German 409, the request stays PENDING; nothing is guessed.
 *
 * Both end states make the grant guard `status APPROVED + timeEntry is null` (time-entries.ts POST
 * and PUT, and both USED flips) false, so an applied request can never be redeemed a second time.
 *
 * Not re-exported from `index.ts`: only the review route imports it (keeps the measured import
 * cycle cap unchanged).
 */
import type { FastifyInstance } from "fastify";
import type { Prisma, TimeEntry } from "@clokr/db";
import { isMonthClosed, monthRangeUtc } from "../working-time-account";
import { hasApprovedLeaveOnDate, DISPLAY_NAME } from "../absence";
import type { AccessContext } from "../platform";
import { calcBreakMinutesLocal } from "../../services/clock/consolidate";
import { findEntriesOfDay, isPendingRetroRow } from "./day-entries";
import { recheckOverlapInTx } from "./entry-invariants";
import { checkTravelNeighbours } from "./travel-entry";
import { resolveEntrySalon } from "./entry-salon";
import { validateActivityState } from "./activity-shares";
import { CLEARED_INVALID_REASON, invalidReasonFields } from "./invalid-reason";
import { writeAutoBreakInTx } from "./auto-break-write";
import type { AutoBreakPlan } from "./auto-break-plan";

// ── Refusals ──────────────────────────────────────────────────────────────────

export const RETRO_APPLY_AMBIGUOUS_CODE = "RETRO_APPLY_AMBIGUOUS";
export const RETRO_APPLY_AMBIGUOUS_MESSAGE =
  "An diesem Tag gibt es mehrere Einträge. Der Zeitnachtrag lässt sich keinem davon eindeutig zuordnen – bitte lehne ihn ab.";
export const RETRO_APPLY_NO_TIMES_CODE = "RETRO_APPLY_NO_TIMES";
export const RETRO_APPLY_NO_TIMES_MESSAGE =
  "Der Zeitnachtrag enthält keine Zeiten. Gib Beginn und Ende an oder lehne ihn ab.";
export const RETRO_APPLY_ROW_DELETED_CODE = "RETRO_APPLY_ROW_DELETED";
export const RETRO_APPLY_ROW_DELETED_MESSAGE =
  "Der Eintrag dieses Zeitnachtrags wurde gelöscht – bitte lehne ihn ab.";
export const RETRO_APPLY_BREAK_RUNNING_CODE = "RETRO_APPLY_BREAK_RUNNING";
export const RETRO_APPLY_BREAK_RUNNING_MESSAGE =
  "Für den Eintrag dieses Tages läuft noch eine Pause. Der Zeitnachtrag kann erst übernommen werden, wenn die Pause beendet ist.";

/** The month-lock text, byte-identical to `validateTimeEntryInvariants` step 1. */
const MONTH_LOCKED_MESSAGE = "Monat ist abgeschlossen und kann nicht bearbeitet werden";
const ENTRY_LOCKED_MESSAGE = "Eintrag ist gesperrt und kann nicht bearbeitet werden";

/**
 * Thrown from inside the review transaction so it rolls back (the request stays PENDING and
 * nothing is written); the route answers the exact status and body.
 */
export class RetroApplyRefusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly body: { error: string; code?: string; maxShareMinutes?: number },
  ) {
    super(body.error);
    this.name = "RetroApplyRefusal";
  }
}

export const retroApplyAmbiguousRefusal = (): RetroApplyRefusal =>
  new RetroApplyRefusal(409, {
    error: RETRO_APPLY_AMBIGUOUS_MESSAGE,
    code: RETRO_APPLY_AMBIGUOUS_CODE,
  });

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** The facts of a day row the target selection reads. */
type DayRow = Pick<
  TimeEntry,
  | "id"
  | "type"
  | "activityKind"
  | "retroRequestId"
  | "isInvalid"
  | "invalidReasonCode"
  | "startTime"
  | "endTime"
>;

export type RetroApplyTarget =
  { kind: "CREATE" } | { kind: "CORRECT"; entryId: string } | { kind: "AMBIGUOUS" };

/**
 * Which entry of the day a correction proposal applies to. Candidates are recorded WORK rows: a
 * pending Zeitnachtrag row is another open request, not a recorded entry, and a trip is never
 * corrected by a proposal. Non-candidates still take part in the overlap and travel checks.
 */
export function selectRetroApplyTarget(rows: readonly DayRow[]): RetroApplyTarget {
  const candidates = rows.filter(
    (r) => r.type === "WORK" && r.activityKind !== "TRAVEL" && !isPendingRetroRow(r),
  );
  if (candidates.length === 0) return { kind: "CREATE" };
  if (candidates.length === 1) return { kind: "CORRECT", entryId: candidates[0].id };
  return { kind: "AMBIGUOUS" };
}

/**
 * What happens to the entry's break after its interval moves. The stored `breakMinutes` stay
 * (unless the approval carries its own value); the Break rows stay iff every row still lies inside
 * the new interval and their rounded sum does not exceed the total — then they keep their
 * positions. Otherwise their positions are unknown and the rows are replaced (deleted). The kernel
 * reads total minus placed rows as an unplaced remainder (hint `BREAK_POSITION_UNKNOWN`, never a
 * violation), so § 4 ArbZG stays judged in the day-break kernel and no break rule lives here.
 */
export function carryOverBreaks(input: {
  breaks: readonly { startTime: Date; endTime: Date }[];
  storedBreakMinutes: number | null | undefined;
  start: Date;
  end: Date;
  approvedBreakMinutes: number | null | undefined;
}): { breakMinutes: number; replaceRows: boolean; changed: boolean } {
  const total = input.approvedBreakMinutes ?? input.storedBreakMinutes ?? 0;
  const inside = input.breaks.every(
    (b) =>
      b.startTime.getTime() >= input.start.getTime() && b.endTime.getTime() <= input.end.getTime(),
  );
  const fits =
    input.breaks.length === 0 ||
    (inside && Math.round(calcBreakMinutesLocal([...input.breaks])) <= total);
  const replaceRows = input.breaks.length > 0 && !fits;
  return {
    breakMinutes: total,
    replaceRows,
    changed: total !== (input.storedBreakMinutes ?? 0) || replaceRows,
  };
}

// ── The apply ─────────────────────────────────────────────────────────────────

export type ApplyRetroRequestInput = {
  tenantId: string;
  employeeId: string;
  requestId: string;
  /** The stored `@db.Date` value of the request's target day. */
  targetDate: Date;
  targetDateStr: string;
  tz: string;
  start: Date;
  end: Date;
  approvedBreakMinutes: number | null;
  /** The approver sent corrected times: the TimeEntry audit action is MANAGER_CORRECTION. */
  hasManagerCorrection: boolean;
  /** The automatic break planned for a created entry (computed before the transaction). */
  autoBreakPlan?: AutoBreakPlan | null;
  actor: {
    userId: string;
    employeeId: string | null;
    access: AccessContext;
    request: { ip: string; headers: Record<string, string | string[] | undefined> };
  };
};

export type ApplyRetroRequestResult = {
  outcome: "CORRECTED" | "CREATED";
  entryId: string;
};

const ENTRY_INCLUDE = {
  breaks: { orderBy: { startTime: "asc" } },
  activityShares: { select: { kind: true, minutes: true }, orderBy: { kind: "asc" } },
} satisfies Prisma.TimeEntryInclude;

/**
 * Applies an approved correction proposal. Runs inside the review transaction AFTER the Employee
 * row lock and the PENDING -> APPROVED flip; any refusal throws and rolls everything back.
 */
export async function applyApprovedRetroRequestInTx(
  app: FastifyInstance,
  tx: Prisma.TransactionClient,
  input: ApplyRetroRequestInput,
): Promise<ApplyRetroRequestResult> {
  const { tenantId, employeeId, requestId, targetDate, targetDateStr, tz, start, end, actor } =
    input;

  // a. Month lock — the same text the shared invariants answer.
  const [year, month] = targetDateStr.split("-").map(Number);
  if (await isMonthClosed(tx, employeeId, tenantId, monthRangeUtc(year, month, tz).start)) {
    throw new RetroApplyRefusal(403, { error: MONTH_LOCKED_MESSAGE });
  }

  // b. § 8 BUrlG — approved leave blocks, a pending cancellation writes an invalid entry.
  const leave = await hasApprovedLeaveOnDate(tx, employeeId, targetDateStr);
  if (leave?.status === "APPROVED") {
    throw new RetroApplyRefusal(409, {
      error: `§ 8 BUrlG: An diesem Tag ist ${DISPLAY_NAME[leave.code]} genehmigt. Bitte zuerst stornieren.`,
    });
  }
  const cancellationPending = leave?.status === "CANCELLATION_REQUESTED";
  const invalidFields = cancellationPending
    ? invalidReasonFields("LEAVE_CANCELLATION_PENDING")
    : CLEARED_INVALID_REASON;
  const invalidReasonCode = cancellationPending ? ("LEAVE_CANCELLATION_PENDING" as const) : null;

  // c. The entry of the day this proposal applies to.
  const dayRows = await findEntriesOfDay(tx, { tenantId, employeeId, date: targetDate });
  const target = selectRetroApplyTarget(dayRows);
  if (target.kind === "AMBIGUOUS") throw retroApplyAmbiguousRefusal();

  const auditRequest = actor.request;

  if (target.kind === "CORRECT") {
    // d. CORRECT — re-read inside the transaction; this row is the audit oldValue.
    const before = await tx.timeEntry.findFirst({
      where: { id: target.entryId, employeeId, deletedAt: null, employee: { tenantId } },
      include: ENTRY_INCLUDE,
    });
    if (!before) throw retroApplyAmbiguousRefusal(); // vanished under the lock: no safe target
    if (before.isLocked) {
      throw new RetroApplyRefusal(403, { error: ENTRY_LOCKED_MESSAGE });
    }
    // The running break is a server state set and cleared only by the clock resolver (#596/#845).
    if (before.endTime === null && before.breakStartedAt !== null) {
      throw new RetroApplyRefusal(409, {
        error: RETRO_APPLY_BREAK_RUNNING_MESSAGE,
        code: RETRO_APPLY_BREAK_RUNNING_CODE,
      });
    }

    const carried = carryOverBreaks({
      breaks: before.breaks,
      storedBreakMinutes: before.breakMinutes,
      start,
      end,
      approvedBreakMinutes: input.approvedBreakMinutes,
    });

    if (before.activityShares.length > 0) {
      const activityCheck = validateActivityState(
        {
          kind: before.activityKind,
          shares: before.activityShares,
          startTime: start,
          endTime: end,
          breakMinutes: carried.breakMinutes,
        },
        { sharesWritten: false, wasClosed: before.endTime !== null },
      );
      if (!activityCheck.ok) throw new RetroApplyRefusal(activityCheck.status, activityCheck.body);
    }

    await recheckOverlapInTx(tx, {
      tenantId,
      employeeId,
      newStart: start,
      newEnd: end,
      date: targetDate,
      tz,
      excludeEntryId: before.id,
      callerEmployeeId: actor.employeeId,
      access: actor.access,
    });
    // ONE evaluation: the approval keeps the date, so stored (`without`) and resulting (`with`)
    // state go into the same call. The salon is never re-derived.
    await checkTravelNeighbours(tx, {
      tenantId,
      employeeId,
      date: before.date,
      without: before.id,
      with: {
        id: before.id,
        startTime: start,
        endTime: end,
        salonId: before.salonId,
        type: before.type,
        invalidReasonCode,
      },
    });

    if (carried.replaceRows) {
      await tx.break.deleteMany({ where: { timeEntryId: before.id } });
    }
    const after = await tx.timeEntry.update({
      where: { id: before.id },
      data: {
        startTime: start,
        endTime: end,
        breakMinutes: carried.breakMinutes,
        ...(carried.changed ? { breakStatus: "CONFIRMED" as const } : {}),
        source: "CORRECTION",
        isInvalid: cancellationPending,
        ...invalidFields,
      },
      include: ENTRY_INCLUDE,
    });
    await app.audit({
      tx,
      userId: actor.userId,
      action: input.hasManagerCorrection ? "MANAGER_CORRECTION" : "UPDATE",
      entity: "TimeEntry",
      entityId: before.id,
      oldValue: before,
      newValue: after,
      request: auditRequest,
    });

    // The request ends USED — the grant flip's own guard, so an applied request is never redeemable.
    const used = await tx.retroEntryRequest.updateMany({
      where: { id: requestId, status: "APPROVED", deletedAt: null, timeEntry: { is: null } },
      data: { status: "USED" },
    });
    if (used.count !== 1) {
      throw new Error("RETRO_APPLY_INVARIANT: approved request could not be marked USED");
    }
    await app.audit({
      tx,
      userId: actor.userId,
      action: "RETRO_ENTRY_APPROVED_USED",
      entity: "RetroEntryRequest",
      entityId: requestId,
      oldValue: { status: "APPROVED" },
      newValue: { timeEntryId: before.id, employeeId, date: targetDateStr },
      request: auditRequest,
    });
    return { outcome: "CORRECTED", entryId: before.id };
  }

  // e. CREATE — no recorded entry on the day.
  const salon = await resolveEntrySalon(tx, { tenantId, employeeId, startTime: start });
  if (!salon.ok) throw new RetroApplyRefusal(salon.status, salon.body);

  await recheckOverlapInTx(tx, {
    tenantId,
    employeeId,
    newStart: start,
    newEnd: end,
    date: targetDate,
    tz,
    callerEmployeeId: actor.employeeId,
    access: actor.access,
  });
  await checkTravelNeighbours(tx, {
    tenantId,
    employeeId,
    date: targetDate,
    with: {
      startTime: start,
      endTime: end,
      salonId: salon.salonId,
      type: "WORK",
      invalidReasonCode,
    },
  });

  const created = await tx.timeEntry.create({
    data: {
      employeeId,
      date: targetDate,
      startTime: start,
      endTime: end,
      breakMinutes: input.approvedBreakMinutes ?? 0,
      source: "CORRECTION",
      createdBy: actor.userId,
      salonId: salon.salonId,
      isInvalid: cancellationPending,
      ...invalidFields,
      retroRequestId: requestId,
    },
  });
  // One writer for automatic breaks (POST parity): only when no break was approved.
  if (input.autoBreakPlan) {
    await writeAutoBreakInTx(tx, { entryId: created.id, plan: input.autoBreakPlan });
  }
  const createdFull = await tx.timeEntry.findUniqueOrThrow({
    where: { id: created.id },
    include: ENTRY_INCLUDE,
  });
  await app.audit({
    tx,
    userId: actor.userId,
    action: "CREATE",
    entity: "TimeEntry",
    entityId: created.id,
    newValue: createdFull,
    request: auditRequest,
  });
  return { outcome: "CREATED", entryId: created.id };
}
