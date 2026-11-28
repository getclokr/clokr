/**
 * Issue #1106 — § 18 Abs. 1 JArbSchG (Feiertagsruhe) for a roster shift of a person who is under 18
 * on the shift date: no shift on a statutory holiday of the SHIFT'S salon, no shift minute after
 * 14:00 on 24 and 31 December. Pure cases on week literals, no database; "now" never appears, so
 * nothing here can expire.
 *
 * Week under test: Monday 2026-11-16 .. Sunday 2026-11-22; Wednesday 18.11.2026 is "Buß- und Bettag"
 * in salon-sn only. The December cases use the weeks starting 2027-12-20 and 2027-12-27.
 *
 * Synthetic data only.
 */
import { describe, it, expect } from "vitest";
import {
  findMinorShiftLimitViolation,
  findStoredMinorWeekViolations,
  minorShiftLimitLabel,
  type MinorShiftWeek,
  type ShiftDraft,
} from "../minor-shift-limits";
import {
  buildShiftWriteContext,
  checkShiftWrite,
  shiftWriteReplyBody,
} from "../shift-write-checks";

const MON = "2026-11-16";
const dayIso = (n: number): string => {
  const d = new Date(`${MON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Day offset of an ISO date from MON, so a December week can be addressed like the November one. */
const offsetOf = (iso: string): number =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${MON}T00:00:00Z`)) / 86_400_000);

const SIXTEEN = "2010-05-01";
const SEVENTEEN = "2009-05-01";
const ADULT = "1990-01-01";

const DEC_WEEK_A = offsetOf("2027-12-20"); // 24.12.2027 is day 4 of it (a Friday)
const DEC_WEEK_B = offsetOf("2027-12-27"); // 31.12.2027 is day 4 of it (a Friday)

const SN = "salon-sn";
const NI = "salon-ni";
const HOLIDAY_NAME = "Buß- und Bettag";

type Spec = [day: number, start: string, end: string, salonId?: string, id?: string];

function draftOf(day: number, start: string, end: string, salonId?: string): ShiftDraft {
  return {
    date: new Date(`${dayIso(day)}T00:00:00Z`),
    startTime: start,
    endTime: end,
    ...(salonId ? { salonId } : {}),
  };
}

function mkWeek(o: {
  birth: string | null;
  shifts?: Spec[];
  /** salon id -> day index (relative to the week's Monday) -> holiday name. */
  holidays?: Record<string, Record<number, string>>;
  weekStart?: number;
}): MinorShiftWeek {
  const offset = o.weekStart ?? 0;
  const dayOf = (n: number) => dayIso(offset + n);
  const birthDate = o.birth ? new Date(`${o.birth}T00:00:00Z`) : null;
  const week: MinorShiftWeek = {
    employeeId: "emp-pure",
    weekDays: Array.from({ length: 7 }, (_, i) => dayOf(i)),
    birthDate: birthDate as Date,
    breakEmployee: { breakOver6hOverride: null, breakOver9hOverride: null, birthDate },
    breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    creditedMinutesByDate: {},
    schoolDays: [],
    shifts: (o.shifts ?? []).map(([day, start, end, salonId, id], i) => ({
      ...draftOf(offset + day, start, end, salonId),
      id: id ?? `s${i}`,
    })),
  };
  if (o.holidays) {
    const bySalon: Record<string, Record<string, string>> = { [SN]: {}, [NI]: {} };
    for (const [salonId, days] of Object.entries(o.holidays)) {
      bySalon[salonId] = {};
      for (const [n, name] of Object.entries(days)) bySalon[salonId][dayOf(Number(n))] = name;
    }
    week.publicHolidaysBySalon = bySalon;
  }
  return week;
}

const check = (week: MinorShiftWeek, add: ShiftDraft, removeShiftId?: string) =>
  findMinorShiftLimitViolation(week, { add: [add], removeShiftId });

const WED_HOLIDAY = { [SN]: { 2: HOLIDAY_NAME } };
const HOLIDAY_MESSAGE =
  "Am 18.11.2026 (Buß- und Bettag) ist eine Schicht geplant. Jugendliche dürfen an gesetzlichen Feiertagen nicht beschäftigt werden (§ 18 Abs. 1 JArbSchG).";

