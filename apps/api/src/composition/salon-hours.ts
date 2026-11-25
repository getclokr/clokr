import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  requirePermission,
  accessContextFromRequest,
  employeeScopeFor,
  resolveAccessReach,
  resolveSalonInReach,
  salonOnlyReach,
  listSalons,
  reportPopulationWhere,
  scopedTimeEntryIds,
  type PermissionKey,
} from "../contexts/platform";
import {
  getTenantTimezone,
  todayInTz,
  addDaysUtc,
  dayRangeUtc,
  weekRangeUtc,
  monthRangeUtc,
} from "../contexts/working-time-account";
import {
  getRecordedWorkEntriesInRange,
  getRecordedWorkEntriesByIds,
} from "../contexts/time-tracking";
import { resolveWindowReachIds, type ReachWindow } from "./reach-day";
import { SALON_VIEW_NOT_FOUND } from "./salon-view";
import { distinctEmployeeIds } from "./team-entry-scope";
import {
  buildSalonHoursBlock,
  type SalonHoursEntryRow,
  type SalonHoursPerson,
} from "./salon-hours-cells";

/**
 * Issue #1030 - `GET /api/v1/salon-hours`: the Salonansicht as an hours raster Person x day for ONE
 * salon over a week or a calendar month.
 *
 * Read-only composition without a rule of its own. WHO is a row is decided by the one membership
 * rule of the salon views (the Stammteam is the persons homed in the salon at the window's Stichtag,
 * `resolveWindowReachIds`, the same circle the period report uses, #714); WHICH entries the caller may
 * see is decided by the Unterbau's per-entry reach rule (`scopedTimeEntryIds`, #85); a minute is
 * derived only by `salonWorkedMinutesOf` (#542/#714) inside `salon-hours-cells.ts`. No answer carries
 * a Soll, saldo, balance, overtime or expected figure - salon hours are not a contract figure.
 */

