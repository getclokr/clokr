/**
 * Issue #1075 — the pure cases of `checkShiftWrite`, the one gate of every adding roster write path.
 * Context literals only, no database; "now" is part of the literal, so nothing here can expire.
 *
 * Synthetic data only.
 */
import { describe, it, expect } from "vitest";
import {
  SHIFT_PAST_MESSAGE,
  SHIFT_WRITE_RULES,
  SHIFT_WRITE_SKIP_REASON,
  buildShiftWriteContext,
  checkShiftWrite,
  isPastShiftDay,
  shiftWriteReplyBody,
  type ShiftWriteContext,
  type ShiftWriteDraft,
} from "../shift-write-checks";
import type { MinorShiftWeek } from "../minor-shift-limits";

const TODAY = "2027-03-10"; // a Wednesday
const D = "2027-03-12"; // a Friday, two days ahead
const DAY_BEFORE = "2027-03-11";
const DAY_AFTER = "2027-03-13";
const SUNDAY = "2027-03-14";
const MONDAY_OF_D = "2027-03-08";
const EMP = "emp-a";

const HOURS = [
  ...[0, 1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "20:00" })),
  { day: 6, open: "08:00", close: "20:00", closed: true },
];

type StoredSpec = { id: string; dateIso: string; startTime: string; endTime: string };

function mkCtx(
  o: {
    stored?: StoredSpec[];
    mode?: string | null;
    config?: "none" | "default";
    contractFrom?: string | null;
    breakOver9hOverride?: number | null;
    minorWeek?: MinorShiftWeek;
    birth?: string | null;
    exitDate?: Date | null;
  } = {},
): ShiftWriteContext {
  const contractFrom = o.contractFrom === undefined ? "2024-01-01" : o.contractFrom;
  return buildShiftWriteContext({
    tz: "Europe/Berlin",
    todayIso: TODAY,
    tenantConfig:
      o.config === "none"
        ? null
        : {
            defaultBreakOver6h: 30,
            defaultBreakOver9h: 45,
            shiftStoreHoursMode: o.mode === undefined ? "DAY_ONLY" : o.mode,
          },
    employees: [
      {
        id: EMP,
        birthDate: o.birth ? new Date(`${o.birth}T00:00:00Z`) : null,
        breakOver6hOverride: null,
        breakOver9hOverride: o.breakOver9hOverride ?? null,
        exitDate: o.exitDate ?? null,
      },
    ],
    earliestContractStart: new Map(
      contractFrom ? [[EMP, new Date(`${contractFrom}T00:00:00Z`)]] : [],
    ),
    shifts: (o.stored ?? []).map((s) => ({ ...s, employeeId: EMP })),
    minorWeeks: o.minorWeek ? new Map([[`${EMP}::${MONDAY_OF_D}`, o.minorWeek]]) : new Map(),
  });
}

function draft(dateIso: string, startTime: string, endTime: string): ShiftWriteDraft {
  return { employeeId: EMP, dateIso, startTime, endTime, openingHours: HOURS };
}

const run = (
  ctx: ShiftWriteContext,
  d: ShiftWriteDraft,
  o: { force?: boolean; replaces?: { id: string; dateIso: string } } = {},
) => checkShiftWrite(ctx, { draft: d, replaces: o.replaces }, { force: o.force ?? false });

describe("checkShiftWrite — rule order and shape", () => {
  it("names the six rules in the order the gate runs them", () => {
    expect([...SHIFT_WRITE_RULES]).toEqual([
      "contract",
      "pastDay",
      "openingHours",
      "minorLimits",
      "dailyMax",
      "restPeriod",
    ]);
    expect(SHIFT_WRITE_SKIP_REASON).toEqual({
      contract: "no-contract",
      pastDay: "past",
      openingHours: "outside-store-hours",
      minorLimits: "jarbschg",
      dailyMax: "arbzg-daily-max",
      restPeriod: "arbzg-rest-period",
    });
  });

  it("a plain shift passes with nothing forced", () => {
    expect(run(mkCtx(), draft(D, "08:00", "16:00"))).toEqual({ blocking: null, forced: [] });
  });

  it("an employee that is not in the context throws (fail-closed)", () => {
    expect(() =>
      checkShiftWrite(
        mkCtx(),
        { draft: { ...draft(D, "08:00", "16:00"), employeeId: "stranger" } },
        { force: false },
      ),
    ).toThrow(/not in the context/);
  });
});

