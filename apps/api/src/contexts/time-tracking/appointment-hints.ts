/**
 * Issue #604 — "Termin ohne erfasste Zeit": the appointment hint of Zeiterfassung.
 *
 * Clokr compares a person's appointments with their recorded working time for the past days of the
 * self-entry window and names a day on which time was probably not recorded:
 *   - AFTER_CLOCK_OUT: the last appointment of the day ends more than 15 minutes after the last
 *     clock-out of that day;
 *   - NO_ENTRY: appointments on a day without any recorded work entry.
 * The hint is only a prompt (§ 16 Abs. 2 ArbZG: the record stays the person's own entry). It never
 * writes time, never prefills a form and never changes a saldo (O-4) — this module contains no
 * write at all.
 *
 * Binding owner decisions: O-1 person AND managers with reach; O-2 the rule lives HERE, the
 * appointments are read only through the Schichtplanung facade (`contexts/scheduling/index.ts`);
 * O-3 managers only inside their `time-entry:read` reach; O-4 help recording, nothing automatic;
 * O-5 Art. 13 notice; O-6 a tenant switch; O-7 off by default. Planner decisions D-01..D-07 are
 * stated at the code they shape: D-01 the fixed 15-minute threshold (strictly greater), D-02 the
 * window = the self-entry window of the write guard through yesterday, D-03 what counts as recorded,
 * D-04 the excluded days, D-06 data minimisation, D-07 this module is NOT re-exported from
 * `contexts/time-tracking/index.ts` — a module reachable from that index which reads three other
 * context indexes would join the measured import cycle (cap 22), the same reasoning as #587's
 * `presence.ts`.
 */
import type { FastifyInstance } from "fastify";
import type { AppointmentHintKind as PrismaAppointmentHintKind } from "@clokr/db";
import {
  type AccessContext,
  NOT_ANONYMIZED_EMPLOYEE_WHERE,
  employeeScopeFor,
  employeeScopeWhere,
} from "../platform";
import { getAppointmentDayEnds } from "../scheduling";
import { getActiveLeaveOverlapping } from "../absence";
import {
  addDaysUtc,
  dateStrInTz,
  getClosedMonthsForDates,
  getTenantTimezone,
  monthRangeUtc,
  timeStrInTz,
  todayInTz,
} from "../working-time-account";
import { computeRetroLimitStr, getRetroEntryWindowDays } from "./retro-config";
import { getRecordedWorkEntriesInRange } from "./facade/time-entries";

/**
 * D-01: a hint needs the last appointment to end MORE than this many minutes after the last
 * clock-out (16 yields a hint, 15 does not). 15 minutes is the smallest unit the ArbZG itself uses
 * for a break segment (§ 4 Satz 2), so the minutes between the last appointment and the clock-out
 * ritual stay silent. A fixed constant, deliberately not a tenant setting (ADR 0002, Entscheidung 2).
 */
export const APPOINTMENT_HINT_MIN_GAP_MINUTES = 15;

export type AppointmentHintKind = PrismaAppointmentHintKind;

export interface AppointmentHint {
  employeeId: string;
  personName: string;
  /** Tenant-local calendar day, YYYY-MM-DD. */
  date: string;
  kind: AppointmentHintKind;
  /** End of the last appointment of the day, HH:mm. */
  appointmentsUntil: string;
  /** Last clock-out of the day, HH:mm; null for NO_ENTRY. */
  clockedOutAt: string | null;
}

