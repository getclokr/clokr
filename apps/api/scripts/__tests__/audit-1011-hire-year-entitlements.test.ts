/**
 * Issue #1011 — the read-only audit's pure classification and its strict CLI (no database).
 */
import { describe, it, expect } from "vitest";
import {
  classifyHireYearRows,
  isHireYearMidMonthRow,
  parseCli,
  type HireYearRow,
} from "../audit-1011-hire-year-entitlements";

const row = (over: Partial<HireYearRow> = {}): HireYearRow => ({
  tenantId: "t",
  employeeId: "e1",
  entitlementId: "r1",
  hireDate: new Date("2026-11-16T00:00:00Z"),
  year: 2026,
  totalDays: 5,
  usedDays: 0,
  legalTotalDays: 3,
  humanWrite: false,
  ...over,
});

describe("Issue #1011 — read-only hire-year entitlement audit", () => {
  it("lists a hire-year row of a mid-month hire whose stored value differs from the legal one", () => {
    expect(classifyHireYearRows([row()])).toEqual([
      {
        tenantId: "t",
        employeeId: "e1",
        entitlementId: "r1",
        year: 2026,
        storedTotalDays: 5,
        legalTotalDays: 3,
        usedDays: 0,
        humanWrite: false,
        usedAboveLegal: false,
      },
    ]);
  });

  it("does not list a row whose stored value already equals the legal value (13 for a 15.07. hire at base 30)", () => {
    expect(
      classifyHireYearRows([
        row({ hireDate: new Date("2026-07-15T00:00:00Z"), totalDays: 13, legalTotalDays: 13 }),
      ]),
    ).toEqual([]);
  });

  it("compares on 2 decimals: float noise is not a difference", () => {
    expect(classifyHireYearRows([row({ totalDays: 8.333333, legalTotalDays: 8.33 })])).toEqual([]);
  });

  it("never lists a hire on the 1st, a row of another year, or a row of an earlier hire year", () => {
    expect(
      classifyHireYearRows([
        row({ hireDate: new Date("2026-11-01T00:00:00Z") }),
        row({ year: 2027 }),
        row({ hireDate: new Date("2025-11-16T00:00:00Z") }),
      ]),
    ).toEqual([]);
    expect(isHireYearMidMonthRow(new Date("2026-11-16T00:00:00Z"), 2026)).toBe(true);
    expect(isHireYearMidMonthRow(new Date("2026-11-01T00:00:00Z"), 2026)).toBe(false);
    expect(isHireYearMidMonthRow(new Date("2026-11-16T00:00:00Z"), 2027)).toBe(false);
  });

  it("decides the hire day in UTC (a 1st at UTC midnight is a 1st)", () => {
    expect(isHireYearMidMonthRow(new Date("2026-08-01T00:00:00Z"), 2026)).toBe(false);
    expect(isHireYearMidMonthRow(new Date("2026-07-31T23:59:59Z"), 2026)).toBe(true);
  });

  it("flags human-written rows and rows whose used days exceed the legal value", () => {
    const [finding] = classifyHireYearRows([row({ humanWrite: true, usedDays: 4 })]);
    expect(finding.humanWrite).toBe(true);
    expect(finding.usedAboveLegal).toBe(true);
    const [fine] = classifyHireYearRows([row({ usedDays: 3 })]);
    expect(fine.usedAboveLegal).toBe(false);
  });

  it("a finding carries exactly the ids-and-numbers keys and nothing else", () => {
    const [finding] = classifyHireYearRows([row()]);
    expect(Object.keys(finding).sort()).toEqual(
      [
        "employeeId",
        "entitlementId",
        "humanWrite",
        "legalTotalDays",
        "storedTotalDays",
        "tenantId",
        "usedAboveLegal",
        "usedDays",
        "year",
      ].sort(),
    );
  });

  it("parseCli accepts only --help and rejects every write flag", () => {
    expect(parseCli([])).toEqual({ help: false });
    expect(parseCli(["--help"])).toEqual({ help: true });
    expect(() => parseCli(["--confirm"])).toThrow();
    expect(() => parseCli(["--apply"])).toThrow();
    expect(() => parseCli(["--dry-run"])).toThrow();
  });
});
