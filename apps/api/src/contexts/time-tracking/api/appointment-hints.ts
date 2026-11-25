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
import { z } from "zod";
import {
  accessContextFromRequest,
  requireAnyPermission,
  requirePermission,
  resolveAccessReach,
  resolveStammsalonScopedEmployeeIds,
} from "../../platform";
import { appointmentHintWindow, loadAppointmentHints } from "../appointment-hints";

/** One answer for every reason a dismissal is refused: only a currently open own hint can be dismissed. */
const NO_APPOINTMENT_HINT_MESSAGE = "Für diesen Tag gibt es keinen offenen Hinweis.";
const NO_APPOINTMENT_HINT_CODE = "NO_APPOINTMENT_HINT";

/**
 * The body names a day and a kind only. Unknown keys are stripped, so a posted `employeeId` never
 * reaches the handler: the route acts on the caller's own person and nothing else (D-05).
 */
const dismissAppointmentHintSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) => {
        const d = new Date(`${v}T00:00:00Z`);
        // a real calendar day round-trips; "2026-02-30" would roll over and "2026-13-40" is invalid
        return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
      },
      { message: "Ungültiges Datum" },
    ),
  kind: z.enum(["AFTER_CLOCK_OUT", "NO_ENTRY"]),
});

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

  // ── GET /api/v1/appointment-hints/team — hints of the persons in the caller's reach (O-1, O-3) ──
  app.get("/team", {
    schema: {
      tags: ["Zeiterfassung"],
      summary: "Hints on probably unrecorded working time inside the caller's reach",
      description:
        "Hints of the persons inside the caller's time-entry:read reach - the whole tenant, or the " +
        "persons whose Stammsalon on the hint's day lies in the caller's salons, or listed persons. " +
        "There is no person or salon parameter: the reach is the only filter, so a person outside it " +
        "is simply absent. Carries the appointment end and the clock-out only, never appointment " +
        "details, never writes, and is empty (`enabled: false`) while the tenant switch is off.",
      security: [{ bearerAuth: [] }],
    },
    preHandler: requirePermission("time-entry:read:ZUGEWIESEN"),
    handler: async (req) => {
      const tenantId = req.user.tenantId;
      const window = await appointmentHintWindow(app.prisma, tenantId);
      if (!window.enabled) return { enabled: false, hints: [] };

      const access = accessContextFromRequest(req);
      const reach = await resolveAccessReach(app.prisma, access, "time-entry:read:ZUGEWIESEN");
      const scopedAccess = { ...access, reach };

      let hints;
      if (reach.kind === "wholeTenant") {
        hints = await loadAppointmentHints(app.prisma, { access: scopedAccess, window });
      } else {
        // The #86 person rule: a person is in reach on a day when their Stammsalon of THAT day lies in
        // the caller's salons (or they are listed), so the set is resolved per day of the window.
        const sets = new Map<string, Set<string>>();
        await Promise.all(
          window.days.map(async (day) => {
            const ids = await resolveStammsalonScopedEmployeeIds(
              app.prisma,
              tenantId,
              reach,
              new Date(`${day}T00:00:00Z`),
            );
            sets.set(day, new Set(ids === "all" ? [] : ids));
          }),
        );
        const union = new Set<string>();
        for (const set of sets.values()) for (const id of set) union.add(id);
        if (union.size === 0) return { enabled: true, hints: [] };
        const loaded = await loadAppointmentHints(app.prisma, {
          access: scopedAccess,
          employeeIds: [...union],
          window,
        });
        hints = loaded.filter((h) => sets.get(h.date)?.has(h.employeeId) === true);
      }

      return {
        enabled: true,
        hints: [...hints]
          .sort((a, b) =>
            a.date === b.date
              ? a.personName.localeCompare(b.personName, "de")
              : a.date < b.date
                ? 1
                : -1,
          )
          .map((h) => ({
            employeeId: h.employeeId,
            personName: h.personName,
            date: h.date,
            kind: h.kind,
            appointmentsUntil: h.appointmentsUntil,
            clockedOutAt: h.clockedOutAt,
          })),
      };
    },
  });

  // ── POST /api/v1/appointment-hints/dismissals — „Stimmt so“ (D-05) ──────────────────────────────
  app.post("/dismissals", {
    schema: {
      tags: ["Zeiterfassung"],
      summary: 'Dismiss an appointment hint for one day ("Stimmt so")',
      description:
        "The calling employee confirms that the recorded time of the day is complete. Hides that hint " +
        "permanently for the person, the day and the kind, also in the manager view. Never writes a " +
        "time entry, a break or a saldo figure; one dismissal row and one audit row are written in " +
        "one transaction. Answers 409 NO_APPOINTMENT_HINT unless the day has a currently open hint " +
        "of the caller.",
      security: [{ bearerAuth: [] }],
    },
    // The action is always on the caller's own person; either reach of the clock-state pair suffices.
    preHandler: requireAnyPermission("time-entry:update:EIGENE", "time-entry:update:ZUGEWIESEN"),
    handler: async (req, reply) => {
      const body = dismissAppointmentHintSchema.parse(req.body);
      const { tenantId, employeeId } = req.user;
      const refuse = () =>
        reply
          .code(409)
          .send({ error: NO_APPOINTMENT_HINT_MESSAGE, code: NO_APPOINTMENT_HINT_CODE });
      if (!employeeId) return refuse();

      const window = await appointmentHintWindow(app.prisma, tenantId);
      if (!window.enabled) return refuse();
      const open = await loadAppointmentHints(app.prisma, {
        access: accessContextFromRequest(req),
        employeeIds: [employeeId],
        window,
      });
      const hint = open.find((h) => h.date === body.date && h.kind === body.kind);
      if (!hint) return refuse();

      const row = await app.prisma.$transaction(async (tx) => {
        const created = await tx.appointmentHintDismissal.create({
          data: {
            tenantId,
            employeeId,
            date: new Date(`${body.date}T00:00:00Z`),
            kind: body.kind,
            dismissedBy: req.user.sub,
          },
        });
        await app.audit({
          userId: req.user.sub,
          action: "APPOINTMENT_HINT_DISMISSED",
          entity: "AppointmentHintDismissal",
          entityId: created.id,
          newValue: {
            employeeId,
            date: body.date,
            kind: body.kind,
            appointmentsUntil: hint.appointmentsUntil,
            clockedOutAt: hint.clockedOutAt,
          },
          request: { ip: req.ip, headers: req.headers as Record<string, string> },
          tx,
        });
        return created;
      });
      return reply.code(201).send({
        dismissal: { date: body.date, kind: row.kind, createdAt: row.createdAt },
      });
    },
  });
}
