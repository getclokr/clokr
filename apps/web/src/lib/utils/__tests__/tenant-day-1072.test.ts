// Issue #1072 - tenantYear / dayAnchor / tenantDayAnchor read the tenant calendar whatever zone the
// process (the device) runs in. Every case runs under six process zones, one of which skips local
// midnight on a DST day (America/Santiago, 2026-09-06).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { format } from "date-fns";
import { dayAnchor, tenantDay, tenantDayAnchor, tenantYear } from "../tenant-day";

const PROCESS_ZONES = [
  "UTC",
  "Pacific/Pago_Pago",
  "Pacific/Kiritimati",
  "Europe/Berlin",
  "America/New_York",
  "America/Santiago",
];

/** [instant, tenantZone, year] */
const YEAR_CASES: Array<[string, string, number]> = [
  ["2026-12-31T22:59:00Z", "Europe/Berlin", 2026],
  ["2026-12-31T23:00:00Z", "Europe/Berlin", 2027],
  ["2027-01-01T04:59:00Z", "America/New_York", 2026],
  ["2027-01-01T05:00:00Z", "America/New_York", 2027],
  ["2026-12-31T14:59:00Z", "Asia/Tokyo", 2026],
  ["2026-12-31T15:00:00Z", "Asia/Tokyo", 2027],
];

describe("tenantYear / dayAnchor / tenantDayAnchor (#1072)", () => {
  const original = process.env.TZ;
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  for (const processZone of PROCESS_ZONES) {
    describe(`process TZ ${processZone}`, () => {
      beforeAll(() => {
        process.env.TZ = processZone;
      });

      it("anti-vacuity: the zone switch took effect", () => {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(processZone);
        const noon = new Date("2026-11-24T12:00:00Z");
        const offsetHours: Record<string, number> = {
          UTC: 12,
          "Pacific/Pago_Pago": 1,
          "Pacific/Kiritimati": 2,
          "Europe/Berlin": 13,
          "America/New_York": 7,
          "America/Santiago": 9,
        };
        expect(noon.getHours()).toBe(offsetHours[processZone]);
      });

      for (const [instant, zone, year] of YEAR_CASES) {
        it(`${instant} in ${zone} is year ${year}`, () => {
          expect(tenantYear(new Date(instant), zone)).toBe(year);
        });
      }

      it("an empty or unknown zone reads as Europe/Berlin", () => {
        const now = new Date("2026-12-31T23:30:00Z");
        for (const zone of ["", "Mars/Olympus"]) expect(tenantYear(now, zone)).toBe(2027);
      });

      it("tenantDayAnchor carries the tenant day in its local fields, at noon", () => {
        for (const [instant, zone] of YEAR_CASES) {
          const now = new Date(instant);
          const [y, m, d] = tenantDay(now, zone).split("-").map(Number);
          const anchor = tenantDayAnchor(now, zone);
          expect(anchor.getFullYear()).toBe(y);
          expect(anchor.getMonth()).toBe(m - 1);
          expect(anchor.getDate()).toBe(d);
          expect(anchor.getHours()).toBe(12);
        }
      });

      it("dayAnchor of a DST day whose midnight is skipped keeps the day", () => {
        // America/Santiago skips 2026-09-06 00:00 (the clock jumps to 01:00)
        const anchor = dayAnchor("2026-09-06");
        expect(anchor.getDate()).toBe(6);
        expect(anchor.getMonth()).toBe(8);
        expect(anchor.getHours()).toBe(12);
      });

      it("dayAnchor round-trips through date-fns format", () => {
        for (const day of ["2027-01-01", "2026-12-31", "2026-09-06", "2026-03-29"]) {
          expect(format(dayAnchor(day), "yyyy-MM-dd")).toBe(day);
        }
      });
    });
  }
});