describe("contract (GD-7)", () => {
  it("a contract that starts after the day is SHIFT_NO_CONTRACT, 422, not overridable", () => {
    const v = run(mkCtx({ contractFrom: "2027-03-13" }), draft(D, "08:00", "16:00"), {
      force: true,
    });
    expect(v.blocking).toMatchObject({
      rule: "contract",
      code: "SHIFT_NO_CONTRACT",
      status: 422,
      overridable: false,
    });
  });

  it("a contract that starts on the draft day itself is fine; no contract row at all is not", () => {
    expect(run(mkCtx({ contractFrom: D }), draft(D, "08:00", "16:00")).blocking).toBeNull();
    expect(run(mkCtx({ contractFrom: null }), draft(D, "08:00", "16:00")).blocking?.code).toBe(
      "SHIFT_NO_CONTRACT",
    );
  });
});

describe("past day (GD-6)", () => {
  it("yesterday is refused, today is plannable, force changes nothing", () => {
    expect(isPastShiftDay(TODAY, "2027-03-09")).toBe(true);
    expect(isPastShiftDay(TODAY, TODAY)).toBe(false);
    const past = run(mkCtx(), draft("2027-03-09", "08:00", "16:00"), { force: true });
    expect(past.blocking).toMatchObject({
      rule: "pastDay",
      code: "SHIFT_PAST_IMMUTABLE",
      message: SHIFT_PAST_MESSAGE,
      status: 422,
    });
    expect(run(mkCtx(), draft(TODAY, "08:00", "16:00")).blocking).toBeNull();
  });

  it("a replaced shift on a past day blocks a move to the future", () => {
    const v = run(mkCtx(), draft("2027-03-12", "08:00", "16:00"), {
      replaces: { id: "old", dateIso: "2027-03-09" },
    });
    expect(v.blocking?.code).toBe("SHIFT_PAST_IMMUTABLE");
  });
});

describe("opening hours", () => {
  it("a Sunday is a 409, overridable; force moves it to `forced` and the walk goes on", () => {
    const blocked = run(mkCtx(), draft(SUNDAY, "08:00", "16:00"));
    expect(blocked.blocking).toMatchObject({
      rule: "openingHours",
      code: "SHIFT_OUTSIDE_STORE_HOURS",
      status: 409,
      overridable: true,
    });
    expect(blocked.blocking?.message).toContain("geschlossen");
    const forced = run(mkCtx(), draft(SUNDAY, "08:00", "16:00"), { force: true });
    expect(forced.blocking).toBeNull();
    expect(forced.forced.map((f) => f.rule)).toEqual(["openingHours"]);
  });

  it("mode OFF, missing hours and a missing TenantConfig row check nothing", () => {
    expect(run(mkCtx({ mode: "OFF" }), draft(SUNDAY, "08:00", "16:00")).blocking).toBeNull();
    expect(
      run(mkCtx(), { ...draft(SUNDAY, "08:00", "16:00"), openingHours: null }).blocking,
    ).toBeNull();
    expect(run(mkCtx({ config: "none" }), draft(SUNDAY, "08:00", "16:00")).blocking).toBeNull();
  });

  it("STRICT compares the times with the day's window and keeps the old message", () => {
    const v = run(mkCtx({ mode: "STRICT" }), draft(D, "07:00", "15:00"));
    expect(v.blocking?.message).toBe(
      "Schicht 07:00–15:00 außerhalb der Öffnungszeiten (08:00–20:00).",
    );
  });
});

describe("§ 3 ArbZG — the day sum (GD-3)", () => {
  it("10:00 net is legal, 10:15 is not and the message names the day and the hours", () => {
    expect(run(mkCtx(), draft(D, "08:00", "18:30")).blocking).toBeNull(); // 630 - 45 = 585
    const v = run(mkCtx(), draft(D, "07:30", "18:30")); // 660 - 45 = 615
    expect(v.blocking).toMatchObject({
      rule: "dailyMax",
      code: "ARBZG_VIOLATION_DAILY_MAX",
      status: 422,
      overridable: false,
    });
    expect(v.blocking?.message).toContain("12.03.2027");
    expect(v.blocking?.message).toContain("10:15");
    expect(v.blocking?.message).toContain("§ 3 ArbZG");
  });

  it("the shifts of one day count together", () => {
    const ctx = mkCtx({ stored: [{ id: "s1", dateIso: D, startTime: "08:00", endTime: "13:00" }] });
    const v = run(ctx, draft(D, "13:30", "19:30")); // 300 + 360 = 660
    expect(v.blocking?.code).toBe("ARBZG_VIOLATION_DAILY_MAX");
  });

  it("an employee break override is honoured; a cross-midnight shift counts; a zero-length shift is 0", () => {
    expect(run(mkCtx({ breakOver9hOverride: 60 }), draft(D, "07:30", "18:30")).blocking).toBeNull(); // 660 - 60 = 600
    expect(run(mkCtx(), draft(D, "20:00", "07:00")).blocking?.code).toBe(
      "ARBZG_VIOLATION_DAILY_MAX",
    ); // 660 - 45 = 615
    expect(run(mkCtx(), draft(D, "08:00", "08:00")).blocking).toBeNull();
  });

  it("force changes nothing for § 3", () => {
    const v = run(mkCtx(), draft(D, "07:30", "18:30"), { force: true });
    expect(v.blocking?.code).toBe("ARBZG_VIOLATION_DAILY_MAX");
  });
});

