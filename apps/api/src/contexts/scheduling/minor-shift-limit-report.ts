/**
 * minor-shift-limit-report.ts
 *
 * Issue #1074 — end-of-run § 8 / § 12 JArbSchG report of the Phorest shift sync. Phorest leads, so
 * the sync cannot refuse, shorten or move a shift; instead, after a successful run, every
 * (person, ISO week) that received a fresh Phorest slot is checked over the STORED week with the
 * roster's own rule (`findStoredMinorWeekViolations`, Issue #1057 — no second rule, no second
 * loader) and the planners are told. Same detect + notify shape as `shift-week-capacity.ts`.
 *
 *  - GD-1: report, never refuse or alter. Nothing is written except Notification rows.
 *  - GD-4: recipients are the active holders of `shift:plan` (ZUGEWIESEN) whose reach covers the
 *    run's salon and the person. The person herself is not notified.
 *  - GD-5: only weeks with a fresh slot of the run are checked (the weeks the import can have made
 *    illegal); the whole stored week counts, all salons and origins (§ 4 Abs. 5 JArbSchG).
 *  - GD-6: one open notification per (recipient, person, week, finding text); a changed finding is
 *    reported anew, dismissing re-arms.
 *  - GD-7: no birth date and no age in title, message, e-mail subject or log; logs carry ids only.
 *  - GD-8: no audit row — nothing is mutated; the Notification row is the durable record.
 *  - GD-9: never throws. A throw after `finalizeRun` would turn a successful run row into ERROR.
 *
 * Not under `facade/`: it is a Schichtplanung-internal pass called by the sync of the same context
 * area, not a read API for other contexts.
 */
import type { FastifyInstance } from "fastify";
import { userIdsHoldingPermission, resolveScopedHolderIds, isShiftInScope } from "../platform";
import { mondayOfWeekUtc } from "../absence";
import {
  loadMinorShiftWeeks,
  findStoredMinorWeekViolations,
  minorShiftLimitLabel,
  type MinorShiftLimitViolation,
} from "./minor-shift-limits";

export interface MinorShiftLimitReportInput {
  tenantId: string;
  /** The salon of the sync run — the reach is judged against it. */
  salonId: string;
  coveredDays: ReadonlyArray<{ employeeId: string; dateIso: string }>;
}

export interface NotifyMinorShiftLimitViolationsParams {
  tenantId: string;
  salonId: string;
  employeeId: string;
  employeeName: { firstName: string; lastName: string };
  weekStart: Date;
  violations: MinorShiftLimitViolation[];
}

/**
 * Notifies the planners of one minor's week. Returns the number of notifications created. Never
 * throws.
 */
