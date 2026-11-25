/**
 * Issue #604 — the appointment hint ("Termin ohne erfasste Zeit") of Zeiterfassung.
 *
 * `GET /` answers the caller's own hints. The rule itself lives in `../appointment-hints.ts`; this
 * file only guards, resolves the caller and maps the answer (O-2: no rule in the route layer, and
 * appointments are read only through the Schichtplanung facade). The GETs never write; the one
 * write of this module is the dismissal route.
 *
 * No path parameter on purpose (D-07): every answer is derived from the caller and the tenant
 * switch, so there is nothing to probe (T-100-09 not applicable). While the tenant switch is off
 * every handler answers `{ enabled: false, hints: [] }` BEFORE any appointment, entry or leave read.
 *
 * The module is registered by `app.ts` (composition root) and deliberately NOT re-exported from
 * `contexts/time-tracking/index.ts` (D-07, import-cycle cap).
 */
import { FastifyInstance } from "fastify";
import { accessContextFromRequest, requireAnyPermission } from "../../platform";
import { appointmentHintWindow, loadAppointmentHints } from "../appointment-hints";

export async function appointmentHintRoutes(app: FastifyInstance) {
  // ── GET /api/v1/appointment-hints — the caller's own hints ──────────────────────────────────────
  app.get("/", {
    schema: {
      tags: ["Zeiterfassung"],
      summary: "Own hints on probably unrecorded working time",
      description:
        "Hints for the calling employee on the past days of the self-entry window: the last appointment " +
        "of a day ends more than 15 minutes after the last clock-out (AFTER_CLOCK_OUT), or a day has " +
        "appointments and no recorded entry (NO_ENTRY). Answers only the caller's own person, never " +
        "writes time and is empty (`enabled: false`) while the tenant switch is off.",
      security: [{ bearerAuth: [] }],
    },
    // The answer is always the caller's own person, so either reach of the clock-state pair suffices.
    preHandler: requireAnyPermission("time-entry:read:EIGENE", "time-entry:read:ZUGEWIESEN"),
    handler: async (req) => {
      const window = await appointmentHintWindow(app.prisma, req.user.tenantId);
      if (!window.enabled) return { enabled: false, hints: [] };
      const employeeId = req.user.employeeId;
      if (!employeeId) return { enabled: true, hints: [] };
      const hints = await loadAppointmentHints(app.prisma, {
        access: accessContextFromRequest(req),
        employeeIds: [employeeId],
        window,
      });
      return {
        enabled: true,
        hints: hints.map((h) => ({
          date: h.date,
          kind: h.kind,
          appointmentsUntil: h.appointmentsUntil,
          clockedOutAt: h.clockedOutAt,
        })),
      };
    },
  });
}
