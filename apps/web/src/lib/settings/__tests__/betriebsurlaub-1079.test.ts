// Issue #1079 - the pure half of the scope of a Betriebsurlaub: what the list shows, what the control starts
// with and which `salonIds` the request body carries (no DOM).
import { describe, expect, it } from "vitest";
import {
  createShutdownBody,
  initialShutdownScope,
  isScopeFixed,
  sameScope,
  scopeSelectionOf,
  shutdownSalonIds,
  shutdownSalonLabel,
  shutdownScopeLabel,
  shutdownScopeMessage,
  type ShutdownScope,
} from "../betriebsurlaub";

const ALL: ShutdownScope = {
  canManageAllSalons: true,
  salons: [
    { id: "a", name: "Salon Nord" },
    { id: "b", name: "Salon Süd" },
  ],
};
const ONE: ShutdownScope = { canManageAllSalons: false, salons: [{ id: "a", name: "Salon Nord" }] };
const TWO: ShutdownScope = {
  canManageAllSalons: false,
  salons: [
    { id: "a", name: "Salon Nord" },
    { id: "b", name: "Salon Süd" },
  ],
};

describe("shutdownScopeLabel", () => {
  it("names the whole Unternehmen for no salons", () => {
    expect(shutdownScopeLabel([])).toBe("Ganzes Unternehmen");
  });

  it("lists the salon names and marks a deactivated salon", () => {
    expect(
      shutdownScopeLabel([
        { id: "a", name: "Salon Nord", isActive: true },
        { id: "b", name: "Salon Süd", isActive: false },
      ]),
    ).toBe("Salon Nord, Salon Süd (deaktiviert)");
    expect(shutdownSalonLabel({ name: "Salon Nord", isActive: false })).toBe(
      "Salon Nord (deaktiviert)",
    );
  });
});

describe("the scope control", () => {
  it("a whole-tenant caller starts with the whole Unternehmen and sends no salons", () => {
    const start = initialShutdownScope(ALL);
    expect(start).toEqual({ mode: "ALL", salonIds: [] });
    expect(shutdownSalonIds(start, ALL, true)).toBeUndefined();
    expect(shutdownScopeMessage(start)).toBeNull();
  });

  it("choosing salons needs at least one", () => {
    const empty = { mode: "SALONS" as const, salonIds: [] };
    expect(shutdownScopeMessage(empty)).toBe("Wähle mindestens einen Salon.");
    const chosen = { mode: "SALONS" as const, salonIds: ["b"] };
    expect(shutdownScopeMessage(chosen)).toBeNull();
    expect(shutdownSalonIds(chosen, ALL, true)).toEqual(["b"]);
  });

  it("a scoped caller with one salon has it fixed", () => {
    expect(isScopeFixed(ONE)).toBe(true);
    const start = initialShutdownScope(ONE);
    expect(start).toEqual({ mode: "SALONS", salonIds: ["a"] });
    expect(shutdownSalonIds(start, ONE, true)).toEqual(["a"]);
  });

  it("a scoped caller with several salons must choose and never gets the whole Unternehmen", () => {
    expect(isScopeFixed(TWO)).toBe(false);
    const start = initialShutdownScope(TWO);
    expect(start).toEqual({ mode: "SALONS", salonIds: [] });
    expect(shutdownScopeMessage(start)).not.toBeNull();
  });

  it("a single-salon Unternehmen has no control: whole-tenant sends none, scoped its one salon", () => {
    expect(shutdownSalonIds({ mode: "ALL", salonIds: [] }, ALL, false)).toBeUndefined();
    expect(shutdownSalonIds({ mode: "SALONS", salonIds: [] }, ONE, false)).toEqual(["a"]);
  });

  it("reads the control state of a stored row and compares scopes without regard to order", () => {
    expect(scopeSelectionOf([])).toEqual({ mode: "ALL", salonIds: [] });
    const row = scopeSelectionOf([
      { id: "a", name: "Salon Nord", isActive: true },
      { id: "b", name: "Salon Süd", isActive: true },
    ]);
    expect(row).toEqual({ mode: "SALONS", salonIds: ["a", "b"] });
    expect(sameScope(row, { mode: "SALONS", salonIds: ["b", "a"] })).toBe(true);
    expect(sameScope(row, { mode: "SALONS", salonIds: ["a"] })).toBe(false);
    expect(sameScope(row, { mode: "ALL", salonIds: [] })).toBe(false);
  });
});

describe("createShutdownBody", () => {
  const base = {
    name: "Inventur",
    startDate: "2027-03-01",
    endDate: "2027-03-02",
    deductsFromVacation: true,
    notes: "",
  };

  it("carries salonIds only when salons are named", () => {
    expect(createShutdownBody(base)).not.toHaveProperty("salonIds");
    expect(createShutdownBody({ ...base, salonIds: [] })).not.toHaveProperty("salonIds");
    expect(createShutdownBody({ ...base, salonIds: ["a"] })).toMatchObject({ salonIds: ["a"] });
  });
});
