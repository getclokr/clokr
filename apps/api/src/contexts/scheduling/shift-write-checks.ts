/**
 * shift-write-checks.ts
 *
 * Issue #1075 — the ONE gate every roster write that ADDS planned working time passes: POST /shifts,
 * PUT /shifts/:id, the restore of a removed shift, POST /shifts/bulk, POST /shifts/generate-week and
 * POST /shifts/copy-week all call `checkShiftWrite`, with the same six rules in the same order:
 *
 *   1. contract      a WorkSchedule row of the person valid on the day (Issue #589) and the day not
 *                    after the person's exit day (Issue #1101; the exit day itself stays plannable)
 *   2. pastDay       the day is not before the TENANT's calendar day (Phase 47.2, Issue #1075 GD-6)
 *   3. openingHours  the salon's opening hours (Phase 47.5), overridable on a single write
 *   4. minorLimits   JArbSchG §§ 8, 12-18 for a person under 18 (Issues #1057, #1076, #1106, minor-shift-limits.ts)
 *   5. dailyMax      § 3 ArbZG: at most 10:00 net Arbeitszeit a day — the SUM of the person's shifts
 *   6. restPeriod    § 5 ArbZG: 11 h to the previous day's last shift AND to the next day's first shift
 *
 * Decisions (the record is the #1075 comment and docs/compliance.md):
 *  - GD-3 § 3 is a DAY rule (§ 3 Satz 1 "werktägliche Arbeitszeit", § 2 Abs. 1): every shift of the
 *    day is netted with the one break rule (`shiftNettoMinutes`, #1011) and summed. Not overridable.
 *  - GD-4 § 5 is checked in both directions; a violated direction is one `restGaps` entry.
 *  - GD-5 a write is refused only when it creates a violation or enlarges one (the day sum grows,
 *    the gap to that neighbour shrinks), so a label-only edit of an already illegal legacy shift passes.
 *  - GD-6 "past" is strictly before the tenant's calendar day, never the server clock.
 *  - GD-2 the overridable findings (opening hours, § 5) are overridden per single write only; the
 *    collective paths call the gate with `force: false`.
 *
 * The module only READS: it never writes a row, an audit entry or a saldo figure. A change that is
 * not blocked JOINS the context, so the next change of a batch is judged against it.
 */
import type { PrismaClient } from "@clokr/db";
import { dayLabelDe } from "../../utils/day-label-de";
import { mondayOfWeekUtc } from "../absence";
import type { BreakTenantConfigShape } from "../time-tracking";
import { dateStrInTz, dayRangeUtc, getTenantTimezone } from "../working-time-account";
import {
  findMinorShiftLimitViolation,
  loadMinorShiftWeeks,
  minorShiftLimitReplyBody,
  minorWeekHorizon,
  type MinorShiftLimitCode,
  type MinorShiftWeek,
} from "./minor-shift-limits";
import { shiftBruttoMinutes, shiftNettoMinutes } from "./shift-netto";

// ── public vocabulary ────────────────────────────────────────────────────────────────────────────

/** The six rules, in the order `checkShiftWrite` runs them (pinned by `shift-write-paths-1057.test.ts`). */
export const SHIFT_WRITE_RULES = [
  "contract",
  "pastDay",
  "openingHours",
  "minorLimits",
  "dailyMax",
  "restPeriod",
] as const;
export type ShiftWriteRule = (typeof SHIFT_WRITE_RULES)[number];

/** The `reason` a collective path puts on a skipped cell, per rule. */
export const SHIFT_WRITE_SKIP_REASON = {
  contract: "no-contract",
  pastDay: "past",
  openingHours: "outside-store-hours",
  minorLimits: "jarbschg",
  dailyMax: "arbzg-daily-max",
  restPeriod: "arbzg-rest-period",
} as const satisfies Record<ShiftWriteRule, string>;
export type ShiftWriteSkipReason = (typeof SHIFT_WRITE_SKIP_REASON)[ShiftWriteRule];