export async function notifyMinorShiftLimitViolationsOnce(
  app: FastifyInstance,
  params: NotifyMinorShiftLimitViolationsParams,
): Promise<number> {
  const { tenantId, salonId, employeeId, employeeName, weekStart, violations } = params;
  if (violations.length === 0) return 0;
  const relatedId = `${employeeId}:${weekStart.toISOString().slice(0, 10)}`;
  let created = 0;

  try {
    const planHolderIds = await userIdsHoldingPermission(
      app.prisma,
      tenantId,
      "shift:plan:ZUGEWIESEN",
    );
    const scopedHolderIds = await resolveScopedHolderIds(
      app.prisma,
      tenantId,
      planHolderIds,
      "shift:plan:ZUGEWIESEN",
      (reach) => isShiftInScope(reach, { salonId, employeeId }),
    );
    const managers = await app.prisma.user.findMany({
      where: {
        isActive: true,
        id: { in: scopedHolderIds },
        employee: { tenantId },
      },
      select: { id: true },
    });

    const [first, ...others] = violations;
    const further =
      others.length > 0
        ? ` Weitere Verstöße in dieser Woche: ${others.map(minorShiftLimitLabel).join(", ")}.`
        : "";
    const message = `${first.message}${further} Clokr übernimmt den Plan aus Phorest unverändert. Bitte pass ihn in Phorest an.`;
    const title = `Jugendarbeitsschutz verletzt: ${employeeName.firstName} ${employeeName.lastName}`;

    for (const mgr of managers) {
      // Content-aware dedup (GD-6): the same open finding is not repeated, a changed one is new.
      const already = await app.prisma.notification.findFirst({
        where: {
          userId: mgr.id,
          type: "SHIFT_JARBSCHG_VIOLATION",
          relatedType: "ShiftJarbschgWeek",
          relatedId,
          dismissedAt: null,
          message,
        },
        select: { id: true },
      });
      if (already) continue;

      let failed = false;
      await app
        .notify({
          userId: mgr.id,
          type: "SHIFT_JARBSCHG_VIOLATION",
          title,
          message,
          link: "/shifts",
          tenantId,
          relatedType: "ShiftJarbschgWeek",
          relatedId,
          emailSubject: "Hinweis zur Schichtplanung",
        })
        .catch((err) => {
          failed = true;
          app.log.warn(
            { err, managerId: mgr.id, employeeId },
            "Failed to notify manager of SHIFT_JARBSCHG_VIOLATION",
          );
        });
      if (!failed) created++;
    }
  } catch (err) {
    app.log.warn({ err, employeeId }, "SHIFT_JARBSCHG_VIOLATION manager-notify pass failed");
  }
  return created;
}

/**
 * Checks every minor's week touched by the run and reports findings. Never throws; a failing week
 * is logged (ids only) and skipped.
 */
export async function reportMinorShiftLimitViolations(
  app: FastifyInstance,
  input: MinorShiftLimitReportInput,
): Promise<{ minorWeeksChecked: number; minorWeeksWithViolations: number }> {
  const { tenantId, salonId, coveredDays } = input;
  let minorWeeksChecked = 0;
  let minorWeeksWithViolations = 0;

  try {
    // Group the covered days by ISO Monday into distinct employee ids.
    const byWeek = new Map<string, { monday: Date; employeeIds: Set<string> }>();
    for (const { employeeId, dateIso } of coveredDays) {
      const monday = mondayOfWeekUtc(new Date(`${dateIso}T00:00:00Z`));
      const key = monday.toISOString().slice(0, 10);
      const entry = byWeek.get(key) ?? { monday, employeeIds: new Set<string>() };
      entry.employeeIds.add(employeeId);
      byWeek.set(key, entry);
    }

    const weeks = [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [weekKey, { monday, employeeIds }] of weeks) {
      try {
        const minorWeeks = await loadMinorShiftWeeks(
          app.prisma,
          tenantId,
          [...employeeIds],
          monday,
        );
        if (minorWeeks.size === 0) continue;

        const employees = await app.prisma.employee.findMany({
          where: { id: { in: [...minorWeeks.keys()] }, tenantId },
          select: { id: true, firstName: true, lastName: true },
        });
        const nameById = new Map(employees.map((e) => [e.id, e]));

        for (const [employeeId, week] of minorWeeks) {
          minorWeeksChecked++;
          const violations = findStoredMinorWeekViolations(week);
          if (violations.length === 0) continue;
          minorWeeksWithViolations++;
          const emp = nameById.get(employeeId);
          if (!emp) continue;
          await notifyMinorShiftLimitViolationsOnce(app, {
            tenantId,
            salonId,
            employeeId,
            employeeName: { firstName: emp.firstName, lastName: emp.lastName },
            weekStart: monday,
            violations,
          });
        }
      } catch (err) {
        app.log.error(
          { err, tenantId, salonId, weekStart: weekKey },
          "Phorest sync: JArbSchG report failed",
        );
      }
    }
  } catch (err) {
    app.log.error({ err, tenantId, salonId }, "Phorest sync: JArbSchG report failed");
  }

  return { minorWeeksChecked, minorWeeksWithViolations };
}
