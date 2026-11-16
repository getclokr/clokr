// Issue #986 — how Team › Zeiten judges a person's day against the Soll, outside the page (the page
// imports `$app/*` and cannot be mounted in vitest).
//
// The Soll of a past day and the Ist it is compared with come from the working-time account only:
// the day shares of `GET /overtime/month-saldo` (#594: each day's own Soll and Ist from the same
// closeEmployeeMonth run as the month header). That Ist contains the Berufsschule credit (CLAUDE.md
// #433 bullet: a Berufsschule day is credited to worked minutes, it never reduces the Soll), so a
// Berufsschule day reads like the account - credited, never a minus.
//
// Without a Soll the caller may read (no `contract:read` / `overtime:read` over the person, a refused
// or failed read, or day lists withheld by #86) the page judges NOTHING: no „Soll erfüllt“, no
// „Teilweise“, no „Fehlt“. Before #986 a missing contract made the Soll 0 and every worked day fell
// into „Teilweise“ - a guessed status.
import { hasPermission, type PermissionHolder } from "$lib/permissions";

export type ZeitenDayStatus =
  | "future"
  | "today-ok"
  | "today-partial"
  | "today-empty"
  | "ok"
  | "partial"
  | "missing"
  | "noExpect"
  | "absence"
  /** Entries recorded, but no readable Soll to judge them against (Issue #986). */
  | "recorded"
  /** Nothing recorded and no readable Soll: no statement at all (Issue #986). */
  | "unjudged";

/** The account's own share of one day (`GET /overtime/month-saldo` `days[]`, #594). */
export interface AccountDayShare {
  expectedMinutes?: number;
  workedMinutes?: number;
}

export interface DayJudgementInput {
  isFuture: boolean;
  isToday: boolean;
  hasEntries: boolean;
  /** The day's recorded working minutes of the entries the caller sees. */
  entryWorkedMin: number;
  /** A full-day leave of the day (a half day is no full absence). */
  fullAbsence: boolean;
  /** MONTHLY_HOURS: no per-day target at all (Issue #433), only „worked or not“. */
  monthly: boolean;
  /** True only when the caller read the person's contract AND account day shares. */
  sollReadable: boolean;
  /** The account's share of this (past) day; absent for today, the future and outside the window. */
  share: AccountDayShare | null;
  /**
   * SHIFT_BASED: the day's planned roster minutes (net). The account's day share of a SHIFT_BASED
   * month is roster-prorated, so the cell keeps comparing against the roster day itself.
   */
  rosterExpectedMin: number | null;
  /**
   * The day's contract Soll from the person's contract (after holiday, leave and hire-day
   * reductions), read only when `sollReadable`: for today (no account share yet, #438) and for a
   * past day the account sent no share for (a closed month keeps only its stored snapshot).
   */
  contractExpectedMin: number;
  /** A Berufsschule day: the account credits it, so today it never reads as owed. */
  isVocationalSchool: boolean;
}

export interface DayJudgement {
  status: ZeitenDayStatus;
  /** The Soll the cell and the list show (0 = none or not readable). */
  expectedMin: number;
  /** The account's Ist of the day (entries plus credits); null where the account was not read. */
  creditedMin: number | null;
}

export function judgeZeitenDay(input: DayJudgementInput): DayJudgement {
  const readable = input.sollReadable;
  if (input.isFuture) {
    // A future day is never judged; its planned Soll is shown only where the contract was read.
    const planned = readable
      ? Math.max(0, input.rosterExpectedMin ?? input.contractExpectedMin)
      : 0;
    return { status: "future", expectedMin: input.fullAbsence ? 0 : planned, creditedMin: null };
  }
  if (input.fullAbsence) {
    return { status: "absence", expectedMin: 0, creditedMin: null };
  }
  if (input.monthly) {
    // MONTHLY_HOURS: no per-day targets - only whether worked, never "missing" and never a Soll
    // status.
    if (input.isToday && !input.hasEntries) {
      return { status: "today-empty", expectedMin: 0, creditedMin: null };
    }
    return {
      status: input.hasEntries ? "recorded" : "noExpect",
      expectedMin: 0,
      creditedMin: null,
    };
  }
  if (!readable) {
    return {
      status: input.hasEntries ? "recorded" : "unjudged",
      expectedMin: 0,
      creditedMin: null,
    };
  }
  const share = input.share;
  if (
    !input.isToday &&
    share &&
    share.expectedMinutes !== undefined &&
    share.workedMinutes !== undefined
  ) {
    const expected = Math.max(0, input.rosterExpectedMin ?? share.expectedMinutes);
    const credited = share.workedMinutes;
    let status: ZeitenDayStatus;
    if (expected <= 0) status = "noExpect";
    else if (credited >= expected) status = "ok";
    else if (credited > 0 || input.hasEntries) status = "partial";
    else status = "missing";
    return { status, expectedMin: expected, creditedMin: credited };
  }

  // No account share: today, or a day of a closed month. Judged against the contract Soll the caller
  // read; a Berufsschule day is credited by the account, so it is never owed.
  const expected = Math.max(0, input.rosterExpectedMin ?? input.contractExpectedMin);
  if (input.isToday) {
    if (input.isVocationalSchool)
      return { status: "today-ok", expectedMin: expected, creditedMin: null };
    if (!input.hasEntries)
      return { status: "today-empty", expectedMin: expected, creditedMin: null };
    return {
      status: input.entryWorkedMin >= expected ? "today-ok" : "today-partial",
      expectedMin: expected,
      creditedMin: null,
    };
  }
  if (expected <= 0) {
    return { status: "noExpect", expectedMin: 0, creditedMin: null };
  }
  if (input.isVocationalSchool) return { status: "ok", expectedMin: expected, creditedMin: null };
  if (!input.hasEntries) return { status: "missing", expectedMin: expected, creditedMin: null };
  return {
    status: input.entryWorkedMin >= expected ? "ok" : "partial",
    expectedMin: expected,
    creditedMin: null,
  };
}

/**
 * Whether the caller holds the read permission for a person's figures: the whole reach
 * (`ZUGEWIESEN`) for anyone, the own reach (`EIGENE`) for the own person. The server still decides
 * the reach itself (a person outside it answers 403/404); this only spares a request the caller's
 * permission set already refuses - the two 403s of the user test.
 */
export function mayReadPersonFigures(
  user: (PermissionHolder & { employeeId?: string | null }) | null | undefined,
  resource: "contract" | "overtime",
  employeeId: string,
): boolean {
  if (hasPermission(user, `${resource}:read:ZUGEWIESEN`)) return true;
  return (
    !!user?.employeeId &&
    user.employeeId === employeeId &&
    hasPermission(user, `${resource}:read:EIGENE`)
  );
}
