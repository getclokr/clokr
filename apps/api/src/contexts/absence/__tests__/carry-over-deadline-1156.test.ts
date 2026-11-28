/**
 * Issue #1156 — the carry-over deadline is one representation: 23:59:59 UTC of the Stichtag.
 *
 * Pure — no DB, no Fastify. Each case switches the process time zone (the same `process.env.TZ`
 * technique as `vacation-calc-timezone.test.ts`) and restores it afterwards. The control assertion
 * in every case proves the zone actually took effect: the old host-zone construction
 * `new Date(y, m - 1, d, 23, 59, 59)` must differ from the canonical value there, otherwise the
 * case would pass vacuously in a UTC run.
 */
import { describe, it, expect, afterAll } from "vitest";
import { carryOverDeadlineFor, carryOverDeadlineDay } from "../carry-over-deadline";
import { dayLabelDe } from "../../../utils/day-label-de";

const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

// East of UTC (day edge goes forward), the production zone, and west of UTC (day edge goes back).
const HOST_ZONES = ["Pacific/Auckland", "Europe/Berlin", "America/Los_Angeles", "UTC"] as const;

describe("carryOverDeadlineFor / carryOverDeadlineDay / dayLabelDe (Issue #1156, #1149)", () => {
  for (const tz of HOST_ZONES) {
    it(`writes and reads the same Stichtag under host zone ${tz}`, () => {
      process.env.TZ = tz;

      const deadline = carryOverDeadlineFor(2027, 3, 31);

      // The stored instant is host-independent.
      expect(deadline.toISOString()).toBe("2027-03-31T23:59:59.000Z");
      // Every reader names the same day, whatever the host zone.
      expect(carryOverDeadlineDay(deadline)).toBe("2027-03-31");
      expect(dayLabelDe(deadline)).toBe("31.3.2027");

      // Control: the pre-#1156 host-zone construction disagrees outside UTC.
      const legacy = new Date(2027, 2, 31, 23, 59, 59);
      if (tz === "UTC") {
        expect(legacy.toISOString()).toBe("2027-03-31T23:59:59.000Z");
      } else {
        expect(legacy.toISOString()).not.toBe("2027-03-31T23:59:59.000Z");
      }
    });
  }

  it("the old host-zone value names the WRONG day for readers that take the UTC date (control for the bug)", () => {
    process.env.TZ = "America/Los_Angeles";
    const legacy = new Date(2027, 2, 31, 23, 59, 59); // 06:59:59Z on 1 April
    expect(carryOverDeadlineDay(legacy)).toBe("2027-04-01");
    expect(carryOverDeadlineDay(carryOverDeadlineFor(2027, 3, 31))).toBe("2027-03-31");
  });

  it("the year edge and a leap-day Stichtag keep their day under a non-UTC host", () => {
    process.env.TZ = "Pacific/Auckland";
    expect(carryOverDeadlineDay(carryOverDeadlineFor(2027, 12, 31))).toBe("2027-12-31");
    expect(carryOverDeadlineDay(carryOverDeadlineFor(2028, 2, 29))).toBe("2028-02-29");
    expect(dayLabelDe(carryOverDeadlineFor(2028, 1, 1))).toBe("1.1.2028");
  });
});
