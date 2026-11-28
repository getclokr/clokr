// Issue #850 — the three conflict buckets become one dated list of notices with one action each.
import { describe, it, expect } from "vitest";
import {
  buildShiftNotices,
  NOTICE_KINDS,
  noticeDay,
  restoreForceQuestion,
  type ConflictShift,
} from "../shift-notices";

const shift = (over: Partial<ConflictShift>): ConflictShift => ({
  id: "s1",
  date: "2026-11-10T00:00:00.000Z",
  startTime: "09:00",
  endTime: "17:00",
  label: null,
  employee: { firstName: "Mia", lastName: "Beispiel" },
  deletedAt: null,
  deletedReason: null,
  conflictsWithLeave: true,
  pastDay: false,
  monthLocked: false,
  ...over,
});

describe("shift notices (Issue #850)", () => {
  const notices = buildShiftNotices({
    softDeleted: [
      shift({
        id: "gone",
        date: "2026-11-12T00:00:00.000Z",
        deletedAt: "2026-11-01T10:00:00.000Z",
        deletedReason: "AUTO_BS_DAY_CLEANUP",
        conflictsWithLeave: false,
        label: "Früh",
      }),
    ],
    flagged: [shift({ id: "marked" })],
    weekOverbooked: [
      {
        employeeId: "e2",
        employeeName: "Timo Muster",
        weekStart: "2026-11-09",
        weekEnd: "2026-11-15",
        contractDays: 5,
        leaveDays: 1,
        otherAbsenceDays: 0,
        scheduledDays: 5,
        overbookedBy: 1,
      },
    ],
  });

  it("is one list sorted by day, every row with date, person, reason and action", () => {
    expect(notices.map((n) => n.kind)).toEqual(["week-overbooked", "marked", "removed"]);
    for (const n of notices) {
      expect(n.dateLabel).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(n.person.length).toBeGreaterThan(0);
      expect(n.reason.length).toBeGreaterThan(0);
      expect(n.action.label.length).toBeGreaterThan(0);
    }
  });

  it("a marked shift is kept, a removed one restored — both through the restore call", () => {
    const marked = notices.find((n) => n.kind === "marked")!;
    expect(marked.dateLabel).toBe("Di., 10. Nov.");
    expect(marked.action).toMatchObject({
      type: "restore",
      shiftId: "marked",
      label: "Schicht behalten",
    });
    const removed = notices.find((n) => n.kind === "removed")!;
    expect(removed.detail).toBe("09:00–17:00 · Früh");
    expect(removed.action).toMatchObject({
      type: "restore",
      shiftId: "gone",
      label: "Wiederherstellen",
    });
  });

  it("an overbooked week names its days in words and links to the Planungsbedarf", () => {
    const week = notices.find((n) => n.kind === "week-overbooked")!;
    expect(week.dateLabel).toBe("KW 46 · 9.–15. Nov.");
    expect(week.reason).toBe("5 Tage geplant, laut Vertrag 4 Tage möglich – 1 Tag zu viel.");
    expect(week.action).toEqual({
      type: "link",
      href: "/shifts/planning",
      label: "Zum Planungsbedarf",
    });
  });

  it("an empty response is an empty list", () => {
    expect(buildShiftNotices({ softDeleted: [], flagged: [], weekOverbooked: [] })).toEqual([]);
  });

  it("names the weekday", () => {
    expect(noticeDay("2026-11-09")).toBe("Mo., 9. Nov.");
  });
});

describe("restoreForceQuestion (Issue #1075)", () => {
  it("asks for a 409 that can be forced and carries the API message", () => {
    expect(
      restoreForceQuestion(409, {
        code: "ARBZG_VIOLATION_REST_PERIOD",
        message: "Verstoß gegen § 5 ArbZG: zwischen Schichtende am 11.03.2027 und neuem Beginn …",
        canForce: true,
      }),
    ).toBe("Verstoß gegen § 5 ArbZG: zwischen Schichtende am 11.03.2027 und neuem Beginn …");
  });

  it("falls back to a general question when the body has no message", () => {
    expect(restoreForceQuestion(409, { canForce: true })).toBe(
      "Die Schicht verstößt gegen eine Planungsregel.",
    );
  });

  it("is null for a 409 without an override, for a 422 and for any other status", () => {
    expect(restoreForceQuestion(409, { message: "x", canForce: false })).toBeNull();
    expect(restoreForceQuestion(409, { message: "x" })).toBeNull();
    expect(restoreForceQuestion(422, { message: "x", canForce: true })).toBeNull();
    expect(restoreForceQuestion(500, { canForce: true })).toBeNull();
    expect(restoreForceQuestion(409, undefined)).toBeNull();
    expect(restoreForceQuestion(409, null)).toBeNull();
  });
});

