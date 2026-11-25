// Issue #1072 - the window of a manual Phorest sync starts on the tenant's day that the caller
// hands in (`todayIso`), never on the UTC day of the device clock, and its end is plain calendar
// arithmetic on that day. Every case runs under three process zones: one at UTC, one ahead of the
// tenant and one behind it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncRange } from "../phorest";

const PROCESS_ZONES = ["UTC", "Europe/Berlin", "Pacific/Pago_Pago"];

describe("syncRange (#1072)", () => {
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
      });

      it("without an explicit range: the given day up to the day plus the window", () => {
        expect(syncRange("", "", 14, "2026-12-25")).toEqual({
          startDate: "2026-12-25",
          endDate: "2027-01-08",
        });
      });

      it("an explicit Von/Bis passes through unchanged", () => {
        expect(syncRange("2026-03-01", "2026-03-05", 14, "2026-12-25")).toEqual({
          startDate: "2026-03-01",
          endDate: "2026-03-05",
        });
      });

      it("a window across a DST change still ends on the right calendar day", () => {
        expect(syncRange("", "", 7, "2026-03-25")).toEqual({
          startDate: "2026-03-25",
          endDate: "2026-04-01",
        });
      });

      it("only one of Von/Bis set is no explicit range", () => {
        expect(syncRange("2026-03-01", "", 14, "2026-12-25")).toEqual({
          startDate: "2026-12-25",
          endDate: "2027-01-08",
        });
      });
    });
  }
});
