// Issue #986 — Team › Zeiten judges a day only against the account's Soll the caller read, and a
// Berufsschule day reads like the account: credited, never a minus.
import { describe, expect, it } from "vitest";
import {
  judgeZeitenDay,
  mayReadPersonFigures,
  type DayJudgementInput,
} from "../zeiten-day-judgement";
import { teamDayRows } from "../zeiten-day-rows";

function day(overrides: Partial<DayJudgementInput>): DayJudgementInput {
  return {
    isFuture: false,
    isToday: false,
    hasEntries: false,
    entryWorkedMin: 0,
    fullAbsence: false,
    monthly: false,
    sollReadable: true,
    share: null,
    rosterExpectedMin: null,
    contractExpectedMin: 480,
    isVocationalSchool: false,
    ...overrides,
  };
}

describe("judgeZeitenDay (Issue #986)", () => {
  it("a Berufsschule day is credited by the account: Soll erfüllt, never a minus", () => {
    // The account's share of a Berufsschule day: Soll 8:00, Ist 8:00 (the credit), no entry.
    const j = judgeZeitenDay(
      day({ share: { expectedMinutes: 480, workedMinutes: 480 }, isVocationalSchool: true }),
    );
    expect(j.status).toBe("ok");
    expect(j.creditedMin).toBe(480);
    expect(j.creditedMin! - j.expectedMin).toBe(0);
  });

  it("a Berufsschule day of a closed month (no account share) is not owed either", () => {
    expect(judgeZeitenDay(day({ isVocationalSchool: true })).status).toBe("ok");
    expect(judgeZeitenDay(day({ isVocationalSchool: true, isToday: true })).status).toBe(
      "today-ok",
    );
  });

  it("a full 8-hour day against an 8-hour account Soll is „Soll erfüllt“", () => {
    const j = judgeZeitenDay(
      day({
        hasEntries: true,
        entryWorkedMin: 480,
        share: { expectedMinutes: 480, workedMinutes: 480 },
      }),
    );
    expect(j.status).toBe("ok");
  });

  it("without a readable Soll nothing is judged — no „Teilweise“, no „Fehlt“, no Soll", () => {
    const worked = judgeZeitenDay(
      day({ sollReadable: false, hasEntries: true, entryWorkedMin: 480, contractExpectedMin: 0 }),
    );
    expect(worked).toEqual({ status: "recorded", expectedMin: 0, creditedMin: null });
    const empty = judgeZeitenDay(day({ sollReadable: false }));
    expect(empty).toEqual({ status: "unjudged", expectedMin: 0, creditedMin: null });
    const today = judgeZeitenDay(day({ sollReadable: false, isToday: true, hasEntries: true }));
    expect(today.status).toBe("recorded");
  });

  it("judges a past day only from the account's share, not from the contract", () => {
    // Half-day leave already reduced by the account: Soll 4:00, worked 4:00.
    const j = judgeZeitenDay(
      day({
        hasEntries: true,
        entryWorkedMin: 240,
        contractExpectedMin: 480,
        share: { expectedMinutes: 240, workedMinutes: 240 },
      }),
    );
    expect(j.status).toBe("ok");
    expect(j.expectedMin).toBe(240);
  });

  it("a real gap is still „Fehlt“, a short day „Teilweise“, a day without Soll „Kein Soll“", () => {
    expect(judgeZeitenDay(day({ share: { expectedMinutes: 480, workedMinutes: 0 } })).status).toBe(
      "missing",
    );
    expect(
      judgeZeitenDay(day({ hasEntries: true, share: { expectedMinutes: 480, workedMinutes: 300 } }))
        .status,
    ).toBe("partial");
    expect(
      judgeZeitenDay(day({ hasEntries: true, share: { expectedMinutes: 0, workedMinutes: 120 } }))
        .status,
    ).toBe("noExpect");
  });

  it("MONTHLY_HOURS gives no Soll status, the future is never judged", () => {
    expect(judgeZeitenDay(day({ monthly: true, hasEntries: true })).status).toBe("recorded");
    expect(judgeZeitenDay(day({ monthly: true, isToday: true })).status).toBe("today-empty");
    expect(judgeZeitenDay(day({ isFuture: true })).status).toBe("future");
    expect(judgeZeitenDay(day({ isFuture: true, sollReadable: false })).expectedMin).toBe(0);
  });

  it("SHIFT_BASED compares against the roster day, with the account's Ist", () => {
    const j = judgeZeitenDay(
      day({
        hasEntries: true,
        rosterExpectedMin: 480,
        share: { expectedMinutes: 455, workedMinutes: 480 },
      }),
    );
    expect(j).toEqual({ status: "ok", expectedMin: 480, creditedMin: 480 });
  });
});

describe("mayReadPersonFigures (Issue #986)", () => {
  const other = "e-2";
  it("spares the reads a Salonmanager's permission set refuses", () => {
    const salonManager = { employeeId: "e-1", permissions: ["time-entry:read:ZUGEWIESEN"] };
    expect(mayReadPersonFigures(salonManager, "contract", other)).toBe(false);
    expect(mayReadPersonFigures(salonManager, "overtime", other)).toBe(false);
  });
  it("lets ZUGEWIESEN read anyone and EIGENE only the own person", () => {
    const owner = { employeeId: "e-1", permissions: ["overtime:read:ZUGEWIESEN"] };
    expect(mayReadPersonFigures(owner, "overtime", other)).toBe(true);
    const self = { employeeId: "e-1", permissions: ["contract:read:EIGENE"] };
    expect(mayReadPersonFigures(self, "contract", "e-1")).toBe(true);
    expect(mayReadPersonFigures(self, "contract", other)).toBe(false);
    expect(mayReadPersonFigures(null, "contract", other)).toBe(false);
  });
});

describe("teamDayRows with the account's Ist (Issue #986)", () => {
  it("a Berufsschule row shows ±0:00 against its Soll, not a minus", () => {
    const rows = teamDayRows({
      entries: [],
      vocationalSchoolDays: ["2026-11-03"],
      // Issue #1029: the row prints the server's day step; a credited Berufsschule day steps by 0.
      dayInfo: () => ({ expectedMin: 480, diffMin: 0, isToday: false, isFuture: false }),
      sollVisible: true,
      findingDays: new Set(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].times).toBe("Berufsschule");
    expect(rows[0].diff).toEqual({ label: "±0:00", tone: "neutral" });
  });
});

// Issue #986 meets #987: „no readable Soll → no Soll status“ must not hide a day the server names
// missing (`resolveDayStatus`, no Soll judgement). The page lays the server's set over the judged
// days, so the server mark is applied last.
describe("server-named missing days survive an unread Soll (Issue #986 + #987)", () => {
  it("applies the server's missing set after the per-day judgement", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(
      resolve(__dirname, "../../../routes/(app)/team/time-entries/+page.svelte"),
      "utf8",
    );
    expect(page).toMatch(/calendarDays = applyServerMissing\(\s*buildCalendarDays\(/);
    const fn = page.slice(page.indexOf("function applyServerMissing("));
    expect(fn.slice(0, 600)).toContain("missing.has(d.dateStr)");
    expect(fn.slice(0, 600)).toContain('status: "missing"');
  });
});
