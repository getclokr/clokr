/**
 * Issue #1074 — the stored-week check of § 8 / § 12 JArbSchG (`findStoredMinorWeekViolations`)
 * that reports a plan nobody can refuse (Phorest import). Pure cases on week literals, no DB;
 * parity with the #1057 write check (`findMinorShiftLimitViolation`) is asserted explicitly.
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

const MON = "2026-11-16"; // a Monday; the cases never read "now", so a literal cannot expire
const dayIso = (n: number): string => {
  const d = new Date(`${MON}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => dayIso(i));

const MINOR_BIRTH = "2010-05-01"; // 16 all week
const ADULT_BIRTH = "2008-11-16"; // 18th birthday on the Monday: adult all week
const THURSDAY_BIRTH = "2008-11-19"; // 18th birthday on Thursday 19.11.: minor Mon-Wed only

const MON_I = 0;
const TUE_I = 1;
const WED_I = 2;
const THU_I = 3;
const FRI_I = 4;
const SAT_I = 5;

type Spec = [day: number, start: string, end: string];

function draftOf(day: number, start: string, end: string): ShiftDraft {
  return { date: new Date(`${dayIso(day)}T00:00:00Z`), startTime: start, endTime: end };
}

function mkWeek(o: {
  birth: string | null;
  shifts?: Spec[];
  credit?: Record<number, number>;
}): MinorShiftWeek {
  const credits: Record<string, number> = {};
  for (const [n, minutes] of Object.entries(o.credit ?? {})) credits[dayIso(Number(n))] = minutes;
  const birthDate = o.birth ? new Date(`${o.birth}T00:00:00Z`) : null;
  return {
    employeeId: "emp-pure",
    weekDays: WEEK_DAYS,
    birthDate: birthDate as Date,
    breakEmployee: { breakOver6hOverride: null, breakOver9hOverride: null, birthDate },
    breakTenantConfig: { defaultBreakOver6h: 30, defaultBreakOver9h: 45 },
    creditedMinutesByDate: credits,
    shifts: (o.shifts ?? []).map(([day, start, end], i) => ({
      ...draftOf(day, start, end),
      id: `s${i}`,
    })),
  };
}

const codes = (week: MinorShiftWeek): string[] =>
  findStoredMinorWeekViolations(week).map((v) => `${v.code}@${v.dateIso}`);

describe("findStoredMinorWeekViolations — the stored week (Issue #1074)", () => {
  it("an empty week and a lone 8:30 day with a free Saturday hold nothing", () => {
    expect(findStoredMinorWeekViolations(mkWeek({ birth: MINOR_BIRTH }))).toEqual([]);
    expect(
      findStoredMinorWeekViolations(
        mkWeek({ birth: MINOR_BIRTH, shifts: [[MON_I, "08:00", "17:30"]] }),
      ),
    ).toEqual([]);
  });

  it("a 9:00 Thursday is one DAILY_MAX, message identical to the write check", () => {
    const week = mkWeek({ birth: MINOR_BIRTH, shifts: [[THU_I, "08:00", "18:00"]] });
    const found = findStoredMinorWeekViolations(week);
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe("JARBSCHG_VIOLATION_DAILY_MAX");
    expect(found[0].dateIso).toBe(dayIso(THU_I));
    const emptyWeek = mkWeek({ birth: MINOR_BIRTH });
    const write = findMinorShiftLimitViolation(emptyWeek, {
      add: [draftOf(THU_I, "08:00", "18:00")],
    });
    expect(found[0].message).toBe(write?.message);
  });

  it("a split day over 10 h Schichtzeit is one SHIFT_TIME, equal to the write check", () => {
    const week = mkWeek({
      birth: MINOR_BIRTH,
      shifts: [
        [THU_I, "08:00", "12:00"],
        [THU_I, "15:00", "19:00"],
      ],
    });
    const found = findStoredMinorWeekViolations(week);
    expect(found.map((v) => v.code)).toEqual(["JARBSCHG_VIOLATION_SHIFT_TIME"]);
    const write = findMinorShiftLimitViolation(mkWeek({ birth: MINOR_BIRTH }), {
      add: [draftOf(THU_I, "08:00", "12:00"), draftOf(THU_I, "15:00", "19:00")],
    });
    expect(write?.code).toBe(found[0].code);
    expect(write?.dateIso).toBe(found[0].dateIso);
    expect(write?.message).toBe(found[0].message);
  });

  it("one day can hold DAILY_MAX and SHIFT_TIME, in that order", () => {
    const week = mkWeek({ birth: MINOR_BIRTH, shifts: [[THU_I, "07:00", "18:30"]] });
    expect(codes(week)).toEqual([
      `JARBSCHG_VIOLATION_DAILY_MAX@${dayIso(THU_I)}`,
      `JARBSCHG_VIOLATION_SHIFT_TIME@${dayIso(THU_I)}`,
    ]);
  });

  it("several days are listed in calendar order", () => {
    const week = mkWeek({
      birth: MINOR_BIRTH,
      shifts: [
        [WED_I, "08:00", "18:00"],
        [MON_I, "08:00", "18:00"],
      ],
    });
    expect(codes(week)).toEqual([
      `JARBSCHG_VIOLATION_DAILY_MAX@${dayIso(MON_I)}`,
      `JARBSCHG_VIOLATION_DAILY_MAX@${dayIso(WED_I)}`,
    ]);
  });

  it("a week of 42:30 is WEEKLY_MAX dated Monday, worded without a trigger shift", () => {
    const shifts: Spec[] = [MON_I, TUE_I, WED_I, THU_I, FRI_I].map((d) => [d, "08:00", "17:30"]);
    const found = findStoredMinorWeekViolations(mkWeek({ birth: MINOR_BIRTH, shifts }));
    expect(found.map((v) => v.code)).toEqual(["JARBSCHG_VIOLATION_WEEKLY_MAX"]);
    expect(found[0].dateIso).toBe(dayIso(MON_I));
    expect(found[0].message).toContain(
      "In der Woche vom 16.11. bis 22.11.2026 beträgt die geplante Arbeitszeit 42:30 Stunden",
    );
    expect(found[0].message).not.toContain("Mit der Schicht");
  });

  it("exactly 40:00 holds nothing", () => {
    const shifts: Spec[] = [MON_I, TUE_I, WED_I, THU_I, FRI_I].map((d) => [d, "08:00", "17:00"]);
    expect(findStoredMinorWeekViolations(mkWeek({ birth: MINOR_BIRTH, shifts }))).toEqual([]);
  });

  it("the Berufsschule credit counts into the week (42:00 with, 34:00 without)", () => {
    const tueFri: Spec[] = [TUE_I, WED_I, THU_I, FRI_I].map((d) => [d, "08:00", "17:30"]);
    const withCredit = findStoredMinorWeekViolations(
      mkWeek({ birth: MINOR_BIRTH, shifts: tueFri, credit: { [MON_I]: 480 } }),
    );
    expect(withCredit.map((v) => v.code)).toEqual(["JARBSCHG_VIOLATION_WEEKLY_MAX"]);
    expect(withCredit[0].message).toContain("42:00 Stunden");
    expect(findStoredMinorWeekViolations(mkWeek({ birth: MINOR_BIRTH, shifts: tueFri }))).toEqual(
      [],
    );
  });

  it("Mon-Sat of 8:30 has no shortened Werktag: six DAILY_MAX plus WEEKLY_MAX", () => {
    const shifts: Spec[] = [MON_I, TUE_I, WED_I, THU_I, FRI_I, SAT_I].map((d) => [
      d,
      "08:00",
      "17:30",
    ]);
    const found = findStoredMinorWeekViolations(mkWeek({ birth: MINOR_BIRTH, shifts }));
    expect(found.map((v) => v.code)).toEqual([
      ...Array<string>(6).fill("JARBSCHG_VIOLATION_DAILY_MAX"),
      "JARBSCHG_VIOLATION_WEEKLY_MAX",
    ]);
  });

  it("the age is decided per day: the 18th birthday itself is adult", () => {
    const thursday = findStoredMinorWeekViolations(
      mkWeek({ birth: THURSDAY_BIRTH, shifts: [[THU_I, "08:00", "18:00"]] }),
    );
    expect(thursday).toEqual([]);
    expect(codes(mkWeek({ birth: THURSDAY_BIRTH, shifts: [[WED_I, "08:00", "18:00"]] }))).toEqual([
      `JARBSCHG_VIOLATION_DAILY_MAX@${dayIso(WED_I)}`,
    ]);
  });

  it("an adult all week and a missing birth date hold nothing", () => {
    const shifts: Spec[] = [MON_I, TUE_I, WED_I, THU_I, FRI_I, SAT_I].map((d) => [
      d,
      "07:00",
      "18:30",
    ]);
    expect(findStoredMinorWeekViolations(mkWeek({ birth: ADULT_BIRTH, shifts }))).toEqual([]);
    expect(findStoredMinorWeekViolations(mkWeek({ birth: null, shifts }))).toEqual([]);
  });

  it("minorShiftLimitLabel names the day and the kind", () => {
    const base = { dateIso: "2026-11-19", message: "x" };
    expect(minorShiftLimitLabel({ ...base, code: "JARBSCHG_VIOLATION_DAILY_MAX" })).toBe(
      "19.11.2026 (Arbeitszeit)",
    );
    expect(minorShiftLimitLabel({ ...base, code: "JARBSCHG_VIOLATION_SHIFT_TIME" })).toBe(
      "19.11.2026 (Schichtzeit)",
    );
    expect(minorShiftLimitLabel({ ...base, code: "JARBSCHG_VIOLATION_WEEKLY_MAX" })).toBe(
      "Wochenarbeitszeit",
    );
  });
});