describe("§ 18 Abs. 1 JArbSchG — Feiertag am Salon der Schicht (Issue #1106)", () => {
  it("P1: a 16-year-old's shift on a holiday of its salon is refused with the exact message", () => {
    const week = mkWeek({ birth: SIXTEEN, holidays: WED_HOLIDAY });
    const v = check(week, draftOf(2, "10:00", "14:00", SN));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(v?.dateIso).toBe("2026-11-18");
    expect(v?.message).toBe(HOLIDAY_MESSAGE);
  });

  it("P2: the same shift in a salon without that holiday is accepted", () => {
    const week = mkWeek({ birth: SIXTEEN, holidays: WED_HOLIDAY });
    expect(check(week, draftOf(2, "10:00", "14:00", NI))).toBeNull();
  });

  it("P3: the age is decided per day — adult on the 18th birthday, minor the day before", () => {
    const holidays = WED_HOLIDAY;
    expect(
      check(mkWeek({ birth: "2008-11-18", holidays }), draftOf(2, "10:00", "14:00", SN)),
    ).toBeNull();
    expect(
      check(mkWeek({ birth: "2008-11-19", holidays }), draftOf(2, "10:00", "14:00", SN))?.code,
    ).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(
      check(mkWeek({ birth: SEVENTEEN, holidays }), draftOf(2, "10:00", "14:00", SN))?.code,
    ).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
  });

  it("P4: Altbestand — only a write that GROWS the day's holiday minutes is refused", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      holidays: WED_HOLIDAY,
      shifts: [[2, "10:00", "14:00", SN, "leg"]],
    });
    expect(check(week, draftOf(2, "10:00", "14:00", SN), "leg")).toBeNull();
    expect(check(week, draftOf(2, "10:00", "13:00", SN), "leg")).toBeNull();
    expect(check(week, draftOf(2, "10:00", "15:00", SN), "leg")?.code).toBe(
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(check(week, draftOf(2, "10:00", "14:00", NI), "leg")).toBeNull();
    // A shift on another day is not blocked by the stored holiday shift.
    expect(check(week, draftOf(3, "10:00", "14:00", SN))).toBeNull();
    // A second shift on the holiday grows its minutes.
    expect(check(week, draftOf(2, "15:00", "16:00", SN))?.code).toBe(
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
  });

  it("P5: the stored-week list names the finding, the label is Feiertagsruhe", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      holidays: WED_HOLIDAY,
      shifts: [[2, "10:00", "14:00", SN, "leg"]],
    });
    const list = findStoredMinorWeekViolations(week);
    expect(list).toEqual([
      { code: "JARBSCHG_VIOLATION_HOLIDAY_REST", dateIso: "2026-11-18", message: HOLIDAY_MESSAGE },
    ]);
    expect(minorShiftLimitLabel(list[0])).toBe("18.11.2026 (Feiertagsruhe)");
  });
});