/** An ISO calendar date that really exists ("2026-02-31" is refused, V8 would roll it over). */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum (JJJJ-MM-TT)")
  .refine((s) => {
    const d = new Date(s);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Ungültiges Datum (JJJJ-MM-TT)");

export const salonHoursQuerySchema = z.object({
  salonId: z.string().uuid("Ungültige Salon-ID"),
  period: z.enum(["week", "month"]).default("week"),
  date: isoDay.optional(),
});
export type SalonHoursQuery = z.infer<typeof salonHoursQuerySchema>;

/** The window starts after tenant-local today: nothing can be counted there, so it is refused. */
export class SalonHoursRangeError extends Error {}

/** The salon the chosen id does not name (foreign, unknown, inactive or out of reach): one 404. */
export class SalonHoursNotFoundError extends Error {}

const dayString = (d: Date): string => d.toISOString().slice(0, 10);

/** Every calendar day of the month containing `anchor`, ascending. */
function monthDays(anchor: string): string[] {
  const [year, month] = anchor.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${anchor.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`,
  );
}

export async function assembleSalonHours(
  app: FastifyInstance,
  req: FastifyRequest,
  query: SalonHoursQuery,
  permission: PermissionKey,
) {
  const tenantId = req.user.tenantId;
  const tz = await getTenantTimezone(app.prisma, tenantId);
  const today = todayInTz(tz);
  const yesterday = addDaysUtc(today, -1);
  const yesterdayStr = dayString(yesterday);

  // The window: a week (Monday to Sunday) or a calendar month around the anchor day. Without a date
  // the anchor is tenant-local yesterday, so a Monday never opens an empty week (P-07).
  const anchor = query.date ?? yesterdayStr;
  let days: string[];
  let window: ReachWindow;
  if (query.period === "month") {
    const [year, month] = anchor.split("-").map(Number);
    days = monthDays(anchor);
    const { start, end } = monthRangeUtc(year, month, tz);
    window = { start, end, lastDay: new Date(`${days[days.length - 1]}T00:00:00Z`) };
  } else {
    const week = weekRangeUtc(dayRangeUtc(anchor, tz).start, tz);
    days = week.days;
    window = { start: week.start, end: week.end, lastDay: new Date(`${days[6]}T00:00:00Z`) };
  }
  const firstDay = new Date(`${days[0]}T00:00:00Z`);
  const lastDay = window.lastDay;
  if (days[0] > dayString(today)) throw new SalonHoursRangeError();
  // Counted days: through the window's last day, but never past tenant-local yesterday (#438).
  const countedThrough =
    yesterdayStr < days[0]
      ? null
      : yesterdayStr < days[days.length - 1]
        ? yesterdayStr
        : days[days.length - 1];

  const access = accessContextFromRequest(req);
  const reach = await resolveAccessReach(app.prisma, access, permission);
  // The chosen salon is validated against the reach of THIS route's own permission BEFORE any
  // person, entry or salon-list read; every rejection is the one 404 body.
  const salonFilter = await resolveSalonInReach(app.prisma, tenantId, reach, query.salonId);
  if (!salonFilter.ok || salonFilter.salonId === null) throw new SalonHoursNotFoundError();
  const salonId = salonFilter.salonId;
  const scopedAccess = { ...access, reach };

  // The persons the caller's reach admits. A scoped caller sees the entry-decided population (#85):
  // the Stammsalon persons of the reach plus every person with an in-scope entry in the window.
  const reachIds = await resolveWindowReachIds(app.prisma, tenantId, reach, window, tz);
  let inScopeRows: Awaited<ReturnType<typeof getRecordedWorkEntriesByIds>> | null = null;
  if (reach.kind === "scoped") {
    const inScopeIds = await scopedTimeEntryIds(app.prisma, tenantId, reach, firstDay, lastDay);
    // "all" is whole-tenant only; for a scoped reach it cannot occur and fails closed.
    inScopeRows = await getRecordedWorkEntriesByIds(
      app.prisma,
      tenantId,
      inScopeIds === "all" ? [] : inScopeIds,
    );
  }
  const admittedIds =
    reachIds === "all" ? "all" : [...reachIds, ...distinctEmployeeIds(inScopeRows ?? [])];

  const population = await app.prisma.employee.findMany({
    where: {
      tenantId,
      AND: [
        reportPopulationWhere(window.start, window.end),
        ...(admittedIds !== "all" ? [{ id: { in: admittedIds } }] : []),
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeNumber: true,
      exitDate: true,
    },
  });
  const populationIds = population.map((p) => p.id);

  // The Stammteam circle: persons homed in the salon at their window Stichtag. A salon-only reach
  // never answers "all"; if it did, the circle is empty (fail-closed).
  const circleIds = await resolveWindowReachIds(
    app.prisma,
    tenantId,
    salonOnlyReach(salonId),
    window,
    tz,
  );
  const circle = new Set(circleIds === "all" ? [] : circleIds);

  // The rows the answer is built from: the caller's own reach decides. A whole-tenant caller reads
  // every row of the population; a scoped caller only the in-scope rows (never a hidden minute).
  const rows: SalonHoursEntryRow[] =
    inScopeRows !== null
      ? inScopeRows.filter((r) => populationIds.includes(r.employeeId))
      : populationIds.length === 0
        ? []
        : await getRecordedWorkEntriesInRange(
            app.prisma,
            employeeScopeFor(scopedAccess, { employeeIds: populationIds }),
            firstDay,
            lastDay,
          );
  const rowsByPerson = new Map<string, SalonHoursEntryRow[]>();
  for (const row of rows) {
    const list = rowsByPerson.get(row.employeeId);
    if (list) list.push(row);
    else rowsByPerson.set(row.employeeId, [row]);
  }

  const salons = await listSalons(app.prisma, tenantId, { includeInactive: true });
  const salonName = salons.find((s) => s.id === salonId)?.name ?? "";

  const toPerson = (p: (typeof population)[number]): SalonHoursPerson => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    employeeNumber: p.employeeNumber,
  });
  const stammteam = buildSalonHoursBlock({
    salonId,
    days,
    countedThrough,
    yesterday,
    persons: population.filter((p) => circle.has(p.id)).map(toPerson),
    rowsByPerson,
  });

  return {
    salonId,
    salonName,
    period: query.period,
    from: days[0],
    to: days[days.length - 1],
    days,
    countedThrough,
    kpis: {
      salonWorkedMinutes: stammteam.totalMinutes,
      stammteamMinutes: stammteam.totalMinutes,
    },
    stammteam,
  };
}

export async function salonHoursRoutes(app: FastifyInstance) {
  // Issue #1030
  app.get("/", {
    schema: {
      tags: ["Dashboard"],
      security: [{ bearerAuth: [] }],
      description:
        "Hours worked in the chosen salon, as a raster of persons by day over one week or one calendar month, from closed valid WORK entries through tenant-local yesterday. The Stammteam is the persons homed in the salon at the window's Stichtag. Never a Soll or saldo: those belong to the person. A salon outside the caller's reach, an inactive, a foreign and an unknown salon answer the same 404.",
    },
    preHandler: requirePermission("team-overview:read:ZUGEWIESEN"),
    handler: async (req, reply) => {
      const query = salonHoursQuerySchema.parse(req.query);
      try {
        return await assembleSalonHours(app, req, query, "team-overview:read:ZUGEWIESEN");
      } catch (err) {
        if (err instanceof SalonHoursNotFoundError) {
          return reply.code(404).send(SALON_VIEW_NOT_FOUND);
        }
        if (err instanceof SalonHoursRangeError) {
          return reply.code(400).send({ error: "Der Zeitraum darf nicht in der Zukunft liegen." });
        }
        throw err;
      }
    },
  });
}
