/**
 * Issue #1156 — the konto page names the carry-over Stichtag as a calendar day.
 *
 * The deadline is compared with the tenant's today as a DAY, so it neither disappears on the
 * Stichtag itself nor shifts to the next day when the device zone is east of UTC. The cases switch
 * the process zone to prove the result does not depend on it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { carryOverDeadlineAhead } from "$lib/leave/vacation-balance";
import { fmtDateDe } from "$lib/reports/period-format";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("carryOverDeadlineAhead (Issue #1156)", () => {
  for (const tz of ["Pacific/Auckland", "Europe/Berlin", "America/Los_Angeles", "UTC"]) {
    it(`keeps the Stichtag as the same day under device zone ${tz}`, () => {
      process.env.TZ = tz;
      // Control: an ISO instant read through the device zone is another day outside UTC/west.
      if (tz === "Pacific/Auckland" || tz === "Europe/Berlin") {
        expect(new Date("2027-03-31T23:59:59.000Z").getDate()).not.toBe(31);
      }

      expect(carryOverDeadlineAhead("2027-03-31", "2027-03-01")).toBe("2027-03-31");
      expect(carryOverDeadlineAhead("2027-03-31T23:59:59.000Z", "2027-03-01")).toBe("2027-03-31");
      expect(fmtDateDe(carryOverDeadlineAhead("2027-03-31", "2027-03-01")!)).toBe("31.03.2027");
    });
  }

  it("still shows the Stichtag on the Stichtag itself and hides it the day after", () => {
    expect(carryOverDeadlineAhead("2027-03-31", "2027-03-31")).toBe("2027-03-31");
    expect(carryOverDeadlineAhead("2027-03-31", "2027-04-01")).toBeNull();
  });

  it("returns null without a deadline", () => {
    expect(carryOverDeadlineAhead(null, "2027-03-01")).toBeNull();
  });
});
