/**
 * Month arithmetic on UTC dates that cannot overflow (Issue #156).
 *
 * `d.setUTCMonth(d.getUTCMonth() - n)` on day 29-31 spills into the following month when the target
 * month is shorter (31 July minus 5 months = "31 February" = 3 March), so every window built that
 * way started a month late on those days. Both helpers below build the result from
 * (year, month, day) through `Date.UTC`, which takes any month index, negative or above 11, so
 * there is no intermediate date that could overflow.
 */

/**
 * Lower bound of a "last N months" snapshot window: UTC midnight of the LAST day of the month
 * `monthsBack + 1` months before `now`'s month. A TZ-converted monthly snapshot of the window's
 * first month is stored on exactly that day (Issue #595, D-03), so a bound on the 1st would miss it.
 *
 * Example: `now` = 31 July, `monthsBack` = 5 -> 31 January (window = February .. July).
 */
export function monthWindowFloorUtc(now: Date, monthsBack: number): Date {
  // Day 0 of month M is the last day of month M-1; month indices outside 0-11 roll the year.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 0));
}

/**
 * `from` plus `months` UTC calendar months, same time of day, with the day of month clamped to the
 * length of the target month (31 August + 6 months = 28/29 February, never 3 March).
 */
export function addUtcMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}