export const SHIFT_PAST_MESSAGE =
  "Schicht in der Vergangenheit ist nicht änderbar (Revisionssicherheit).";

/** A day is past when it lies strictly before the tenant's calendar day; today stays plannable (GD-6). */
export function isPastShiftDay(todayIso: string, dateIso: string): boolean {
  return dateIso < todayIso;
}

/** The tenant's calendar day (tenant time zone, not the server clock). */
export async function tenantTodayIso(prisma: PrismaClient, tenantId: string): Promise<string> {
  return dateStrInTz(new Date(), await getTenantTimezone(prisma, tenantId));
}

/** The target salon of a write: its id (holidays, § 18 JArbSchG) and its opening hours. */
export interface ShiftWriteSalon {
  id: string;
  openingHours: unknown;
}

export interface ShiftWriteDraft {
  employeeId: string;
  dateIso: string;
  startTime: string;
  endTime: string;
  /**
   * The target salon: its `Salon.openingHours` feed the opening-hours rule (Phase 325 D-11,
   * null/undefined = no opening-hours check) and its holidays § 18 JArbSchG (Issue #1106).
   */
  salon?: ShiftWriteSalon | null;
}

export interface ShiftWriteChange {
  draft: ShiftWriteDraft;
  /** The stored shift this write replaces (PUT): leaves the day lists and the minor week for the check. */
  replaces?: { id: string; dateIso: string };
}

export interface ShiftWriteRestGap {
  direction: "previous" | "next";
  otherShiftId: string;
  restHours: number;
}

export interface ShiftWriteFinding {
  rule: ShiftWriteRule;
  code: string;
  message: string;
  status: 409 | 422;
  overridable: boolean;
  /** The draft's day; the JArbSchG reply body reads it. */
  dateIso: string;
  restGaps?: ShiftWriteRestGap[];
}

export interface ShiftWriteVerdict {
  /** The first finding that stops the write; null when the write may go on. */
  blocking: ShiftWriteFinding | null;
  /** Overridable findings the caller forced (`force: true`); each one needs its SHIFT_FORCED_* audit. */
  forced: ShiftWriteFinding[];
}

// ── context ──────────────────────────────────────────────────────────────────────────────────────

interface StoredShift {
  id: string;
  employeeId: string;
  dateIso: string;
  startTime: string;
  endTime: string;
}

interface ShiftWriteEmployee {
  id: string;
  birthDate: Date | null;
  breakOver6hOverride: number | null;
  breakOver9hOverride: number | null;
  /** Inclusive last working day (Issue #1101), read as a tenant-local calendar day; null = employed. */
  exitDate: Date | null;
}

export interface ShiftWriteContext {
  readonly tz: string;
  readonly todayIso: string;
  readonly tenantConfig: {
    defaultBreakOver6h: number | null;
    defaultBreakOver9h: number | null;
    shiftStoreHoursMode: string | null;
  } | null;
  readonly employees: Map<string, ShiftWriteEmployee>;
  readonly earliestContractStart: Map<string, Date>;
  readonly shiftsByEmployee: Map<string, StoredShift[]>;
  /** Keyed `<employeeId>::<mondayIso>`; only persons who are minors in that week are present. */
  readonly minorWeeks: Map<string, MinorShiftWeek>;
  draftSeq: number;
}

export interface ShiftWriteContextInput {
  tz: string;
  todayIso: string;
  tenantConfig: ShiftWriteContext["tenantConfig"];
  employees: ShiftWriteEmployee[];
  earliestContractStart: Map<string, Date>;
  shifts: StoredShift[];
  minorWeeks: Map<string, MinorShiftWeek>;
}

