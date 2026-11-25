// Issue #1066 - tenantDay / tenantTimeOfDay name the tenant's calendar day and wall-clock time of an
// instant, whatever zone the process (the device) runs in. Every case runs under five process zones.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDay, tenantTimeOfDay } from "../tenant-day";

const PROCESS_ZONES = [
  "UTC",
  "Pacific/Pago_Pago",
  "Pacific/Kiritimati",
  "Europe/Berlin",
  "America/New_York",
];

/** [instant, tenantZone, day, time-of-day] */
const CASES: Array<[string, string, string, string]> = [
  // Berlin midnight (CET)
  ["2026-11-24T22:59:00Z", "Europe/Berlin", "2026-11-24", "23:59"],
  ["2026-11-24T23:00:00Z", "Europe/Berlin", "2026-11-25", "00:00"],
  ["2026-11-24T23:30:00Z", "Europe/Berlin", "2026-11-25", "00:30"],
  // DST start 2026-03-29 (02:00 -> 03:00)
  ["2026-03-28T22:59:00Z", "Europe/Berlin", "2026-03-28", "23:59"],
  ["2026-03-28T23:00:00Z", "Europe/Berlin", "2026-03-29", "00:00"],
  ["2026-03-29T01:00:00Z", "Europe/Berlin", "2026-03-29", "03:00"],
  // DST end 2026-10-25 (03:00 -> 02:00)
  ["2026-10-24T21:59:00Z", "Europe/Berlin", "2026-10-24", "23:59"],
  ["2026-10-24T22:00:00Z", "Europe/Berlin", "2026-10-25", "00:00"],
  ["2026-10-25T01:00:00Z", "Europe/Berlin", "2026-10-25", "02:00"],
  // a tenant that is not in Berlin
  ["2026-11-25T04:59:00Z", "America/New_York", "2026-11-24", "23:59"],
  ["2026-11-25T05:00:00Z", "America/New_York", "2026-11-25", "00:00"],
  ["2026-11-24T14:59:00Z", "Asia/Tokyo", "2026-11-24", "23:59"],
  ["2026-11-24T15:00:00Z", "Asia/Tokyo", "2026-11-25", "00:00"],
];

describe("tenantDay / tenantTimeOfDay (#1066)", () => {
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
        // 12:00 UTC read through the local accessors: the offset of the zone, not of UTC
        const noon = new Date("2026-11-24T12:00:00Z");
        const offsetHours = { UTC: 12, "Pacific/Pago_Pago": 1, "Pacific/Kiritimati": 2 } as Record<
          string,
          number
        >;
        if (processZone in offsetHours) expect(noon.getHours()).toBe(offsetHours[processZone]);
        if (processZone === "Europe/Berlin") expect(noon.getHours()).toBe(13);
        if (processZone === "America/New_York") expect(noon.getHours()).toBe(7);
      });

      for (const [instant, zone, day, time] of CASES) {
        it(`${instant} in ${zone} is ${day} ${time}`, () => {
          const now = new Date(instant);
          expect(tenantDay(now, zone)).toBe(day);
          expect(tenantTimeOfDay(now, zone)).toBe(time);
        });
      }

      it("an empty or unknown zone reads as Europe/Berlin, never as the device zone", () => {
        const now = new Date("2026-11-24T23:30:00Z");
        for (const zone of ["", "Mars/Olympus"]) {
          expect(tenantDay(now, zone)).toBe("2026-11-25");
          expect(tenantTimeOfDay(now, zone)).toBe("00:30");
        }
      });
    });
  }

  describe("process TZ Pacific/Kiritimati (UTC+14, a day ahead of Berlin)", () => {
    beforeAll(() => {
      process.env.TZ = "Pacific/Kiritimati";
    });

    it("the fallback is Berlin's day while the device is on the next day", () => {
      const now = new Date("2026-11-24T10:30:00Z");
      // proves the helper is not reading the device: the device says the 25th, 00:30
      expect(now.getDate()).toBe(25);
      expect(tenantDay(now, "")).toBe("2026-11-24");
      expect(tenantTimeOfDay(now, "Mars/Olympus")).toBe("11:30");
    });
  });
});
