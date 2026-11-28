/**
 * auto-break-write.ts
 *
 * Issue #511 (AK-4, D-17) + Issue #799 — the ONE write of an automatic break. Issue #655 — and
 * `runClockStopSteps`, the ONE post-STOP step every clock trigger (web, NFC, WIFI, future sources)
 * runs after the resolver has closed or consolidated an entry: first the automatic break, then the
 * reactive JArbSchG notice. WHICH break (regime, amount, placement) is decided by `planAutoBreak`;
 * this module only decides WHEN a stopped entry gets one and writes it.
 */
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@clokr/db";
import { planAutoBreak, type AutoBreakPlan } from "./auto-break-plan";
import { notifyMinorDayFindingsAfterClockStop } from "./minor-day-notice"; // Issue #655

export type StoredBreak = {
  id: string;
  timeEntryId: string;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
};

/**
 * The two writes of an automatic break — the planned Break rows and the entry's summary fields —
 * on an open transaction handle. Issue #1021: the ONE writer, also called by the Zeitnachtrag
 * approval, which already runs inside its own transaction.
 */
export async function writeAutoBreakInTx(
  tx: Prisma.TransactionClient,
  params: { entryId: string; plan: AutoBreakPlan },
): Promise<{ minutes: number; breaks: StoredBreak[] }> {
  const { entryId, plan } = params;
  const breaks = await tx.break.createManyAndReturn({
    data: plan.segments.map((s) => ({
      timeEntryId: entryId,
      startTime: s.startTime,
      endTime: s.endTime,
      isAuto: true, // Issue #799: the row-level marker the reopen replacement selects on
    })),
  });
  // Phase 91 (BREAK-02): Pflichtpause auto-inserted → mark AUTO for confirmation
  await tx.timeEntry.update({
    where: { id: entryId },
    data: { breakMinutes: plan.amountMin, breakStatus: "AUTO" },
  });
  return { minutes: plan.amountMin, breaks };
}

/**
 * Writes the planned Break rows and the entry's summary fields together or not at all. Returns the
 * minutes written (shared by the clock STOP step and the manual POST).
 */
export async function autoInsertBreak(
  app: FastifyInstance,
  params: { entryId: string; plan: AutoBreakPlan },
): Promise<{ minutes: number; breaks: StoredBreak[] }> {
  return app.prisma.$transaction((tx) => writeAutoBreakInTx(tx, params));
}

/**
 * Issue #799: the automatic break of an entry a clock STOP just closed (CLOCKED_OUT or
 * CONSOLIDATED) — the automatic-break half of `runClockStopSteps`, which is what the clock adapters
 * call. One rule, no per-source copy. Month locks are already refused by the resolver before a STOP is written, so a locked
 * month never reaches this step.
 *
 * Skipped when Break rows already exist on the entry (D-01 Pitfall 1): a reopened entry carries a
 * gap Break and an automatic break must not overwrite its breakMinutes.
 */
export async function applyAutoBreakAfterClockStop(
  app: FastifyInstance,
  params: { entryId: string; employeeId: string; tz: string },
): Promise<{ minutes: number; breaks: StoredBreak[] }> {
  const { entryId, employeeId, tz } = params;
  const none = { minutes: 0, breaks: [] as StoredBreak[] };
  const employee = await app.prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return none;
  const tenantConfig = await app.prisma.tenantConfig.findUnique({
    where: { tenantId: employee.tenantId },
  });
  const existingBreakCount = await app.prisma.break.count({ where: { timeEntryId: entryId } });
  if (!tenantConfig?.autoBreakEnabled || existingBreakCount !== 0) return none;
  const closedEntry = await app.prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!closedEntry?.startTime || !closedEntry?.endTime) return none;
  // Issue #511 (D-20): minors get at least the § 11 JArbSchG amount; adults unchanged.
  const plan = planAutoBreak({
    employee,
    tenantConfig,
    start: closedEntry.startTime,
    end: closedEntry.endTime,
    entryDate: closedEntry.date,
    tz,
  });
  if (!plan) return none;
  return autoInsertBreak(app, { entryId, plan });
}

/**
 * Issue #655 (builds on #799): the ONE post-STOP step. Every clock adapter (web clock-out, NFC
 * punch, WLAN disconnect) calls it after `resolveClockEvent` closed or consolidated an entry:
 *
 *   1. the automatic break (`applyAutoBreakAfterClockStop`), so the day total below includes it;
 *   2. the JArbSchG notice for a person under 18 (§ 8 over day and week, § 9 over the day total).
 *
 * The notice is reactive (ADR 0002, Entscheidung 10): the STOP is already committed, so a failure
 * is logged and never rethrown — clocking is never refused or failed for a JArbSchG finding.
 * Returns the automatic-break result, which the web clock-out response shows.
 */
export async function runClockStopSteps(
  app: FastifyInstance,
  params: { entryId: string; employeeId: string; tz: string },
): Promise<{ minutes: number; breaks: StoredBreak[] }> {
  const autoBreak = await applyAutoBreakAfterClockStop(app, params);
  try {
    await notifyMinorDayFindingsAfterClockStop(app, params);
  } catch (err) {
    app.log.error(
      { err, entryId: params.entryId, employeeId: params.employeeId },
      "JArbSchG clock-stop notice failed",
    );
  }
  return autoBreak;
}