describe("a removed shift on a past day (Issue #1100)", () => {
  const removal = {
    deletedAt: "2026-11-01T10:00:00.000Z",
    deletedReason: "AUTO_BS_DAY_CLEANUP",
    conflictsWithLeave: false,
  };
  const notices = buildShiftNotices({
    softDeleted: [
      shift({ id: "past", date: "2026-11-09T00:00:00.000Z", pastDay: true, ...removal }),
      shift({ id: "today", date: "2026-11-10T00:00:00.000Z", pastDay: false, ...removal }),
    ],
    flagged: [shift({ id: "kept", date: "2026-11-09T00:00:00.000Z", pastDay: true })],
    weekOverbooked: [],
  });
  const byKey = (key: string) => notices.find((n) => n.key === key)!;

  it("offers no restore, only the reason, and keeps the removal reason", () => {
    const past = byKey("removed:past");
    expect(past.action).toEqual({
      type: "unavailable",
      label: "Vergangener Tag – nicht mehr änderbar.",
    });
    expect(past.reason).toBe("Wegen eines neuen Berufsschultags automatisch entfernt.");
    expect(notices.some((n) => n.action.type === "restore" && n.action.shiftId === "past")).toBe(
      false,
    );
  });

  it("keeps Wiederherstellen for a removed shift on the tenant's today", () => {
    expect(byKey("removed:today").action).toMatchObject({
      type: "restore",
      shiftId: "today",
      label: "Wiederherstellen",
    });
  });

  it("keeps Schicht behalten on a past marked shift (the flag-clearing restore runs no gate)", () => {
    expect(byKey("marked:kept").action).toMatchObject({
      type: "restore",
      shiftId: "kept",
      label: "Schicht behalten",
    });
  });

  it("explains the past-day limit", () => {
    expect(NOTICE_KINDS.removed.explanation).toContain(
      "An einem vergangenen Tag geht das nicht mehr.",
    );
  });
});

describe("a shift in a closed month (Issue #1145)", () => {
  const removal = {
    deletedAt: "2026-10-01T10:00:00.000Z",
    deletedReason: "AUTO_BS_DAY_CLEANUP",
    conflictsWithLeave: false,
  };
  const notices = buildShiftNotices({
    softDeleted: [
      shift({ id: "gone-closed", date: "2026-10-12T00:00:00.000Z", monthLocked: true, ...removal }),
    ],
    flagged: [
      shift({ id: "marked-closed", date: "2026-10-13T00:00:00.000Z", monthLocked: true }),
      shift({ id: "marked-open", date: "2026-11-13T00:00:00.000Z", monthLocked: false }),
    ],
    weekOverbooked: [],
  });
  const byKey = (key: string) => notices.find((n) => n.key === key)!;
  const closed = { type: "unavailable", label: "Monat abgeschlossen – nicht mehr änderbar." };

  it("offers no Schicht behalten, only the reason", () => {
    expect(byKey("marked:marked-closed").action).toEqual(closed);
    expect(byKey("marked:marked-closed").reason).toBe(
      "Überschneidet sich mit Urlaub oder Berufsschule.",
    );
  });

  it("offers no Wiederherstellen either, the restore handler refuses the closed month first", () => {
    expect(byKey("removed:gone-closed").action).toEqual(closed);
  });

  it("explains the closed-month limit for both kinds", () => {
    expect(NOTICE_KINDS.removed.explanation).toContain(
      "In einem abgeschlossenen Monat auch nicht.",
    );
    expect(NOTICE_KINDS.marked.explanation).toContain("abgeschlossenen Monat");
  });

  it("keeps Schicht behalten in an open month", () => {
    expect(byKey("marked:marked-open").action).toMatchObject({
      type: "restore",
      shiftId: "marked-open",
      label: "Schicht behalten",
    });
  });

  it("names the closed month before a past day when both apply", () => {
    const [n] = buildShiftNotices({
      softDeleted: [shift({ id: "both", pastDay: true, monthLocked: true, ...removal })],
      flagged: [],
      weekOverbooked: [],
    });
    expect(n.action).toEqual(closed);
  });
});