/** PURE: builds the mutable context from already-loaded facts. */
export function buildShiftWriteContext(input: ShiftWriteContextInput): ShiftWriteContext {
  const shiftsByEmployee = new Map<string, StoredShift[]>();
  for (const s of input.shifts) {
    const list = shiftsByEmployee.get(s.employeeId) ?? [];
    list.push({ ...s });
    shiftsByEmployee.set(s.employeeId, list);
  }
  return {
    tz: input.tz,
    todayIso: input.todayIso,
    tenantConfig: input.tenantConfig,
    employees: new Map(input.employees.map((e) => [e.id, e])),
    earliestContractStart: input.earliestContractStart,
    shiftsByEmployee,
    minorWeeks: input.minorWeeks,
    draftSeq: 0,
  };
}

function utcMidnight(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function addDaysIso(iso: string, n: number): string {
  const d = utcMidnight(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayIsoOf(iso: string): string {
  return mondayOfWeekUtc(utcMidnight(iso)).toISOString().slice(0, 10);
}

/**
 * Loads the facts the six rules read for `employeeIds` over the days `fromIso..toIso` (every query is
 * tenant-scoped) and builds the context. Empty `employeeIds` returns an empty context without a query.
 */
export async function loadShiftWriteContext(
  prisma: PrismaClient,
  tenantId: string,
  scope: { employeeIds: string[]; fromIso: string; toIso: string },
): Promise<ShiftWriteContext> {
  const employeeIds = Array.from(new Set(scope.employeeIds));
  if (employeeIds.length === 0) {
    return buildShiftWriteContext({
      tz: "UTC",
      todayIso: dateStrInTz(new Date(), "UTC"),
      tenantConfig: null,
      employees: [],
      earliestContractStart: new Map(),
      shifts: [],
      minorWeeks: new Map(),
    });
  }

  const tenantConfig = await prisma.tenantConfig.findUnique({
    where: { tenantId },
    select: { defaultBreakOver6h: true, defaultBreakOver9h: true, shiftStoreHoursMode: true },
  });
  const tz = await getTenantTimezone(prisma, tenantId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, tenantId },
    select: {
      id: true,
      birthDate: true,
      breakOver6hOverride: true,
      breakOver9hOverride: true,
      exitDate: true,
    },
  });
  const schedules = await prisma.workSchedule.findMany({
    where: { employeeId: { in: employeeIds }, employee: { tenantId } },
    select: { employeeId: true, validFrom: true },
  });
  const earliestContractStart = new Map<string, Date>();
  for (const s of schedules) {
    const current = earliestContractStart.get(s.employeeId);
    if (!current || s.validFrom < current) earliestContractStart.set(s.employeeId, s.validFrom);
  }
  // Every origin and every flagged row counts: planned is planned.
  const stored = await prisma.shift.findMany({
    where: {
      employeeId: { in: employeeIds },
      employee: { tenantId },
      deletedAt: null,
      date: {
        gte: utcMidnight(addDaysIso(scope.fromIso, -1)),
        lte: utcMidnight(addDaysIso(scope.toIso, 1)),
      },
    },
    select: { id: true, employeeId: true, date: true, startTime: true, endTime: true },
  });

  const minorWeeks = new Map<string, MinorShiftWeek>();
  const lastMonday = mondayIsoOf(scope.toIso);
  for (let mon = mondayIsoOf(scope.fromIso); mon <= lastMonday; mon = addDaysIso(mon, 7)) {
    // The draft's salon is not known at load time, so the week asks for the holidays of every salon of
    // the tenant (Issue #1106, § 18 JArbSchG).
    const weeks = await loadMinorShiftWeeks(prisma, tenantId, employeeIds, utcMidnight(mon), {
      allTenantSalons: true,
    });
    for (const [employeeId, week] of weeks) minorWeeks.set(`${employeeId}::${mon}`, week);
  }

  return buildShiftWriteContext({
    tz,
    todayIso: dateStrInTz(new Date(), tz),
    tenantConfig,
    employees,
    earliestContractStart,
    shifts: stored.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      dateIso: s.date.toISOString().slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    minorWeeks,
  });
}

// ── the rules ────────────────────────────────────────────────────────────────────────────────────

function employeeOf(ctx: ShiftWriteContext, employeeId: string): ShiftWriteEmployee {
  const emp = ctx.employees.get(employeeId);
  // Fail-closed: a person the context did not load is never silently judged "fine".
  if (!emp) throw new Error(`shift-write-checks: employee ${employeeId} is not in the context`);
  return emp;
}

function breakShapeOf(ctx: ShiftWriteContext): BreakTenantConfigShape {
  return {
    defaultBreakOver6h: ctx.tenantConfig?.defaultBreakOver6h ?? 30,
    defaultBreakOver9h: ctx.tenantConfig?.defaultBreakOver9h ?? 45,
  };
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function grossOf(s: { dateIso: string; startTime: string; endTime: string }): number {
  return shiftBruttoMinutes({
    date: utcMidnight(s.dateIso),
    startTime: s.startTime,
    endTime: s.endTime,
  });
}

/** Minutes since the epoch day 0 at which the shift starts. */
function absStart(s: { dateIso: string; startTime: string }): number {
  return Math.floor(utcMidnight(s.dateIso).getTime() / 86_400_000) * 1440 + hmToMin(s.startTime);
}

function contractRule(ctx: ShiftWriteContext, change: ShiftWriteChange): ShiftWriteFinding | null {
  const { draft } = change;
  const earliest = ctx.earliestContractStart.get(draft.employeeId);
  const startsInTime = !!earliest && earliest <= dayRangeUtc(draft.dateIso, ctx.tz).end;
  // Issue #1101: exitDate is inclusive (the exit day is the last working day) and read as the
  // tenant-local calendar day, like minor-shift-limits.ts and the generate-week skip. The exit day
  // itself stays plannable; only a day after it is refused.
  const exitDate = employeeOf(ctx, draft.employeeId).exitDate;
  const exitDay = exitDate ? dateStrInTz(exitDate, ctx.tz) : null;
  const beforeExit = exitDay === null || draft.dateIso <= exitDay;
  if (startsInTime && beforeExit) return null;
  return {
    rule: "contract",
    code: "SHIFT_NO_CONTRACT",
    message: "Für diese Person gilt an diesem Tag kein Vertrag.",
    status: 422,
    overridable: false,
    dateIso: draft.dateIso,
  };
}

function pastDayRule(ctx: ShiftWriteContext, change: ShiftWriteChange): ShiftWriteFinding | null {
  const { draft, replaces } = change;
  const past =
    (replaces && isPastShiftDay(ctx.todayIso, replaces.dateIso)) ||
    isPastShiftDay(ctx.todayIso, draft.dateIso);
  if (!past) return null;
  return {
    rule: "pastDay",
    code: "SHIFT_PAST_IMMUTABLE",
    message: SHIFT_PAST_MESSAGE,
    status: 422,
    overridable: false,
    dateIso: draft.dateIso,
  };
}

/**
 * Phase 47.5 — a shift falls inside its own salon's opening hours. Since Phase 325 (issue #325) this
 * reads the SHIFT'S OWN `Salon.openingHours` (0=Mo..6=So) — the caller passes the target salon's
 * (POST: the assigned salon; PUT: the new salonId if given, else the shift's existing salon, D-10).
 * `shiftStoreHoursMode` stays a TENANT setting. The tenant-level opening-hours column is retired
 * (#563) and nothing mirrors into salons any more — hours are edited per salon only.
 * D-11 preserves every OLD null-return exactly: no TenantConfig row -> no check (a tenant whose
 * config row does not exist gets no check at all, regardless of what its salon's hours say); mode
 * OFF -> none; hours not a real array -> none (the old missing-value branch, now guarding a
 * malformed/absent `openingHours` value); weekday entry missing -> none; closed-day and STRICT
 * comparisons unchanged. Cross-midnight shifts (end < start) are NOT supported by the STRICT check —
 * they always fail because they leave the day's open/close window; users override via force=true.
 */
function openingHoursRule(
  ctx: ShiftWriteContext,
  change: ShiftWriteChange,
): ShiftWriteFinding | null {
  const { draft } = change;
  if (!ctx.tenantConfig) return null; // D-11: no TenantConfig row -> no check
  const mode = ctx.tenantConfig.shiftStoreHoursMode ?? "DAY_ONLY";
  if (mode === "OFF") return null;
  if (!Array.isArray(draft.salon?.openingHours)) return null; // D-11: the old missing-value branch
  const rows = draft.salon?.openingHours as Array<{
    day: number;
    open: string;
    close: string;
    closed?: boolean;
  }>;
  // dayOfWeek: 0=Mo..6=So (matches schema comment)
  const jsDow = utcMidnight(draft.dateIso).getUTCDay();
  const dow = jsDow === 0 ? 6 : jsDow - 1;
  const entry = rows.find((r) => r.day === dow);
  if (!entry) return null;
  const finding = (message: string): ShiftWriteFinding => ({
    rule: "openingHours",
    code: "SHIFT_OUTSIDE_STORE_HOURS",
    message,
    status: 409,
    overridable: true,
    dateIso: draft.dateIso,
  });
  if (entry.closed) {
    return finding(
      `Schicht am ${dayLabelDe(draft.dateIso)} außerhalb der Öffnungszeiten — Geschäft geschlossen.`,
    );
  }
  // DAY_ONLY: closed-day check above is sufficient; pre/post-hour shifts (Vorbereitung/Aufräumen) allowed.
  if (mode === "DAY_ONLY") return null;
  // STRICT: string compare on HH:MM works because zero-padded.
  if (draft.startTime < entry.open || draft.endTime > entry.close) {
    return finding(
      `Schicht ${draft.startTime}–${draft.endTime} außerhalb der Öffnungszeiten (${entry.open}–${entry.close}).`,
    );
  }
  return null;
}

function minorLimitsRule(
  ctx: ShiftWriteContext,
  change: ShiftWriteChange,
): ShiftWriteFinding | null {
  const { draft, replaces } = change;
  const week = ctx.minorWeeks.get(`${draft.employeeId}::${mondayIsoOf(draft.dateIso)}`);
  if (!week) return null;
  const hit = findMinorShiftLimitViolation(week, {
    removeShiftId: replaces?.id,
    add: [
      {
        date: utcMidnight(draft.dateIso),
        startTime: draft.startTime,
        endTime: draft.endTime,
        salonId: draft.salon?.id ?? null,
      },
    ],
  });
  if (!hit) return null;
  return {
    rule: "minorLimits",
    code: hit.code,
    message: hit.message,
    status: 422,
    overridable: false,
    dateIso: hit.dateIso,
  };
}

function hoursMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** § 3 ArbZG as a day rule (GD-3), refused only when the write makes the day sum larger (GD-5). */
function dailyMaxRule(ctx: ShiftWriteContext, change: ShiftWriteChange): ShiftWriteFinding | null {
  const { draft, replaces } = change;
  const emp = employeeOf(ctx, draft.employeeId);
  const breakShape = breakShapeOf(ctx);
  const netOf = (s: { dateIso: string; startTime: string; endTime: string }): number =>
    shiftNettoMinutes(
      { date: utcMidnight(s.dateIso), startTime: s.startTime, endTime: s.endTime },
      emp,
      breakShape,
    );
  const ofDay = (ctx.shiftsByEmployee.get(draft.employeeId) ?? []).filter(
    (s) => s.dateIso === draft.dateIso,
  );
  const before = ofDay.reduce((sum, s) => sum + netOf(s), 0);
  const after =
    ofDay.filter((s) => s.id !== replaces?.id).reduce((sum, s) => sum + netOf(s), 0) + netOf(draft);
  if (after <= 600 || after <= before) return null;
  return {
    rule: "dailyMax",
    code: "ARBZG_VIOLATION_DAILY_MAX",
    message: `Die geplante Arbeitszeit am ${dayLabelDe(draft.dateIso)} beträgt ${hoursMinutes(after)} Stunden. Erlaubt sind höchstens 10 Stunden am Tag (§ 3 ArbZG).`,
    status: 422,
    overridable: false,
    dateIso: draft.dateIso,
  };
}

/** § 5 ArbZG in both directions (GD-4), refused only when the gap to a neighbour shrinks (GD-5). */
function restPeriodRule(
  ctx: ShiftWriteContext,
  change: ShiftWriteChange,
): ShiftWriteFinding | null {
  const { draft, replaces } = change;
  const gross = grossOf(draft);
  if (gross <= 0) return null;
  const draftStart = absStart(draft);
  const draftEnd = draftStart + gross;
  const own = ctx.shiftsByEmployee.get(draft.employeeId) ?? [];
  const replaced = replaces ? own.find((s) => s.id === replaces.id) : undefined;
  const sameDayReplaced = replaced && replaced.dateIso === draft.dateIso ? replaced : undefined;
  const replacedStart = sameDayReplaced ? absStart(sameDayReplaced) : 0;
  const replacedEnd = sameDayReplaced ? replacedStart + grossOf(sameDayReplaced) : 0;

  const prevIso = addDaysIso(draft.dateIso, -1);
  const nextIso = addDaysIso(draft.dateIso, 1);
  let worstPrev: ShiftWriteRestGap | null = null;
  let worstNext: ShiftWriteRestGap | null = null;
  for (const n of own) {
    if (n.id === replaces?.id) continue;
    const nGross = grossOf(n);
    if (nGross <= 0) continue;
    const nStart = absStart(n);
    if (n.dateIso === prevIso) {
      const gap = draftStart - (nStart + nGross);
      if (gap >= 660) continue;
      if (sameDayReplaced && replacedStart - (nStart + nGross) <= gap) continue; // not worse
      if (!worstPrev || gap / 60 < worstPrev.restHours) {
        worstPrev = { direction: "previous", otherShiftId: n.id, restHours: gap / 60 };
      }
    } else if (n.dateIso === nextIso) {
      const gap = nStart - draftEnd;
      if (gap >= 660) continue;
      if (sameDayReplaced && nStart - replacedEnd <= gap) continue; // not worse
      if (!worstNext || gap / 60 < worstNext.restHours) {
        worstNext = { direction: "next", otherShiftId: n.id, restHours: gap / 60 };
      }
    }
  }
  const gaps = [worstPrev, worstNext].filter((g): g is ShiftWriteRestGap => g !== null);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a.restHours - b.restHours);
  const worst = gaps[0];
  const message =
    worst.direction === "previous"
      ? `Verstoß gegen § 5 ArbZG: zwischen Schichtende am ${dayLabelDe(prevIso)} und neuem Beginn liegen nur ${worst.restHours.toFixed(1)}h (mindestens 11h erforderlich).`
      : `Verstoß gegen § 5 ArbZG: zwischen neuem Schichtende und dem Schichtbeginn am ${dayLabelDe(nextIso)} liegen nur ${worst.restHours.toFixed(1)}h (mindestens 11h erforderlich).`;
  return {
    rule: "restPeriod",
    code: "ARBZG_VIOLATION_REST_PERIOD",
    message,
    status: 409,
    overridable: true,
    dateIso: draft.dateIso,
    restGaps: gaps,
  };
}

/** The change joins the context so the next change of a batch is judged against it. */
function joinContext(ctx: ShiftWriteContext, change: ShiftWriteChange): void {
  const { draft, replaces } = change;
  if (replaces) {
    const own = ctx.shiftsByEmployee.get(draft.employeeId);
    if (own) {
      ctx.shiftsByEmployee.set(
        draft.employeeId,
        own.filter((s) => s.id !== replaces.id),
      );
    }
    for (const [key, week] of ctx.minorWeeks) {
      if (key.startsWith(`${draft.employeeId}::`)) {
        week.shifts = week.shifts.filter((s) => s.id !== replaces.id);
      }
    }
  }
  const id = `shift-write-draft-${ctx.draftSeq++}`;
  const list = ctx.shiftsByEmployee.get(draft.employeeId) ?? [];
  list.push({
    id,
    employeeId: draft.employeeId,
    dateIso: draft.dateIso,
    startTime: draft.startTime,
    endTime: draft.endTime,
  });
  ctx.shiftsByEmployee.set(draft.employeeId, list);
  // The draft joins EVERY minor week whose horizon holds its day: the Sunday of one week is the
  // Monday-before of the next, so a later change of the batch must see it there (§ 13 JArbSchG).
  for (const [key, week] of ctx.minorWeeks) {
    if (!key.startsWith(`${draft.employeeId}::`)) continue;
    if (!minorWeekHorizon(week).includes(draft.dateIso)) continue;
    week.shifts.push({
      id,
      date: utcMidnight(draft.dateIso),
      startTime: draft.startTime,
      endTime: draft.endTime,
      salonId: draft.salon?.id ?? null,
    });
  }
}

/**
 * PURE. Runs the six rules in `SHIFT_WRITE_RULES` order; the first blocking finding ends the walk.
 * An overridable finding is blocking unless `opts.force`, then it goes to `forced`. A change that
 * does not block joins the context.
 */
export function checkShiftWrite(
  ctx: ShiftWriteContext,
  change: ShiftWriteChange,
  opts: { force: boolean },
): ShiftWriteVerdict {
  employeeOf(ctx, change.draft.employeeId);
  const forced: ShiftWriteFinding[] = [];
  // One lazy step per rule, in SHIFT_WRITE_RULES order; `shift-write-paths-1057.test.ts` pins them.
  const steps: Array<() => ShiftWriteFinding | null> = [
    () => contractRule(ctx, change),
    () => pastDayRule(ctx, change),
    () => openingHoursRule(ctx, change),
    () => minorLimitsRule(ctx, change),
    () => dailyMaxRule(ctx, change),
    () => restPeriodRule(ctx, change),
  ];
  for (const step of steps) {
    const finding = step();
    if (!finding) continue;
    if (finding.overridable && opts.force) {
      forced.push(finding);
      continue;
    }
    return { blocking: finding, forced: [] };
  }
  joinContext(ctx, change);
  return { blocking: null, forced };
}

// ── the answer ───────────────────────────────────────────────────────────────────────────────────

/**
 * The reply body of a blocking finding, in the shapes the single write paths always answered.
 * `canForce: false` is for the collective paths, which have no override (GD-2).
 */
export function shiftWriteReplyBody(
  finding: ShiftWriteFinding,
  titles: { contract: string; past: string },
  opts?: { canForce?: boolean },
): Record<string, unknown> {
  const canForce = opts?.canForce ?? true;
  switch (finding.rule) {
    case "contract":
      return { error: titles.contract, code: finding.code, message: finding.message };
    case "pastDay":
      return { error: titles.past, code: finding.code, message: finding.message };
    case "openingHours":
      return {
        error: "Schicht außerhalb Öffnungszeiten",
        code: finding.code,
        message: finding.message,
        canForce,
      };
    case "minorLimits":
      return minorShiftLimitReplyBody({
        code: finding.code as MinorShiftLimitCode,
        dateIso: finding.dateIso,
        message: finding.message,
      });
    case "dailyMax":
      return {
        error: "ArbZG-Verstoß",
        code: finding.code,
        message: finding.message,
        canForce: false,
      };
    case "restPeriod":
      return { error: "ArbZG-Verstoß", code: finding.code, message: finding.message, canForce };
  }
}
