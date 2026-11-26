// Issue #992 (N-05, D-992-10; N-07, D-992-12) - the address helpers of Team › Zeiten: the person and the
// selected day are kept in the address, `eintragen=1` is read once and never written back.
import { describe, expect, it } from "vitest";
import { addOnArrival, teamZeitenSearch } from "../zeiten-url";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const search = (current: string, state: Parameters<typeof teamZeitenSearch>[1]) =>
  teamZeitenSearch(new URLSearchParams(current), state);

describe("teamZeitenSearch", () => {
  it("writes person and day in person mode and removes mode", () => {
    const next = search("mode=salon&view=list", {
      mode: "person",
      employeeId: ID,
      date: "2026-11-26",
    });
    expect(next.get("employeeId")).toBe(ID);
    expect(next.get("date")).toBe("2026-11-26");
    expect(next.has("mode")).toBe(false);
    expect(next.get("view")).toBe("list");
  });

  it("writes the normalised (lowercase) id", () => {
    const next = search("", { mode: "person", employeeId: ID.toUpperCase(), date: null });
    expect(next.get("employeeId")).toBe(ID);
  });

  it("writes mode=salon and drops the person in salon mode, keeping view and foreign keys", () => {
    const next = search(`employeeId=${ID}&date=2026-11-26&view=list&x=1`, {
      mode: "salon",
      employeeId: ID,
      date: "2026-11-26",
    });
    expect(next.get("mode")).toBe("salon");
    expect(next.has("employeeId")).toBe(false);
    expect(next.get("view")).toBe("list");
    expect(next.get("x")).toBe("1");
  });

  it("always drops eintragen", () => {
    expect(
      search("eintragen=1", { mode: "person", employeeId: ID, date: null }).has("eintragen"),
    ).toBe(false);
    expect(
      search("eintragen=1", { mode: "salon", employeeId: null, date: null }).has("eintragen"),
    ).toBe(false);
  });

  it("does not write an id or a day the receivers reject (and removes a stale one)", () => {
    const bad = search(`employeeId=${ID}&date=2026-11-26`, {
      mode: "person",
      employeeId: "not-a-uuid",
      date: "2026-02-30",
    });
    expect(bad.has("employeeId")).toBe(false);
    expect(bad.has("date")).toBe(false);
    const none = search("", { mode: "person", employeeId: null, date: null });
    expect(none.toString()).toBe("");
  });

  it("does not change the input", () => {
    const current = new URLSearchParams("eintragen=1");
    teamZeitenSearch(current, { mode: "person", employeeId: ID, date: "2026-11-26" });
    expect(current.toString()).toBe("eintragen=1");
  });
});

describe("addOnArrival", () => {
  it("is true only for eintragen=1", () => {
    expect(addOnArrival(new URLSearchParams("eintragen=1"))).toBe(true);
    expect(addOnArrival(new URLSearchParams("eintragen=0"))).toBe(false);
    expect(addOnArrival(new URLSearchParams("eintragen=true"))).toBe(false);
    expect(addOnArrival(new URLSearchParams("eintragen="))).toBe(false);
    expect(addOnArrival(new URLSearchParams(""))).toBe(false);
  });
});
