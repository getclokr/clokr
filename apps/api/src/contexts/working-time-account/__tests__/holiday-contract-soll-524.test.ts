// Issue #524 (D-07) - holidayContractSollMinutes: the contract Soll a holiday prices at, the #1077
// pricing the roster and the recording week share. DB-free: the function is pure.
import { describe, it, expect } from "vitest";
import { holidayContractSollMinutes } from "../holiday-contract-soll";

const TZ = "Europe/Berlin";

const fixed = (validFrom: string, hours: number, extra: Record<string, unknown> = {}) => ({
  type: "FIXED_SCHEDULE",
  validFrom: new Date(`${validFrom}T00:00:00Z`),
  weeklyHours: hours * 5,
  mondayHours: hours,
  tuesdayHours: hours,
  wednesdayHours: hours,
  thursdayHours: hours,
  fridayHours: hours,
  saturdayHours: 0,
  sundayHours: 0,
  workDays: [1, 2, 3, 4, 5],
  ...extra,
});

const base = {
  hireDate: new Date("2024-01-01T00:00:00Z"),
  exitDate: null as Date | null,
  tz: TZ,
};

describe("Issue #524 - holidayContractSollMinutes", () => {
  const schedules = [fixed("2024-01-01", 8)];

  it("H1: a contract weekday prices at its hours, a non-contract day at 0", () => {
    expect(holidayContractSollMinutes({ ...base, dayIso: "2026-05-25", schedules })).toBe(480); // Monday
    expect(holidayContractSollMinutes({ ...base, dayIso: "2026-05-30", schedules })).toBe(0); // Saturday
  });

  it("H1: 0 before the hire day and after the exit day, the boundary days themselves price", () => {
    const hireDate = new Date("2026-05-25T00:00:00Z");
    expect(holidayContractSollMinutes({ ...base, hireDate, dayIso: "2026-05-22", schedules })).toBe(
      0,
    );
    expect(holidayContractSollMinutes({ ...base, hireDate, dayIso: "2026-05-25", schedules })).toBe(
      480,
    );
    const exitDate = new Date("2026-05-27T00:00:00Z");
    expect(holidayContractSollMinutes({ ...base, exitDate, dayIso: "2026-05-27", schedules })).toBe(
      480,
    );
    expect(holidayContractSollMinutes({ ...base, exitDate, dayIso: "2026-05-28", schedules })).toBe(
      0,
    );
  });

  it("H1: 0 when no schedule is valid on the day", () => {
    expect(
      holidayContractSollMinutes({
        ...base,
        dayIso: "2026-05-25",
        schedules: [fixed("2026-06-01", 8)],
      }),
    ).toBe(0);
    expect(holidayContractSollMinutes({ ...base, dayIso: "2026-05-25", schedules: [] })).toBe(0);
  });

  it("H1: the latest schedule with validFrom up to the end of the day wins (change mid-week)", () => {
    const twoVersions = [fixed("2026-05-27", 6), fixed("2024-01-01", 8)]; // newest first
    expect(
      holidayContractSollMinutes({ ...base, dayIso: "2026-05-26", schedules: twoVersions }),
    ).toBe(480);
    expect(
      holidayContractSollMinutes({ ...base, dayIso: "2026-05-27", schedules: twoVersions }),
    ).toBe(360);
    expect(
      holidayContractSollMinutes({ ...base, dayIso: "2026-05-28", schedules: twoVersions }),
    ).toBe(360);
  });
});