describe("§ 3 ArbZG — only what gets worse (GD-5)", () => {
  const legacy = { id: "legacy", dateIso: D, startTime: "07:00", endTime: "18:30" }; // 645
  const replaces = { id: "legacy", dateIso: D };

  it("a label-only edit and a shortening of an illegal legacy shift pass, a lengthening does not", () => {
    const ctx = () => mkCtx({ stored: [legacy] });
    expect(run(ctx(), draft(D, "07:00", "18:30"), { replaces }).blocking).toBeNull();
    expect(run(ctx(), draft(D, "07:00", "18:00"), { replaces }).blocking).toBeNull();
    expect(run(ctx(), draft(D, "07:00", "19:00"), { replaces }).blocking?.code).toBe(
      "ARBZG_VIOLATION_DAILY_MAX",
    );
  });

  it("moving the legacy shift onto a day that holds another shift is a violation", () => {
    const other = { id: "other", dateIso: "2027-03-15", startTime: "08:00", endTime: "16:00" };
    const ctx = mkCtx({ stored: [legacy, other] });
    const v = run(ctx, draft("2027-03-15", "07:00", "18:30"), { replaces });
    expect(v.blocking?.code).toBe("ARBZG_VIOLATION_DAILY_MAX");
  });
});

describe("§ 5 ArbZG — both directions (GD-4)", () => {
  it("backward: the message is the old one, the gap is on `restGaps`", () => {
    const ctx = mkCtx({
      stored: [{ id: "prev", dateIso: DAY_BEFORE, startTime: "14:00", endTime: "23:00" }],
    });
    const v = run(ctx, draft(D, "08:00", "16:00"));
    expect(v.blocking).toMatchObject({ rule: "restPeriod", status: 409, overridable: true });
    expect(v.blocking?.message).toBe(
      "Verstoß gegen § 5 ArbZG: zwischen Schichtende am 11.03.2027 und neuem Beginn liegen nur 9.0h (mindestens 11h erforderlich).",
    );
    expect(v.blocking?.restGaps).toEqual([
      { direction: "previous", otherShiftId: "prev", restHours: 9 },
    ]);
  });

  it("exactly 11 h is legal; a cross-midnight shift of the day before ends on the day", () => {
    const eleven = mkCtx({
      stored: [{ id: "prev", dateIso: DAY_BEFORE, startTime: "13:00", endTime: "21:00" }],
    });
    expect(run(eleven, draft(D, "08:00", "16:00")).blocking).toBeNull();
    const overnight = mkCtx({
      stored: [{ id: "prev", dateIso: DAY_BEFORE, startTime: "22:00", endTime: "02:00" }],
    });
    const v = run(overnight, draft(D, "12:00", "16:00"));
    expect(v.blocking?.restGaps?.[0].restHours).toBe(10);
  });

  it("forward: a shift in front of an already planned next-day shift", () => {
    const ctx = mkCtx({
      stored: [{ id: "next", dateIso: DAY_AFTER, startTime: "06:00", endTime: "14:00" }],
    });
    const v = run(ctx, draft(D, "14:00", "22:00"));
    expect(v.blocking?.code).toBe("ARBZG_VIOLATION_REST_PERIOD");
    expect(v.blocking?.message).toBe(
      "Verstoß gegen § 5 ArbZG: zwischen neuem Schichtende und dem Schichtbeginn am 13.03.2027 liegen nur 8.0h (mindestens 11h erforderlich).",
    );
    expect(v.blocking?.restGaps).toEqual([
      { direction: "next", otherShiftId: "next", restHours: 8 },
    ]);
  });

  it("both directions short: two gaps, worst first, the message from the worst", () => {
    const ctx = mkCtx({
      stored: [
        { id: "prev", dateIso: DAY_BEFORE, startTime: "14:00", endTime: "23:00" }, // 9 h to 08:00
        { id: "next", dateIso: DAY_AFTER, startTime: "02:00", endTime: "10:00" }, // 7.5 h from 18:30
      ],
    });
    const v = run(ctx, draft(D, "08:00", "18:30"));
    expect(v.blocking?.restGaps?.map((g) => g.direction)).toEqual(["next", "previous"]);
    expect(v.blocking?.message).toContain("neuem Schichtende");
  });

  it("force moves the finding to `forced`, keeping every direction", () => {
    const ctx = mkCtx({
      stored: [{ id: "next", dateIso: DAY_AFTER, startTime: "06:00", endTime: "14:00" }],
    });
    const v = run(ctx, draft(D, "14:00", "22:00"), { force: true });
    expect(v.blocking).toBeNull();
    expect(v.forced[0].restGaps).toHaveLength(1);
  });

  it("only what gets worse: identical times and a shortening pass, a lengthening does not", () => {
    const stored = [
      { id: "mine", dateIso: D, startTime: "14:00", endTime: "22:00" },
      { id: "next", dateIso: DAY_AFTER, startTime: "06:00", endTime: "14:00" },
    ];
    const replaces = { id: "mine", dateIso: D };
    expect(run(mkCtx({ stored }), draft(D, "14:00", "22:00"), { replaces }).blocking).toBeNull();
    expect(run(mkCtx({ stored }), draft(D, "14:00", "21:00"), { replaces }).blocking).toBeNull();
    expect(run(mkCtx({ stored }), draft(D, "14:00", "23:00"), { replaces }).blocking?.code).toBe(
      "ARBZG_VIOLATION_REST_PERIOD",
    );
  });
});