export interface AppointmentHintWindow {
  enabled: true;
  tz: string;
  /** Inclusive lower bound: the write guard's own self-entry bound (D-02). */
  fromStr: string;
  /** Inclusive upper bound: the tenant-local yesterday (today is not over yet). */
  toStr: string;
  from: Date;
  to: Date;
  days: string[];
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Every day string from `fromStr` through `toStr`; an inverted range yields none. */
function daysBetween(fromStr: string, toStr: string): string[] {
  const days: string[] = [];
  for (let d = dayDate(fromStr); dateStrInTz(d, "UTC") <= toStr; d = addDaysUtc(d, 1)) {
    days.push(dateStrInTz(d, "UTC"));
  }
  return days;
}

/**
 * The tenant switch and the day window of the hint (D-02, D-09). The switch is read FIRST and a
 * switched-off tenant returns before any other read, so while it is off no appointment, entry or
 * leave is touched.
 */
export async function appointmentHintWindow(
  db: FastifyInstance["prisma"],
  tenantId: string,
): Promise<{ enabled: false } | AppointmentHintWindow> {
  const cfg = await db.tenantConfig.findUnique({
    where: { tenantId },
    select: { appointmentTimeHintsEnabled: true },
  });
  if (cfg?.appointmentTimeHintsEnabled !== true) return { enabled: false };

  const tz = await getTenantTimezone(db, tenantId);
  const windowDays = await getRetroEntryWindowDays(db, tenantId);
  const fromStr = computeRetroLimitStr(tz, windowDays);
  const toStr = dateStrInTz(addDaysUtc(todayInTz(tz), -1), "UTC");
  return {
    enabled: true,
    tz,
    fromStr,
    toStr,
    from: dayDate(fromStr),
    to: dayDate(toStr),
    days: daysBetween(fromStr, toStr),
  };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export interface EvaluateInput {
  window: { fromStr: string; toStr: string };
  appointmentEnds: { employeeId: string; date: string; lastEndTime: string }[];
  entries: {
    employeeId: string;
    date: string;
    open: boolean;
    endLocalTime: string | null;
    endsOnLaterDay: boolean;
  }[];
  /** `<employeeId>|<date>` — days that never get a hint (D-04). */
  excludedDays: ReadonlySet<string>;
  /** `<employeeId>|<date>|<kind>` — hints the person already answered with „Stimmt so“ (D-05). */
  dismissed: ReadonlySet<string>;
}

/**
 * The pure rule (D-01, D-03). Per appointment day inside the window and not excluded, take the
 * person's work entries of that day: any open entry -> no hint ("Ausstempeln fehlt" covers it); no
 * entry -> NO_ENTRY; otherwise compare the latest local end of the closed entries with the latest
 * appointment end. An entry that ends on a later local date never yields a hint. Newest day first,
 * then employee id.
 */
export function evaluateAppointmentHints(
  input: EvaluateInput,
): Omit<AppointmentHint, "personName">[] {
  const entriesByDay = new Map<string, EvaluateInput["entries"]>();
  for (const e of input.entries) {
    const key = `${e.employeeId}|${e.date}`;
    const list = entriesByDay.get(key);
    if (list) list.push(e);
    else entriesByDay.set(key, [e]);
  }

  const hints: Omit<AppointmentHint, "personName">[] = [];
  for (const a of input.appointmentEnds) {
    if (a.date < input.window.fromStr || a.date > input.window.toStr) continue;
    const dayKey = `${a.employeeId}|${a.date}`;
    if (input.excludedDays.has(dayKey)) continue;

    const dayEntries = entriesByDay.get(dayKey) ?? [];
    if (dayEntries.length === 0) {
      if (input.dismissed.has(`${dayKey}|NO_ENTRY`)) continue;
      hints.push({
        employeeId: a.employeeId,
        date: a.date,
        kind: "NO_ENTRY",
        appointmentsUntil: a.lastEndTime,
        clockedOutAt: null,
      });
      continue;
    }

    if (dayEntries.some((e) => e.open || e.endLocalTime === null)) continue;
    if (dayEntries.some((e) => e.endsOnLaterDay)) continue;
    let clockOut = "";
    for (const e of dayEntries) {
      if (e.endLocalTime !== null && e.endLocalTime > clockOut) clockOut = e.endLocalTime;
    }
    if (clockOut === "") continue;
    if (minutesOf(a.lastEndTime) - minutesOf(clockOut) <= APPOINTMENT_HINT_MIN_GAP_MINUTES)
      continue;
    if (input.dismissed.has(`${dayKey}|AFTER_CLOCK_OUT`)) continue;
    hints.push({
      employeeId: a.employeeId,
      date: a.date,
      kind: "AFTER_CLOCK_OUT",
      appointmentsUntil: a.lastEndTime,
      clockedOutAt: clockOut,
    });
  }

  return hints.sort((x, y) =>
    x.date === y.date ? x.employeeId.localeCompare(y.employeeId) : x.date < y.date ? 1 : -1,
  );
}

/**
 * Loads everything the rule needs and returns the open hints of the window. `employeeIds` is
 * undefined only for a whole-tenant reach (the access context's reach then maps to a tenant scope).
 * Returns `[]` as soon as a step leaves nothing. Tenant: every read is bound to `access.tenantId`.
 */
export async function loadAppointmentHints(
  db: FastifyInstance["prisma"],
  params: {
    access: AccessContext;
    employeeIds?: readonly string[];
    window: AppointmentHintWindow;
  },
): Promise<AppointmentHint[]> {
  const { access, window } = params;
  const tenantId = access.tenantId;
  if (window.days.length === 0) return [];
  if (params.employeeIds !== undefined && params.employeeIds.length === 0) return [];

  // (1) appointments — only through the Schichtplanung facade (O-2); end time per person and day.
  const ends = await getAppointmentDayEnds(
    db,
    employeeScopeFor(
      access,
      params.employeeIds ? { employeeIds: [...params.employeeIds] } : undefined,
    ),
    window.from,
    window.to,
  );
  if (ends.length === 0) return [];

  // (2) the persons with appointments; exempt (§ 18 ArbZG) and anonymised persons never get a hint.
  const people = await db.employee.findMany({
    where: {
      tenantId,
      id: { in: [...new Set(ends.map((e) => e.employeeId))] },
      ...NOT_ANONYMIZED_EMPLOYEE_WHERE,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      hireDate: true,
      exitDate: true,
      isTimeTrackingExempt: true,
    },
  });
  const eligible = people.filter((p) => !p.isTimeTrackingExempt);
  if (eligible.length === 0) return [];
  const eligibleIds = eligible.map((p) => p.id);
  const eligibleSet = new Set(eligibleIds);

  const excludedDays = new Set<string>();
  // D-04: a day before the tenant-local hire day or after the exit day is outside the employment.
  for (const p of eligible) {
    const hireDay = dateStrInTz(p.hireDate, window.tz);
    const exitDay = p.exitDate ? dateStrInTz(p.exitDate, window.tz) : null;
    for (const day of window.days) {
      if (day < hireDay || (exitDay !== null && day > exitDay)) {
        excludedDays.add(`${p.id}|${day}`);
      }
    }
  }

  // (3) entries, leave, pending Zeitnachtrag, closed months, dismissals — narrowed to the eligible persons.
  const scope = employeeScopeFor(access, { employeeIds: eligibleIds });

  const entryRows = await getRecordedWorkEntriesInRange(db, scope, window.from, window.to);
  const entries: EvaluateInput["entries"] = entryRows.map((e) => {
    const date = dateStrInTz(e.date, "UTC");
    return {
      employeeId: e.employeeId,
      date,
      open: e.endTime === null,
      endLocalTime: e.endTime ? timeStrInTz(e.endTime, window.tz) : null,
      endsOnLaterDay: e.endTime ? dateStrInTz(e.endTime, window.tz) > date : false,
    };
  });

  // An effective leave (half days included) excludes its days: entry creation is blocked there.
  const leave = await getActiveLeaveOverlapping(db, scope, window.from, window.to);
  for (const l of leave) {
    const last = dateStrInTz(l.endDate, "UTC");
    for (
      let d = new Date(l.startDate.getTime());
      dateStrInTz(d, "UTC") <= last;
      d = addDaysUtc(d, 1)
    ) {
      excludedDays.add(`${l.employeeId}|${dateStrInTz(d, "UTC")}`);
    }
  }

  // A pending Zeitnachtrag: the person already acted on that day.
  const pendingRetro = await db.retroEntryRequest.findMany({
    where: {
      ...employeeScopeWhere(scope),
      status: "PENDING",
      deletedAt: null,
      targetDate: { gte: window.from, lte: window.to },
    },
    select: { employeeId: true, targetDate: true },
  });
  for (const r of pendingRetro) {
    excludedDays.add(`${r.employeeId}|${dateStrInTz(r.targetDate, "UTC")}`);
  }

  // A closed month is never a subject of a hint (AC): every day of the window inside it is excluded.
  const monthByStart = new Map<string, { start: Date; ym: string }>(); // facade key date -> month
  for (const day of window.days) {
    const [y, m] = day.split("-").map(Number);
    const start = monthRangeUtc(y, m, window.tz).start;
    monthByStart.set(start.toISOString().slice(0, 10), { start, ym: day.slice(0, 7) });
  }
  const monthStarts = [...monthByStart.values()].map((m) => m.start);
  const closed = await getClosedMonthsForDates(db, eligibleIds, tenantId, monthStarts);
  for (const key of closed) {
    const [employeeId, startIso] = key.split("::");
    const month = monthByStart.get(startIso);
    if (!month) continue;
    for (const day of window.days) {
      if (day.startsWith(month.ym)) excludedDays.add(`${employeeId}|${day}`);
    }
  }

  const dismissalRows = await db.appointmentHintDismissal.findMany({
    where: {
      tenantId,
      employeeId: { in: eligibleIds },
      date: { gte: window.from, lte: window.to },
    },
    select: { employeeId: true, date: true, kind: true },
  });
  const dismissed = new Set(
    dismissalRows.map((d) => `${d.employeeId}|${dateStrInTz(d.date, "UTC")}|${d.kind}`),
  );

  // (4) the rule, then the display name.
  const raw = evaluateAppointmentHints({
    window,
    appointmentEnds: ends
      .filter((e) => eligibleSet.has(e.employeeId))
      .map((e) => ({
        employeeId: e.employeeId,
        date: dateStrInTz(e.date, "UTC"),
        lastEndTime: e.lastEndTime,
      })),
    entries,
    excludedDays,
    dismissed,
  });
  const nameOf = new Map(eligible.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return raw.map((h) => ({ ...h, personName: nameOf.get(h.employeeId) ?? "" }));
}
