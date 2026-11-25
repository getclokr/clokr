import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@clokr/db";
import { requireAuth } from "../../../middleware/auth";
import {
  accessContextFromRequest,
  hasPermission,
  homeSalonsForDays,
  listSalons,
  requirePermission,
  resolveAccessReach,
  resolveSalonInReach,
  type AccessReach,
} from "../../platform";
import {
  bookCompanyShutdown,
  emptyBookingCounts,
  findOverlappingShutdown,
  rebookCompanyShutdown,
  resolveShutdownActor,
  reverseCompanyShutdown,
} from "../company-shutdown/booking";
import {
  COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN,
  COMPANY_SHUTDOWN_MESSAGES,
  COMPANY_SHUTDOWN_OVERLAP,
} from "../company-shutdown/constants";

const MANAGE_KEY = "company-shutdown:manage:ZUGEWIESEN" as const;

/** One body for every salon rejection cause (T-100-09), byte-identical with the other salon filters. */
const SALON_NOT_FOUND = { error: "Salon nicht gefunden" } as const;

const shutdownBodySchema = z.object({
  name: z.string().min(1).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deductsFromVacation: z.boolean().default(true),
  notes: z.string().optional(),
  // Issue #1079 (D-01): the salons the Betriebsurlaub is limited to; absent or empty = the whole Unternehmen.
  salonIds: z.array(z.string().uuid()).max(200).optional(),
});

/** The salons a shutdown row carries, in the order of `listSalons` (oldest first). */
type ShutdownSalonRow = {
  salon: { id: string; name: string; isActive: boolean; createdAt: Date };
};
function salonsOf(rows: readonly ShutdownSalonRow[]) {
  return [...rows]
    .sort(
      (a, b) =>
        a.salon.createdAt.getTime() - b.salon.createdAt.getTime() ||
        (a.salon.id < b.salon.id ? -1 : 1),
    )
    .map(({ salon }) => ({ id: salon.id, name: salon.name, isActive: salon.isActive }));
}
const SALON_INCLUDE = {
  salons: {
    select: { salon: { select: { id: true, name: true, isActive: true, createdAt: true } } },
  },
} as const;

/** The row `loadManageableShutdown` hands to a write route. */
type ManageableShutdown = Prisma.CompanyShutdownGetPayload<{
  include: { salons: { select: { salonId: true } } };
}>;

/** Sorted, duplicate-free salon ids (the audit value and the set comparison of D-10). */
function normalizeSalonIds(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? [])].sort();
}

