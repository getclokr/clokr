/**
 * Issue #1076 — §§ 13, 14, 15 (with § 16 Abs. 3 and 4) and 17 JArbSchG for a roster shift of a person
 * who is under 18 on the shift date. Pure cases on week literals, no database; "now" never appears,
 * so nothing here can expire.
 *
 * Week under test: Monday 2026-11-16 .. Sunday 2026-11-22. Day index -1 is the Sunday before
 * (15.11.), day index 7 the Monday after (23.11.).
 *
 * Synthetic data only.
 */
import { describe, it, expect } from "vitest";
import {
  findMinorShiftLimitViolation,
  findStoredMinorWeekViolations,
  minorShiftLimitLabel,
  minorWeekHorizon,
  type MinorShiftWeek,
  type ShiftDraft,
} from "../minor-shift-limits";
import {
  buildShiftWriteContext,
  checkShiftWrite,
  type ShiftWriteContext,
} from "../shift-write-checks";

const MON = "2026-11-16";
const dayIso = (n: number): string => {
  const d = new Date(`${MON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => dayIso(i));

const SIXTEEN = "2010-05-01";
const SEVENTEEN = "2009-05-01";

type Spec = [day: number, start: string, end: string, id?: string];

function draftOf(day: number, start: string, end: string): ShiftDraft {
  return { date: new Date(`${dayIso(day)}T00:00:00Z`), startTime: start, endTime: end };
}

function mkWeek(o: {
  birth: string | null;
  shifts?: Spec[];
  credit?: Record<number, number>;
  weekStart?: number;
}): MinorShiftWeek {
  const offset = o.weekStart ?? 0;
  const dayOf = (n: number) => dayIso(offset + n);
  const credits: Record<string, number> = {};
  for (const [n, minutes] of Object.entries(o.credit ?? {})) credits[dayOf(Number(n))] = minutes;
  const birthDate = o.birth ? new Date(`${o.birth}T00:00:00Z`) : null;
  return {
    employeeId: "emp-pure",
    weekDays: Array.from({ length: 7 }, (_, i) => dayOf(i)),
    birthDate: birthDate as Date,
    breakEmployee: { breakOver6hOverride: null, breakOver9hOverride: null, birthDate },
    breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    creditedMinutesByDate: credits,
    shifts: (o.shifts ?? []).map(([day, start, end, id], i) => ({
      ...draftOf(day, start, end),
      id: id ?? `s${i}`,
    })),
  };
}

const check = (week: MinorShiftWeek, add: ShiftDraft, removeShiftId?: string) =>
  findMinorShiftLimitViolation(week, { add: [add], removeShiftId });

describe("minorWeekHorizon", () => {
  it("is the Sunday before, Monday..Sunday and the Monday after", () => {
    const h = minorWeekHorizon({ weekDays: WEEK_DAYS });
    expect(h).toHaveLength(9);
    expect(h[0]).toBe("2026-11-15");
    expect(h[1]).toBe(MON);
    expect(h[7]).toBe("2026-11-22");
    expect(h[8]).toBe("2026-11-23");
  });
});

describe("§ 14 Abs. 1 JArbSchG — Nachtruhe 06:00-20:00 (Issue #1076)", () => {
  for (const [label, birth] of [
    ["16-year-old", SIXTEEN],
    ["17-year-old", SEVENTEEN],
  ] as const) {
    it(`${label}: 12:00-20:01 is refused, 12:00-20:00 and 06:00-14:00 are accepted`, () => {
      const week = mkWeek({ birth });
      const v = check(week, draftOf(2, "12:00", "20:01"));
      expect(v?.code).toBe("JARBSCHG_VIOLATION_NIGHT_REST");
      expect(v?.dateIso).toBe(dayIso(2));
      expect(v?.message).toContain("18.11.2026");
      expect(v?.message).toContain("12:00 bis 20:01 Uhr");
      expect(v?.message).toContain("6 bis 20 Uhr");
      expect(v?.message).toContain("§ 14");
      expect(check(week, draftOf(2, "12:00", "20:00"))).toBeNull();
      expect(check(week, draftOf(2, "06:00", "14:00"))).toBeNull();
    });
  }

  it("05:59-10:00 is refused (one minute early)", () => {
    const v = check(mkWeek({ birth: SIXTEEN }), draftOf(1, "05:59", "10:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_NIGHT_REST");
  });

  it("a midnight-crossing shift 18:00-02:00 is refused and names both clock times", () => {
    const v = check(mkWeek({ birth: SIXTEEN }), draftOf(1, "18:00", "02:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_NIGHT_REST");
    expect(v?.message).toContain("18:00 bis 02:00");
  });

  it("the 18th birthday on the shift day: the same shift is accepted", () => {
    // 18th birthday on Thursday 19.11.2026
    const week = mkWeek({ birth: "2008-11-19" });
    expect(check(week, draftOf(3, "12:00", "20:30"))).toBeNull();
    // the day before (a minor) is still refused
    expect(check(week, draftOf(2, "12:00", "20:30"))?.code).toBe("JARBSCHG_VIOLATION_NIGHT_REST");
  });

  it("adults and persons without a birth date are unchanged", () => {
    for (const birth of ["2008-11-16", null]) {
      expect(check(mkWeek({ birth }), draftOf(2, "12:00", "22:00"))).toBeNull();
    }
  });
});

describe("§ 17 Abs. 1 JArbSchG — Sonntagsruhe (Issue #1076)", () => {
  for (const [label, birth] of [
    ["16-year-old", SIXTEEN],
    ["17-year-old", SEVENTEEN],
  ] as const) {
    it(`${label}: a Sunday shift is refused, a Saturday shift is not`, () => {
      const week = mkWeek({ birth });
      const v = check(week, draftOf(6, "10:00", "14:00"));
      expect(v?.code).toBe("JARBSCHG_VIOLATION_SUNDAY_REST");
      expect(v?.dateIso).toBe("2026-11-22");
      expect(v?.message).toContain("Sonntag");
      expect(v?.message).toContain("22.11.2026");
      expect(v?.message).toContain("§ 17");
      expect(check(week, draftOf(5, "10:00", "14:00"))).toBeNull();
    });
  }

  it("the 18th birthday on that Sunday: accepted", () => {
    expect(check(mkWeek({ birth: "2008-11-22" }), draftOf(6, "10:00", "14:00"))).toBeNull();
  });
});

describe("§ 13 JArbSchG — 12 hours Freizeit (Issue #1076)", () => {
  it("stored Tuesday 12:00-20:00, Wednesday 07:30-12:00: FREE_TIME dated Wednesday", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[1, "12:00", "20:00"]] });
    const v = check(week, draftOf(2, "07:30", "12:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v?.dateIso).toBe(dayIso(2));
    expect(v?.message).toContain("17.11.2026");
    expect(v?.message).toContain("18.11.2026");
    expect(v?.message).toContain("11:30 Stunden");
    expect(v?.message).toContain("12 Stunden");
    expect(v?.message).toContain("§ 13");
  });

  it("exactly 12:00 is accepted", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[1, "12:00", "20:00"]] });
    expect(check(week, draftOf(2, "08:00", "12:00"))).toBeNull();
  });

  it("works in the reverse direction: the draft is the EARLIER day", () => {
    const week = mkWeek({ birth: SEVENTEEN, shifts: [[4, "07:00", "12:00"]] });
    const v = check(week, draftOf(3, "12:00", "20:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v?.dateIso).toBe(dayIso(4));
  });

  it("the 18th birthday on the later day: § 13 does not apply (§ 5 ArbZG answers instead)", () => {
    // 18th birthday on Wednesday 18.11.2026
    const week = mkWeek({ birth: "2008-11-18", shifts: [[1, "12:00", "20:00"]] });
    expect(check(week, draftOf(2, "07:00", "12:00"))).toBeNull();
  });

  it("a midnight-crossing end counts past 24:00", () => {
    // Tuesday 12:00-20:00 is fine; Tuesday 18:00-06:00 would be NIGHT_REST. Use 14:00-20:00 +
    // a Wednesday start of 05:00 for the gap only (the night rule fires first for 05:00).
    const week = mkWeek({ birth: SIXTEEN, shifts: [[1, "06:00", "20:00"]] });
    const v = check(week, draftOf(2, "06:00", "10:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v?.message).toContain("10:00 Stunden");
  });

  it("horizon: the Sunday before the week and the Monday draft", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[-1, "12:00", "20:00"]] });
    const v = check(week, draftOf(0, "07:00", "12:00"));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v?.dateIso).toBe(MON);
    expect(v?.message).toContain("15.11.2026");
  });

  it("horizon: the write check sees the pair Sunday -> next Monday, dated the next Monday", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      shifts: [
        [6, "10:00", "18:00", "sun"],
        [7, "07:00", "12:00", "mon"],
      ],
    });
    // same gross, so no SUNDAY_REST enlargement; the end moves from 18:00 to 20:00
    const v = check(week, draftOf(6, "12:00", "20:00"), "sun");
    expect(v?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v?.dateIso).toBe("2026-11-23");
  });
});

describe("create or enlarge (LD-9)", () => {
  it("night minutes: only an enlargement is refused", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[1, "12:00", "21:00", "x"]] });
    expect(check(week, draftOf(1, "12:00", "20:30"), "x")).toBeNull();
    expect(check(week, draftOf(1, "12:00", "21:30"), "x")?.code).toBe(
      "JARBSCHG_VIOLATION_NIGHT_REST",
    );
    expect(check(week, draftOf(1, "12:00", "21:00"), "x")).toBeNull();
  });

  it("Sunday minutes: only an enlargement is refused", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[6, "10:00", "16:00", "x"]] });
    expect(check(week, draftOf(6, "10:00", "15:00"), "x")).toBeNull();
    expect(check(week, draftOf(6, "10:00", "17:00"), "x")?.code).toBe(
      "JARBSCHG_VIOLATION_SUNDAY_REST",
    );
  });

  it("Freizeit gap: widening a short gap is accepted, shrinking it is refused", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      shifts: [
        [1, "10:00", "20:00", "a"],
        [2, "08:00", "12:00", "b"],
      ],
    }); // gap 12:00 exactly? 1440 + 480 - 1200 = 720 -> make it short below
    const short = mkWeek({
      birth: SIXTEEN,
      shifts: [
        [1, "10:00", "20:00", "a"],
        [2, "06:00", "12:00", "b"],
      ],
    }); // gap 10:00
    expect(check(short, draftOf(2, "07:00", "12:00"), "b")).toBeNull(); // 11:00, wider
    expect(check(short, draftOf(2, "06:00", "12:00"), "b")).toBeNull(); // identical
    expect(check(week, draftOf(2, "07:59", "12:00"), "b")?.code).toBe(
      "JARBSCHG_VIOLATION_FREE_TIME",
    ); // 11:59 < 12:00 from 12:00
  });
});

describe("stored listing (Issue #1074 parity)", () => {
  it("lists the codes per day in the fixed order and includes previous Sunday -> Monday", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      shifts: [
        [-1, "12:00", "20:00"], // previous Sunday (belongs to the previous week's plan)
        [0, "07:00", "12:00"], // Monday: gap 11:00 to the Sunday
        [6, "10:00", "14:00"], // Sunday
        [7, "07:00", "12:00"], // Monday after: pair Sunday -> next Monday is NOT listed here
      ],
    });
    const codes = findStoredMinorWeekViolations(week).map((v) => v.code);
    expect(codes).toEqual(["JARBSCHG_VIOLATION_FREE_TIME", "JARBSCHG_VIOLATION_SUNDAY_REST"]);
  });

  it("every new code reads the same as the write message for the same single shift", () => {
    const cases: Array<[Spec, MinorShiftWeek]> = [
      [[2, "12:00", "20:30"], mkWeek({ birth: SIXTEEN })],
      [[6, "10:00", "14:00"], mkWeek({ birth: SIXTEEN })],
      [[2, "07:30", "12:00"], mkWeek({ birth: SIXTEEN, shifts: [[1, "12:00", "20:00"]] })],
    ];
    for (const [[d, s, e], week] of cases) {
      const written = check(week, draftOf(d, s, e))!;
      const stored = findStoredMinorWeekViolations({
        ...week,
        shifts: [...week.shifts, { ...draftOf(d, s, e), id: "new" }],
      });
      expect(stored.find((v) => v.code === written.code)?.message).toBe(written.message);
    }
  });

  it("labels", () => {
    const labelOf = (code: Parameters<typeof minorShiftLimitLabel>[0]["code"]) =>
      minorShiftLimitLabel({ code, dateIso: "2026-11-22", message: "" });
    expect(labelOf("JARBSCHG_VIOLATION_NIGHT_REST")).toBe("22.11.2026 (Nachtruhe)");
    expect(labelOf("JARBSCHG_VIOLATION_SUNDAY_REST")).toBe("22.11.2026 (Sonntagsruhe)");
    expect(labelOf("JARBSCHG_VIOLATION_FREE_TIME")).toBe("22.11.2026 (Freizeit)");
    expect(labelOf("JARBSCHG_VIOLATION_DAILY_MAX")).toBe("22.11.2026 (Arbeitszeit)");
    expect(labelOf("JARBSCHG_VIOLATION_SHIFT_TIME")).toBe("22.11.2026 (Schichtzeit)");
    expect(labelOf("JARBSCHG_VIOLATION_WEEKLY_MAX")).toBe("Wochenarbeitszeit");
  });
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────

const EMP = "emp-gate";
const GATE_TODAY = "2026-11-02";

function gateCtx(weeks: MinorShiftWeek[], birth: string): ShiftWriteContext {
  const stored = new Map<string, MinorShiftWeek>();
  for (const w of weeks) stored.set(`${EMP}::${w.weekDays[0]}`, w);
  return buildShiftWriteContext({
    tz: "Europe/Berlin",
    todayIso: GATE_TODAY,
    tenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45, shiftStoreHoursMode: "OFF" },
    employees: [
      {
        id: EMP,
        birthDate: new Date(`${birth}T00:00:00Z`),
        breakOver6hOverride: null,
        breakOver9hOverride: null,
      },
    ],
    earliestContractStart: new Map([[EMP, new Date("2024-01-01T00:00:00Z")]]),
    shifts: weeks.flatMap((w) =>
      w.shifts.map((s) => ({
        id: s.id,
        employeeId: EMP,
        dateIso: s.date.toISOString().slice(0, 10),
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    ),
    minorWeeks: stored,
  });
}

const gateRun = (
  ctx: ShiftWriteContext,
  dateIso: string,
  start: string,
  end: string,
  o: { force?: boolean; replaces?: { id: string; dateIso: string } } = {},
) =>
  checkShiftWrite(
    ctx,
    { draft: { employeeId: EMP, dateIso, startTime: start, endTime: end }, replaces: o.replaces },
    { force: o.force ?? false },
  );

describe("checkShiftWrite — rule 4 answers the §§ 13-17 codes (Issue #1076)", () => {
  it("a minor's Sunday draft: minorLimits SUNDAY_REST, 422, not overridable, also with force", () => {
    const ctx = gateCtx([mkWeek({ birth: SIXTEEN })], SIXTEEN);
    for (const force of [false, true]) {
      const v = gateRun(ctx, "2026-11-22", "10:00", "14:00", { force });
      expect(v.blocking?.rule).toBe("minorLimits");
      expect(v.blocking?.code).toBe("JARBSCHG_VIOLATION_SUNDAY_REST");
      expect(v.blocking?.status).toBe(422);
      expect(v.blocking?.overridable).toBe(false);
    }
  });

  it("a 10:00 gap answers § 13 (422) and not the forceable § 5 ArbZG (409)", () => {
    const week = mkWeek({ birth: SIXTEEN, shifts: [[1, "10:00", "20:00"]] });
    const v = gateRun(gateCtx([week], SIXTEEN), "2026-11-18", "06:00", "10:00");
    expect(v.blocking?.rule).toBe("minorLimits");
    expect(v.blocking?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(v.blocking?.status).toBe(422);
  });

  it("horizon join: a draft joins the next minor week, so a later change of the batch sees it", () => {
    const sundayStored: Spec = [6, "10:00", "18:00", "leg"];
    const w1 = mkWeek({ birth: SIXTEEN, shifts: [sundayStored] });
    // week 23.-29.11. carries the stored Sunday 22.11. in its horizon (day -1 of that week)
    const w2 = mkWeek({ birth: SIXTEEN, weekStart: 7, shifts: [] });
    w2.shifts.push({ ...draftOf(6, "10:00", "18:00"), id: "leg" });
    const ctx = gateCtx([w1, w2], SIXTEEN);

    // first change replaces the legacy Sunday by 12:00-20:00 (same gross, accepted)
    const first = gateRun(ctx, "2026-11-22", "12:00", "20:00", {
      replaces: { id: "leg", dateIso: "2026-11-22" },
    });
    expect(first.blocking).toBeNull();
    // second change: Monday 07:00-12:00 now sits only 11:00 after the new Sunday end
    const second = gateRun(ctx, "2026-11-23", "07:00", "12:00");
    expect(second.blocking?.code).toBe("JARBSCHG_VIOLATION_FREE_TIME");
    expect(second.blocking?.dateIso).toBe("2026-11-23");
  });
});
