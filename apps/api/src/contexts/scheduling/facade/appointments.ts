/**
 * Issue #604 (O-2, D-06) — Schichtplanung's `PhorestAppointment` read for Zeiterfassung's
 * appointment hint ("Termin ohne erfasste Zeit").
 *
 * The question this facade answers: "what is the LATEST appointment end of each person and day in a
 * date window". `PhorestAppointment` has exactly one access path from outside this context — this
 * function; `apps/api/scripts/foreign-context-access-exceptions.json` lists `phorestAppointment` in
 * `convertedModels`, so a later direct access from another context is a hard error.
 *
 * DSGVO-minimal by construction (D-06, Art. 5 Abs. 1 lit. c): the result carries `employeeId`,
 * `date` and `lastEndTime` and nothing else — no start time, no appointment count, no salon and no
 * `externalId` ever leave this function. The rule that consumes it (`time-tracking/appointment-hints.ts`)
 * needs the end of the working day, never the content of the day.
 *
 * `PhorestAppointment` has no `deletedAt` (the sync hard-replaces its window). Past days hold the
 * state of the last sync on that day, because the sync window starts today and past rows are never
 * replaced (D-12) — the consumer words its hints conditionally for exactly that reason.
 *
 * D-07: the first parameter is `db: Prisma.TransactionClient`. Tenant: through `employeeScopeWhere`
 * (every `EmployeeScope` variant binds `employee: { tenantId }`; an empty tenant throws).
 */
import type { Prisma } from "@clokr/db";
import { type EmployeeScope, employeeScopeWhere } from "../../platform";

export interface AppointmentDayEnd {
  employeeId: string;
  /** The `@db.Date` value: UTC midnight of the tenant-local calendar day. */
  date: Date;
  /** Latest appointment end of the day, "HH:mm". */
  lastEndTime: string;
}

/**
 * The latest appointment end per person and day inside `[from, to]` (both inclusive `@db.Date`
 * values), for the persons of `scope`. One grouped query; days without a stored end are dropped.
 */
export async function getAppointmentDayEnds(
  db: Prisma.TransactionClient,
  scope: EmployeeScope,
  from: Date,
  to: Date,
): Promise<AppointmentDayEnd[]> {
  const groups = await db.phorestAppointment.groupBy({
    by: ["employeeId", "date"],
    where: {
      ...employeeScopeWhere(scope),
      date: { gte: from, lte: to },
    },
    _max: { endTime: true },
    orderBy: [{ date: "asc" }, { employeeId: "asc" }],
  });
  const ends: AppointmentDayEnd[] = [];
  for (const g of groups) {
    const lastEndTime = g._max.endTime;
    if (lastEndTime === null || lastEndTime === undefined) continue;
    ends.push({ employeeId: g.employeeId, date: g.date, lastEndTime });
  }
  return ends;
}
