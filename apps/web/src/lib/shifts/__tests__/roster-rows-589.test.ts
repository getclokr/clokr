// Issue #589 — the roster rows, the per-cell contract facts and the shift duration helper.
//
// Owner decision 19.10.2026 (OD-589-1): every person of a salon is in the roster whatever the
// Arbeitszeitmodell. A row is a person with a contract in the displayed week or with a shift in it;
// everything the coverage counts (a shift, or contract presence) is such a person (AC-589-4).
import { describe, it, expect } from "vitest";
import {
  contractFreeDayHint,
  countedByContract,
  rosterRows,
  shiftHours,
  SHIFT_NO_CONTRACT_FALLBACK,
  shiftNoContractMessage,
} from "../roster-rows";

type Type = "FIXED_SCHEDULE" | "FLEXTIME" | "MONTHLY_HOURS" | "SHIFT_BASED";
const emp = (id: string, type?: Type) => ({
  id,
  workSchedules: type ? [{ type }] : [],
});

describe("rosterRows (Issue #589)", () => {
  const week = {
    employees: [
      emp("fixed", "FIXED_SCHEDULE"),
      emp("flex", "FLEXTIME"),
      emp("monthly", "MONTHLY_HOURS"),
      emp("shiftb", "SHIFT_BASED"),
      emp("none"),
      emp("none-with-shift"),
    ],
    shifts: [{ employeeId: "none-with-shift" }],
  };

  it("keeps every person with a contract, whatever the model, in server order", () => {
    expect(rosterRows(week).map((e) => e.id)).toEqual([
      "fixed",
      "flex",
      "monthly",
      "shiftb",
      "none-with-shift",
    ]);
  });

  it("keeps a person without a contract only while they hold a shift of the week", () => {
    expect(rosterRows(week).some((e) => e.id === "none-with-shift")).toBe(true);
    expect(rosterRows(week).some((e) => e.id === "none")).toBe(false);
  });

  it("drops a person with neither, and tolerates an employee row without workSchedules", () => {
    const rows = rosterRows({
      employees: [{ id: "bare" }, emp("x", "FIXED_SCHEDULE")],
      shifts: [],
    });
    expect(rows.map((e) => e.id)).toEqual(["x"]);
  });
});

describe("countedByContract (Issue #589)", () => {
  const week = {
    employees: [],
    shifts: [],
    coverage: [
      { date: "2026-06-15", contractEmployeeIds: ["a", "b"] },
      { date: "2026-06-16", contractEmployeeIds: [] },
      { date: "2026-06-17" },
    ],
  };
  it("is true only when the day's coverage entry lists the person", () => {
    expect(countedByContract(week, "a", "2026-06-15")).toBe(true);
    expect(countedByContract(week, "c", "2026-06-15")).toBe(false);
    expect(countedByContract(week, "a", "2026-06-16")).toBe(false);
  });
  it("accepts a full ISO timestamp for the day", () => {
    expect(countedByContract(week, "b", "2026-06-15T00:00:00.000Z")).toBe(true);
  });
  it("is false for a missing entry or an older response without the field", () => {
    expect(countedByContract(week, "a", "2026-06-17")).toBe(false);
    expect(countedByContract(week, "a", "2026-06-30")).toBe(false);
    expect(countedByContract({ employees: [], shifts: [] }, "a", "2026-06-15")).toBe(false);
  });
});

describe("contractFreeDayHint (Issue #589, D-589-07)", () => {
  const week = {
    employees: [],
    shifts: [],
    contractWorkDaysByEmp: { fixed: ["2026-06-15", "2026-06-16"], flexEmpty: [] },
  };
  const HINT = "An diesem Tag ist laut Vertrag frei.";

  it("hints a fixed or flex person on a day outside their contract workdays", () => {
    expect(contractFreeDayHint(week, emp("fixed", "FIXED_SCHEDULE"), "2026-06-20")).toBe(HINT);
    expect(contractFreeDayHint(week, emp("fixed", "FLEXTIME"), "2026-06-20")).toBe(HINT);
  });
  it("treats a missing key as an empty list", () => {
    expect(contractFreeDayHint(week, emp("other", "FIXED_SCHEDULE"), "2026-06-15")).toBe(HINT);
  });
  it("says nothing on a contract workday", () => {
    expect(contractFreeDayHint(week, emp("fixed", "FIXED_SCHEDULE"), "2026-06-15")).toBeNull();
    expect(
      contractFreeDayHint(week, emp("fixed", "FIXED_SCHEDULE"), "2026-06-15T00:00:00Z"),
    ).toBeNull();
  });
  it("says nothing for MONTHLY_HOURS, SHIFT_BASED or a person without a contract", () => {
    expect(contractFreeDayHint(week, emp("fixed", "MONTHLY_HOURS"), "2026-06-20")).toBeNull();
    expect(contractFreeDayHint(week, emp("fixed", "SHIFT_BASED"), "2026-06-20")).toBeNull();
    expect(contractFreeDayHint(week, emp("fixed"), "2026-06-20")).toBeNull();
  });
  it("says nothing when an older API sent no contractWorkDaysByEmp", () => {
    expect(
      contractFreeDayHint(
        { employees: [], shifts: [] },
        emp("fixed", "FIXED_SCHEDULE"),
        "2026-06-20",
      ),
    ).toBeNull();
  });
});

describe("shiftHours", () => {
  it("measures a same-day shift", () => {
    expect(shiftHours("08:00", "16:30")).toBe(8.5);
  });
  it("measures a cross-midnight shift", () => {
    expect(shiftHours("22:00", "06:00")).toBe(8);
  });
});

describe("shiftNoContractMessage (Issue #589, D-589-02)", () => {
  it("returns the server's German message for the code SHIFT_NO_CONTRACT", () => {
    expect(
      shiftNoContractMessage(422, { code: "SHIFT_NO_CONTRACT", message: "Kein Vertrag am 3.6." }),
    ).toBe("Kein Vertrag am 3.6.");
  });
  it("falls back to the neutral text when the server sends none", () => {
    expect(shiftNoContractMessage(422, { code: "SHIFT_NO_CONTRACT" })).toBe(
      SHIFT_NO_CONTRACT_FALLBACK,
    );
    expect(SHIFT_NO_CONTRACT_FALLBACK).toBe("Für diese Person gilt an diesem Tag kein Vertrag.");
  });
  it("is null for any other code, status or payload (the retired type code included)", () => {
    expect(shiftNoContractMessage(422, { code: "SHIFT_INVALID_EMPLOYEE_TYPE" })).toBeNull();
    expect(shiftNoContractMessage(422, { code: "ARBZG_VIOLATION_DAILY_MAX" })).toBeNull();
    expect(shiftNoContractMessage(409, { code: "SHIFT_NO_CONTRACT" })).toBeNull();
    expect(shiftNoContractMessage(422, undefined)).toBeNull();
  });
});