describe("§ 18 Abs. 1 JArbSchG — 24 and 31 December after 14:00 (Issue #1106)", () => {
  const eveA = mkWeek({ birth: SIXTEEN, weekStart: DEC_WEEK_A });
  const eveB = mkWeek({ birth: SIXTEEN, weekStart: DEC_WEEK_B });
  const EVE_A = DEC_WEEK_A + 4; // 24.12.2027
  const EVE_B = DEC_WEEK_B + 4; // 31.12.2027

  it("P6: a shift ending at 14:00 is accepted, any minute after is refused, 23 December and adults are free", () => {
    expect(check(eveA, draftOf(EVE_A, "08:00", "14:00"))).toBeNull();
    const late = check(eveA, draftOf(EVE_A, "08:00", "14:01"));
    expect(late?.code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(late?.dateIso).toBe("2027-12-24");
    expect(late?.message).toBe(
      "Die geplante Arbeitszeit am 24.12.2027 reicht bis 14:01 Uhr. Am 24. und 31. Dezember dürfen Jugendliche nach 14 Uhr nicht beschäftigt werden (§ 18 Abs. 1 JArbSchG).",
    );
    expect(check(eveA, draftOf(EVE_A, "14:00", "16:00"))?.code).toBe(
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(check(eveA, draftOf(EVE_A - 1, "08:00", "16:00"))).toBeNull();
    expect(check(eveB, draftOf(EVE_B, "09:00", "15:00"))?.code).toBe(
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    expect(check(eveB, draftOf(EVE_B, "09:00", "14:00"))).toBeNull();
    const adult = mkWeek({ birth: ADULT, weekStart: DEC_WEEK_A });
    expect(check(adult, draftOf(EVE_A, "08:00", "16:00"))).toBeNull();
  });

  it("P7: Altbestand on 24 December — only more minutes after 14:00 are refused, the list names it", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      weekStart: DEC_WEEK_A,
      shifts: [[4, "08:00", "16:00", undefined, "leg"]],
    });
    expect(check(week, draftOf(EVE_A, "08:00", "15:00"), "leg")).toBeNull();
    expect(check(week, draftOf(EVE_A, "08:00", "17:00"), "leg")?.code).toBe(
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    );
    const list = findStoredMinorWeekViolations(week);
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(list[0].dateIso).toBe("2027-12-24");
    expect(list[0].message).toContain("reicht bis 16:00 Uhr");
  });

  it("P8: a salon holiday on 24 December names the holiday, not the eve rule", () => {
    const week = mkWeek({
      birth: SIXTEEN,
      weekStart: DEC_WEEK_A,
      holidays: { [NI]: { 4: "Testfeiertag" } },
    });
    const v = check(week, draftOf(EVE_A, "08:00", "12:00", NI));
    expect(v?.code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
    expect(v?.message).toContain("(Testfeiertag)");
    expect(v?.message).not.toContain("nach 14 Uhr");
  });
});

describe("§ 18 JArbSchG — precedence, fail-closed and the gate (Issue #1106)", () => {
  it("P9: a holiday on a Sunday answers SUNDAY_REST on a write, the stored list names both", () => {
    const week = mkWeek({ birth: SIXTEEN, holidays: { [SN]: { 6: "Testfeiertag" } } });
    expect(check(week, draftOf(6, "10:00", "14:00", SN))?.code).toBe(
      "JARBSCHG_VIOLATION_SUNDAY_REST",
    );
    const stored = mkWeek({
      birth: SIXTEEN,
      holidays: { [SN]: { 6: "Testfeiertag" } },
      shifts: [[6, "10:00", "14:00", SN]],
    });
    const list = findStoredMinorWeekViolations(stored);
    expect(list.map((v) => v.code)).toEqual([
      "JARBSCHG_VIOLATION_SUNDAY_REST",
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    ]);
    expect(list.map((v) => v.dateIso)).toEqual(["2026-11-22", "2026-11-22"]);
  });

  it("P10: the daily maximum answers before the holiday, the list holds both", () => {
    const week = mkWeek({ birth: SIXTEEN, holidays: WED_HOLIDAY });
    expect(check(week, draftOf(2, "08:00", "18:00", SN))?.code).toBe(
      "JARBSCHG_VIOLATION_DAILY_MAX",
    );
    const stored = mkWeek({
      birth: SIXTEEN,
      holidays: WED_HOLIDAY,
      shifts: [[2, "08:00", "18:00", SN]],
    });
    expect(findStoredMinorWeekViolations(stored).map((v) => v.code)).toEqual([
      "JARBSCHG_VIOLATION_DAILY_MAX",
      "JARBSCHG_VIOLATION_HOLIDAY_REST",
    ]);
  });

  it("P11: a salon missing from the loaded holiday map throws, a draft without a salon looks nothing up", () => {
    const week = mkWeek({ birth: SIXTEEN, holidays: WED_HOLIDAY });
    expect(() => check(week, draftOf(2, "10:00", "14:00", "salon-xx"))).toThrow(/salon-xx/);
    expect(check(week, draftOf(2, "10:00", "14:00"))).toBeNull();
  });

  it("P12: checkShiftWrite answers rule minorLimits, 422, not overridable, with and without force", () => {
    const EMP = "emp-gate";
    const ctx = () =>
      buildShiftWriteContext({
        tz: "Europe/Berlin",
        todayIso: "2026-11-02",
        tenantConfig: {
          defaultBreakOver6h: 30,
          defaultBreakOver9h: 45,
          shiftStoreHoursMode: "OFF",
        },
        employees: [
          {
            id: EMP,
            birthDate: new Date(`${SIXTEEN}T00:00:00Z`),
            breakOver6hOverride: null,
            breakOver9hOverride: null,
            exitDate: null,
          },
        ],
        earliestContractStart: new Map([[EMP, new Date("2024-01-01T00:00:00Z")]]),
        shifts: [],
        minorWeeks: new Map([
          [`${EMP}::${MON}`, mkWeek({ birth: SIXTEEN, holidays: WED_HOLIDAY })],
        ]),
      });
    const draft = (salonId: string) => ({
      employeeId: EMP,
      dateIso: "2026-11-18",
      startTime: "10:00",
      endTime: "14:00",
      salon: { id: salonId, openingHours: null },
    });

    for (const force of [false, true]) {
      const verdict = checkShiftWrite(ctx(), { draft: draft(SN) }, { force });
      expect(verdict.blocking?.rule).toBe("minorLimits");
      expect(verdict.blocking?.code).toBe("JARBSCHG_VIOLATION_HOLIDAY_REST");
      expect(verdict.blocking?.status).toBe(422);
      expect(verdict.blocking?.overridable).toBe(false);
      expect(
        shiftWriteReplyBody(verdict.blocking!, { contract: "Titel-Vertrag", past: "Titel-Past" }),
      ).toEqual({
        error: "JArbSchG-Verstoß",
        code: "JARBSCHG_VIOLATION_HOLIDAY_REST",
        message: HOLIDAY_MESSAGE,
        canForce: false,
      });
    }
    expect(checkShiftWrite(ctx(), { draft: draft(NI) }, { force: false }).blocking).toBeNull();
  });
});