describe("order", () => {
  it("past wins over a closed day, no contract wins over past", () => {
    expect(run(mkCtx(), draft("2027-03-07", "08:00", "16:00")).blocking?.code).toBe(
      "SHIFT_PAST_IMMUTABLE",
    );
    expect(
      run(mkCtx({ contractFrom: "2028-01-01" }), draft("2027-03-07", "08:00", "16:00")).blocking
        ?.code,
    ).toBe("SHIFT_NO_CONTRACT");
  });

  it("a minor's week answers with its JArbSchG code before § 3", () => {
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${MONDAY_OF_D}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const birthDate = new Date("2010-05-01T00:00:00Z");
    const minorWeek: MinorShiftWeek = {
      employeeId: EMP,
      weekDays,
      birthDate,
      breakEmployee: { breakOver6hOverride: null, breakOver9hOverride: null, birthDate },
      breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
      creditedMinutesByDate: {},
      schoolDays: [],
      shifts: [],
    };
    const v = run(mkCtx({ minorWeek, birth: "2010-05-01" }), draft(D, "07:30", "18:30"));
    expect(v.blocking?.rule).toBe("minorLimits");
    expect(v.blocking?.code).toMatch(/^JARBSCHG_/);
  });
});

describe("a batch: accepted changes join the context", () => {
  it("the second draft of a day sees the first; a rejected draft does not join", () => {
    const ctx = mkCtx();
    expect(run(ctx, draft(D, "08:00", "13:00")).blocking).toBeNull();
    expect(run(ctx, draft(D, "13:30", "19:30")).blocking?.code).toBe("ARBZG_VIOLATION_DAILY_MAX");
    // the rejected 13:30-19:30 did not join: 300 + 45 = 345 is fine
    expect(run(ctx, draft(D, "19:45", "20:30")).blocking).toBeNull();
  });
});

describe("shiftWriteReplyBody", () => {
  const titles = { contract: "Titel-Vertrag", past: "Titel-Vergangenheit" };

  it("keeps the shapes the single write paths always answered", () => {
    const contract = run(mkCtx({ contractFrom: null }), draft(D, "08:00", "16:00")).blocking!;
    expect(shiftWriteReplyBody(contract, titles)).toEqual({
      error: "Titel-Vertrag",
      code: "SHIFT_NO_CONTRACT",
      message: contract.message,
    });
    const past = run(mkCtx(), draft("2027-03-09", "08:00", "16:00")).blocking!;
    expect(shiftWriteReplyBody(past, titles)).toEqual({
      error: "Titel-Vergangenheit",
      code: "SHIFT_PAST_IMMUTABLE",
      message: SHIFT_PAST_MESSAGE,
    });
    const store = run(mkCtx(), draft(SUNDAY, "08:00", "16:00")).blocking!;
    expect(shiftWriteReplyBody(store, titles)).toEqual({
      error: "Schicht außerhalb Öffnungszeiten",
      code: "SHIFT_OUTSIDE_STORE_HOURS",
      message: store.message,
      canForce: true,
    });
    const daily = run(mkCtx(), draft(D, "07:30", "18:30")).blocking!;
    expect(shiftWriteReplyBody(daily, titles)).toEqual({
      error: "ArbZG-Verstoß",
      code: "ARBZG_VIOLATION_DAILY_MAX",
      message: daily.message,
      canForce: false,
    });
  });

  it("§ 5 is forceable by default and not on a collective path", () => {
    const rest = run(
      mkCtx({ stored: [{ id: "n", dateIso: DAY_AFTER, startTime: "06:00", endTime: "14:00" }] }),
      draft(D, "14:00", "22:00"),
    ).blocking!;
    expect(shiftWriteReplyBody(rest, titles)).toMatchObject({ canForce: true });
    expect(shiftWriteReplyBody(rest, titles, { canForce: false })).toMatchObject({
      canForce: false,
    });
  });
});
