// Issue #524 (D-05) - the one § 8 JArbSchG arithmetic. DB-free: every function is pure.
// `week` is Monday..Sunday (7 items); `m(x)` is a minor day with x working minutes.
import { describe, it, expect } from "vitest";
import {
  MINOR_DAILY_EXTENDED_LIMIT_MINUTES,
  MINOR_DAILY_LIMIT_MINUTES,
  MINOR_WEEKLY_LIMIT_MINUTES,
  hasShortenedOtherWerktag,
  holidayFalloutMinutes,
  minorDailyLimitExceeded,
  minorDailyLimitMinutes,
  minorWeekHolidayMinutes,
  minorWeekMinutes,
  minorWeeklyLimitExceeded,
  type MinorWorkDay,
} from "../minor-working-time";

const m = (workMinutes: number, holidayMinutes?: number): MinorWorkDay => ({
  isMinor: true,
  workMinutes,
  ...(holidayMinutes === undefined ? {} : { holidayMinutes }),
});
const adult = (workMinutes: number): MinorWorkDay => ({ isMinor: false, workMinutes });
const rep = (x: MinorWorkDay, n: number): MinorWorkDay[] => Array.from({ length: n }, () => x);

describe("Issue #524 - § 8 JArbSchG kernel", () => {
  it("pins the statutory constants", () => {
    expect(MINOR_DAILY_LIMIT_MINUTES).toBe(480);
    expect(MINOR_DAILY_EXTENDED_LIMIT_MINUTES).toBe(510);
    expect(MINOR_WEEKLY_LIMIT_MINUTES).toBe(2400);
  });

  it("K1: 8:15 on a week with unworked days is within the Abs. 2a ceiling of 8:30", () => {
    const week = [m(495), ...rep(m(0), 6)];
    expect(minorDailyLimitMinutes(week, 0)).toBe(510);
    expect(minorDailyLimitExceeded(week, 0)).toBe(false);
  });

  it("K2: 8:31 exceeds even the extended ceiling", () => {
    const week = [m(511), ...rep(m(0), 6)];
    expect(minorDailyLimitExceeded(week, 0)).toBe(true);
  });

  it("K3: Mon-Sat at 8:00 or more leaves no shortened Werktag, so Friday 8:15 exceeds 8:00", () => {
    const full = [...rep(m(480), 4), m(495), m(480), m(0)];
    expect(minorDailyLimitMinutes(full, 4)).toBe(480);
    expect(minorDailyLimitExceeded(full, 4)).toBe(true);
    // The same week with an unworked Saturday: the Saturday counts as shortened.
    const withFreeSaturday = [...rep(m(480), 4), m(495), m(0), m(0)];
    expect(minorDailyLimitMinutes(withFreeSaturday, 4)).toBe(510);
    expect(minorDailyLimitExceeded(withFreeSaturday, 4)).toBe(false);
  });

  it("K4: a Sunday is not a Werktag", () => {
    const week = [...rep(m(480), 6), m(490)];
    expect(minorDailyLimitMinutes(week, 6)).toBe(480);
    expect(minorDailyLimitExceeded(week, 6)).toBe(true);
    // A short Sunday does not shorten another day's week either.
    const shortSunday = [...rep(m(480), 6), m(0)];
    expect(hasShortenedOtherWerktag(shortSunday, 0)).toBe(false);
  });

  it("K5: a day the person is an adult on is never exceeded", () => {
    const week = [adult(700), ...rep(m(0), 6)];
    expect(minorDailyLimitExceeded(week, 0)).toBe(false);
  });

  it("K6: the week sums minor days only, plus the holiday minutes, against 40:00", () => {
    const week = [...rep(m(480), 5), adult(600), adult(0)];
    expect(minorWeekMinutes(week)).toBe(2400);
    expect(minorWeeklyLimitExceeded(week)).toBe(false);
    const over = [...rep(m(480), 4), m(481), adult(600), adult(0)];
    expect(minorWeekMinutes(over)).toBe(2401);
    expect(minorWeeklyLimitExceeded(over)).toBe(true);
    const holiday = [m(480, 480), ...rep(m(480), 3), m(1, 0), m(0), m(0)];
    expect(minorWeekMinutes(holiday)).toBe(480 + 480 + 480 * 3 + 1);
    expect(minorWeekHolidayMinutes(holiday)).toBe(480);
    // An adult day's holiday minutes are not counted.
    expect(minorWeekHolidayMinutes([{ isMinor: false, workMinutes: 0, holidayMinutes: 480 }])).toBe(
      0,
    );
  });

  it("K7: holiday fallout is what the Soll exceeds the work by, never on a Sunday", () => {
    expect(holidayFalloutMinutes({ isSunday: true, sollMinutes: 480, workMinutes: 0 })).toBe(0);
    expect(holidayFalloutMinutes({ isSunday: false, sollMinutes: 480, workMinutes: 0 })).toBe(480);
    expect(holidayFalloutMinutes({ isSunday: false, sollMinutes: 480, workMinutes: 300 })).toBe(
      180,
    );
    expect(holidayFalloutMinutes({ isSunday: false, sollMinutes: 480, workMinutes: 500 })).toBe(0);
  });
});