/** `YYYY-MM-DD` of a stored `@db.Date` value. */
function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function companyShutdownRoutes(app: FastifyInstance) {
  /** The reach of `company-shutdown:manage`, or null when the caller does not hold the key. */
  async function manageReachOf(req: FastifyRequest): Promise<AccessReach | null> {
    if (!(await hasPermission(req, "company-shutdown:manage:ZUGEWIESEN"))) return null;
    return resolveAccessReach(app.prisma, accessContextFromRequest(req), MANAGE_KEY);
  }

  /**
   * D-08 admission of the salons a body names: none needs a whole-tenant reach (403), every salon not
   * in `keep` must be an active salon inside the reach (one 404 body for every cause, before any
   * write or overlap read).
   */
  async function admitScope(
    req: FastifyRequest,
    reach: AccessReach,
    salonIds: readonly string[],
    keep: readonly string[] = [],
  ): Promise<{ ok: true } | { ok: false; status: 403 | 404; body: object }> {
    if (salonIds.length === 0) {
      return reach.kind === "wholeTenant"
        ? { ok: true }
        : {
            ok: false,
            status: 403,
            body: {
              error: COMPANY_SHUTDOWN_MESSAGES[COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN],
              code: COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN,
            },
          };
    }
    for (const salonId of salonIds) {
      if (keep.includes(salonId)) continue;
      const salon = await resolveSalonInReach(app.prisma, req.user.tenantId, reach, salonId);
      if (!salon.ok) return { ok: false, status: 404, body: SALON_NOT_FOUND };
    }
    return { ok: true };
  }

  /** True when the reach covers every salon of the shutdown (none = the whole Unternehmen). */
  function reachCoversShutdown(reach: AccessReach, salonIds: readonly string[]): boolean {
    if (reach.kind === "wholeTenant") return true;
    return salonIds.length > 0 && salonIds.every((id) => reach.salonIds.includes(id));
  }

  /**
   * D-08: the tenant-scoped Betriebsurlaub of a write route, admitted by the manage reach. Unknown,
   * foreign or deleted: the route's own 404 body; an unternehmensweit one for a scoped caller: 403;
   * a salon-scoped one with any salon outside the reach: the same 404 body (T-100-09).
   */
  async function loadManageableShutdown(
    req: FastifyRequest,
    id: string,
    notFoundBody: object,
  ): Promise<
    | { ok: true; shutdown: ManageableShutdown; salonIds: string[]; reach: AccessReach }
    | { ok: false; status: 403 | 404; body: object }
  > {
    const tenantId = req.user.tenantId;
    const shutdown = await app.prisma.companyShutdown.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { salons: { select: { salonId: true } } },
    });
    if (!shutdown) return { ok: false, status: 404, body: notFoundBody };
    const salonIds = normalizeSalonIds(shutdown.salons.map((row) => row.salonId));
    const reach = (await manageReachOf(req)) ?? { kind: "scoped", salonIds: [], employeeIds: [] };
    if (reachCoversShutdown(reach, salonIds)) return { ok: true, shutdown, salonIds, reach };
    if (salonIds.length === 0) {
      return {
        ok: false,
        status: 403,
        body: {
          error: COMPANY_SHUTDOWN_MESSAGES[COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN],
          code: COMPANY_SHUTDOWN_ALL_SALONS_FORBIDDEN,
        },
      };
    }
    return { ok: false, status: 404, body: notFoundBody };
  }

  // ── GET /company-shutdowns ──────────────────────────────────────────────────
  app.get("/", { preHandler: requireAuth }, async (req, _reply) => {
    const tenantId = req.user.tenantId;
    const { year } = req.query as { year?: string };

    // Issue #1069 (D-10): a soft-deleted Betriebsurlaub is gone for every reader.
    const where: Prisma.CompanyShutdownWhereInput = { tenantId, deletedAt: null };
    if (year) {
      const y = parseInt(year);
      where.OR = [
        { startDate: { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) } },
        { endDate: { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) } },
      ];
    }

    const shutdowns = await app.prisma.companyShutdown.findMany({
      where,
      orderBy: { startDate: "asc" },
      include: {
        exceptions: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
          },
        },
        ...SALON_INCLUDE,
      },
    });

    // Issue #1079 (D-09): every row names its salons and whether the caller may manage it.
    const reach = await manageReachOf(req);
    return shutdowns.map((row) => ({
      ...row,
      salons: salonsOf(row.salons),
      canManage:
        reach !== null &&
        reachCoversShutdown(
          reach,
          row.salons.map((entry) => entry.salon.id),
        ),
    }));
  });

  // ── GET /company-shutdowns/scope ────────────────────────────────────────────
  // The salons the caller may name in a Betriebsurlaub. Registered before every `/:id` route.
  app.get(
    "/scope",
    {
      schema: {
        tags: ["Abwesenheiten"],
        security: [{ bearerAuth: [] }],
        summary: "Salons the caller may name in a Betriebsurlaub",
        description:
          "Answers whether the caller may manage a Betriebsurlaub for the whole Unternehmen and which active salons they may name. Needs company-shutdown:manage.",
      },
      preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN"),
    },
    async (req) => {
      const reach =
        (await manageReachOf(req)) ??
        ({ kind: "scoped", salonIds: [], employeeIds: [] } as AccessReach);
      const active = await listSalons(app.prisma, req.user.tenantId, { includeInactive: false });
      const salons = active
        .filter((salon) => reach.kind === "wholeTenant" || reach.salonIds.includes(salon.id))
        .map((salon) => ({ id: salon.id, name: salon.name }));
      return { canManageAllSalons: reach.kind === "wholeTenant", salons };
    },
  );

  // ── POST /company-shutdowns ─────────────────────────────────────────────────
  app.post(
    "/",
    { preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN") },
    async (req, reply) => {
      const tenantId = req.user.tenantId;
      const body = shutdownBodySchema.parse(req.body);

      if (body.startDate > body.endDate) {
        return reply.status(400).send({ message: "startDate muss vor endDate liegen" });
      }

      // Issue #1079 (D-08): the named salons (none = the whole Unternehmen) are admitted by the
      // caller's reach before any write or overlap read.
      const salonIds = normalizeSalonIds(body.salonIds);
      const reach = (await manageReachOf(req)) ?? { kind: "scoped", salonIds: [], employeeIds: [] };
      const admission = await admitScope(req, reach, salonIds);
      if (!admission.ok) return reply.status(admission.status).send(admission.body);

      // Issue #1069 (D-11, revised by #1079 D-05): two active Betriebsurlaube may not share a day
      // while their scopes meet.
      if (await findOverlappingShutdown(app, tenantId, body.startDate, body.endDate, salonIds)) {
        return reply.status(409).send({
          error: COMPANY_SHUTDOWN_MESSAGES[COMPANY_SHUTDOWN_OVERLAP],
          code: COMPANY_SHUTDOWN_OVERLAP,
        });
      }

      const shutdown = await app.prisma.companyShutdown.create({
        data: {
          tenantId,
          name: body.name,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          deductsFromVacation: body.deductsFromVacation,
          notes: body.notes ?? null,
          ...(salonIds.length > 0 && {
            salons: { create: salonIds.map((salonId) => ({ salonId })) },
          }),
        },
        include: { exceptions: true, ...SALON_INCLUDE },
      });

      await app.audit({
        userId: req.user.sub,
        action: "CREATE",
        entity: "CompanyShutdown",
        entityId: shutdown.id,
        newValue: {
          name: shutdown.name,
          startDate: shutdown.startDate,
          endDate: shutdown.endDate,
          deductsFromVacation: shutdown.deductsFromVacation,
          salonIds,
        },
        request: { ip: req.ip, headers: req.headers as Record<string, string> },
      });

      // Issue #1069: the Betriebsurlaub becomes bookings (absence and, when it deducts, Urlaub)
      // for every person employed on its days. The answer carries counts only (D-21).
      const booking = await bookCompanyShutdown(app, {
        tenantId,
        shutdownId: shutdown.id,
        actor: await resolveShutdownActor(app, req),
        request: { ip: req.ip, headers: req.headers as Record<string, string> },
      });

      if (!booking.ok) {
        return reply.status(409).send({
          error: COMPANY_SHUTDOWN_MESSAGES[booking.code],
          code: booking.code,
        });
      }
      return reply
        .status(201)
        .send({ ...shutdown, salons: salonsOf(shutdown.salons), booking: booking.counts });
    },
  );

  // ── PATCH /company-shutdowns/:id ────────────────────────────────────────────
  app.patch(
    "/:id",
    { preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN") },
    async (req, reply) => {
      const tenantId = req.user.tenantId;
      const { id } = req.params as { id: string };
      const body = shutdownBodySchema.partial().parse(req.body);

      // Issue #1079 (D-08): an existing row is manageable only when the reach covers all its salons.
      const loaded = await loadManageableShutdown(req, id, { message: "Nicht gefunden" });
      if (!loaded.ok) return reply.status(loaded.status).send(loaded.body);
      const { shutdown: existing, salonIds: existingSalonIds, reach } = loaded;

      // D-10: a changed salon set (order and duplicates irrelevant) re-books like a changed period.
      const newSalonIds =
        body.salonIds === undefined ? existingSalonIds : normalizeSalonIds(body.salonIds);
      const scopeChanged =
        newSalonIds.length !== existingSalonIds.length ||
        newSalonIds.some((salonId, index) => salonId !== existingSalonIds[index]);
      if (scopeChanged) {
        // Only ADDED salons are re-validated: a since-deactivated salon may stay (the #647 rule).
        const admission = await admitScope(req, reach, newSalonIds, existingSalonIds);
        if (!admission.ok) return reply.status(admission.status).send(admission.body);
      }

      // Issue #1069 (D-11, revised by #1079 D-05): the edited period or scope may not share a day
      // with another active Betriebsurlaub whose scope meets.
      const newStart = body.startDate ?? existing.startDate.toISOString().slice(0, 10);
      const newEnd = body.endDate ?? existing.endDate.toISOString().slice(0, 10);
      if (
        (body.startDate !== undefined || body.endDate !== undefined || scopeChanged) &&
        (await findOverlappingShutdown(app, tenantId, newStart, newEnd, newSalonIds, id))
      ) {
        return reply.status(409).send({
          error: COMPANY_SHUTDOWN_MESSAGES[COMPANY_SHUTDOWN_OVERLAP],
          code: COMPANY_SHUTDOWN_OVERLAP,
        });
      }

      const request = { ip: req.ip, headers: req.headers as Record<string, string> };
      const applyUpdate = async () => {
        const updated = await app.prisma.companyShutdown.update({
          where: { id, tenantId },
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.startDate !== undefined && { startDate: new Date(body.startDate) }),
            ...(body.endDate !== undefined && { endDate: new Date(body.endDate) }),
            ...(body.deductsFromVacation !== undefined && {
              deductsFromVacation: body.deductsFromVacation,
            }),
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(scopeChanged && {
              salons: {
                deleteMany: {},
                create: newSalonIds.map((salonId) => ({ salonId })),
              },
            }),
          },
          include: {
            exceptions: {
              include: {
                employee: {
                  select: { id: true, firstName: true, lastName: true, employeeNumber: true },
                },
              },
            },
            ...SALON_INCLUDE,
          },
        });

        await app.audit({
          userId: req.user.sub,
          action: "UPDATE",
          entity: "CompanyShutdown",
          entityId: id,
          oldValue: {
            name: existing.name,
            startDate: existing.startDate,
            endDate: existing.endDate,
            deductsFromVacation: existing.deductsFromVacation,
            salonIds: existingSalonIds,
          },
          newValue: {
            name: updated.name,
            startDate: updated.startDate,
            endDate: updated.endDate,
            deductsFromVacation: updated.deductsFromVacation,
            salonIds: newSalonIds,
          },
          request,
        });
        return { ...updated, salons: salonsOf(updated.salons) };
      };

      // Issue #1069 (D-09): a changed period, deduction flag or (#1079) salon set cancels the
      // generated rows of open months and books again, in ONE locked run; the update itself runs
      // inside the lock, so a contended lock (409) changes nothing. A change of name or notes books
      // nothing.
      const rebooks =
        scopeChanged ||
        (body.startDate !== undefined && body.startDate !== dayString(existing.startDate)) ||
        (body.endDate !== undefined && body.endDate !== dayString(existing.endDate)) ||
        (body.deductsFromVacation !== undefined &&
          body.deductsFromVacation !== existing.deductsFromVacation);
      if (!rebooks) {
        const updated = await applyUpdate();
        return { ...updated, booking: emptyBookingCounts() };
      }
      let updated: Awaited<ReturnType<typeof applyUpdate>> | undefined;
      const booking = await rebookCompanyShutdown(app, {
        tenantId,
        shutdownId: id,
        actor: await resolveShutdownActor(app, req),
        request,
        applyChange: async () => {
          updated = await applyUpdate();
        },
      });
      if (!booking.ok) {
        return reply.status(409).send({
          error: COMPANY_SHUTDOWN_MESSAGES[booking.code],
          code: booking.code,
        });
      }
      return { ...updated!, booking: booking.counts };
    },
  );

  // ── DELETE /company-shutdowns/:id ───────────────────────────────────────────
  app.delete(
    "/:id",
    { preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN") },
    async (req, reply) => {
      const tenantId = req.user.tenantId;
      const { id } = req.params as { id: string };

      const loaded = await loadManageableShutdown(req, id, { message: "Nicht gefunden" });
      if (!loaded.ok) return reply.status(loaded.status).send(loaded.body);
      const { shutdown: existing, salonIds: existingSalonIds } = loaded;

      // Issue #1069 (D-10): the row is the source of payroll-relevant bookings - soft delete, never
      // removed. The delete runs inside the shutdown's lock, then its generated rows of open months
      // are cancelled (D-09); a contended lock answers 409 with nothing changed.
      const request = { ip: req.ip, headers: req.headers as Record<string, string> };
      const reversal = await reverseCompanyShutdown(app, {
        tenantId,
        shutdownId: id,
        reason: "DELETED",
        actorUserId: req.user.sub,
        request,
        applyChange: async () => {
          await app.prisma.companyShutdown.updateMany({
            where: { id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          await app.audit({
            userId: req.user.sub,
            action: "DELETE",
            entity: "CompanyShutdown",
            entityId: id,
            oldValue: {
              name: existing.name,
              startDate: existing.startDate,
              endDate: existing.endDate,
              deductsFromVacation: existing.deductsFromVacation,
              salonIds: existingSalonIds,
            },
            request,
          });
        },
      });
      if (!reversal.ok) {
        return reply.status(409).send({
          error: COMPANY_SHUTDOWN_MESSAGES[reversal.code],
          code: reversal.code,
        });
      }

      return reply.status(204).send();
    },
  );

  // ── POST /company-shutdowns/:id/exceptions ──────────────────────────────────
  // Add an employee to the exception list
  app.post(
    "/:id/exceptions",
    { preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN") },
    async (req, reply) => {
      const tenantId = req.user.tenantId;
      const { id } = req.params as { id: string };
      const { employeeId, reason } = req.body as { employeeId: string; reason?: string };

      const loaded = await loadManageableShutdown(req, id, {
        message: "Betriebsurlaub nicht gefunden",
      });
      if (!loaded.ok) return reply.status(loaded.status).send(loaded.body);
      const { shutdown, salonIds, reach } = loaded;

      const employee = await app.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
      if (!employee) return reply.status(404).send({ message: "Mitarbeiter nicht gefunden" });

      // Issue #1079 (D-08): a scoped caller may exempt only a person homed in one of the
      // shutdown's salons on a shutdown day - anyone else answers like an unknown person, so the
      // answer never carries the name of a person outside her reach (DSGVO Art. 5 Abs. 1 lit. c).
      if (reach.kind !== "wholeTenant") {
        const days = await homeSalonsForDays(
          app.prisma,
          tenantId,
          [employee.id],
          dayString(shutdown.startDate),
          dayString(shutdown.endDate),
        );
        const homed = [...(days.get(employee.id)?.values() ?? [])].some(
          (salonId) => salonId !== null && salonIds.includes(salonId),
        );
        if (!homed) return reply.status(404).send({ message: "Mitarbeiter nicht gefunden" });
      }

      const exception = await app.prisma.companyShutdownException.upsert({
        where: { shutdownId_employeeId: { shutdownId: id, employeeId } },
        create: { shutdownId: id, employeeId, reason: reason ?? null },
        update: { reason: reason ?? null },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        },
      });

      // IN-01: exceptions affect which employees are exempt from a shutdown (leave deduction /
      // payroll impact) — they are audit-relevant (Revisionssicherheit).
      await app.audit({
        userId: req.user.sub,
        action: "CREATE",
        entity: "CompanyShutdownException",
        entityId: `${id}_${employeeId}`,
        newValue: { shutdownId: id, employeeId, reason: reason ?? null },
        request: { ip: req.ip, headers: req.headers as Record<string, string> },
      });

      // Issue #1069 (D-09, D-22): a person who is now exempt keeps no booking in an open month. The
      // employee was looked up in the caller's tenant above, so this never reaches a foreign person.
      await reverseCompanyShutdown(app, {
        tenantId,
        shutdownId: id,
        employeeIds: [employee.id],
        reason: "EXCEPTION_ADDED",
        actorUserId: req.user.sub,
        request: { ip: req.ip, headers: req.headers as Record<string, string> },
        lock: "wait",
      });

      return reply.status(201).send(exception);
    },
  );

  // ── DELETE /company-shutdowns/:id/exceptions/:employeeId ────────────────────
  // Remove an exception
  app.delete(
    "/:id/exceptions/:employeeId",
    { preHandler: requirePermission("company-shutdown:manage:ZUGEWIESEN") },
    async (req, reply) => {
      const tenantId = req.user.tenantId;
      const { id, employeeId } = req.params as { id: string; employeeId: string };

      const loaded = await loadManageableShutdown(req, id, {
        message: "Betriebsurlaub nicht gefunden",
      });
      if (!loaded.ok) return reply.status(loaded.status).send(loaded.body);

      // Fetch before delete so oldValue is available for the audit log
      const existing = await app.prisma.companyShutdownException.findUnique({
        where: { shutdownId_employeeId: { shutdownId: id, employeeId } },
      });

      await app.prisma.companyShutdownException.deleteMany({
        where: { shutdownId: id, employeeId },
      });

      // IN-01: audit the removal even when the exception didn't exist (no-op delete);
      // the oldValue will be null in that case, which is the correct audit trail.
      await app.audit({
        userId: req.user.sub,
        action: "DELETE",
        entity: "CompanyShutdownException",
        entityId: `${id}_${employeeId}`,
        oldValue: existing ? { shutdownId: id, employeeId, reason: existing.reason } : null,
        request: { ip: req.ip, headers: req.headers as Record<string, string> },
      });

      // Issue #1069 (D-09, D-22): a person who takes part again is booked, only for an employee of
      // the caller's tenant; a foreign or unknown id is a no-op with the unchanged answer.
      const employee = await app.prisma.employee.findFirst({
        where: { id: employeeId, tenantId },
        select: { id: true },
      });
      if (employee) {
        await bookCompanyShutdown(app, {
          tenantId,
          shutdownId: id,
          actor: await resolveShutdownActor(app, req),
          employeeIds: [employee.id],
          request: { ip: req.ip, headers: req.headers as Record<string, string> },
          lock: "wait",
        });
      }

      return reply.status(204).send();
    },
  );
}
