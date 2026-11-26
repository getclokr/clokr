// Issue #992 (N-15, D-992-01) — Berichte is in the Team menu for the Salonleitung. The page already serves
// `team-overview:read` holders the tabs Heute and Verläufe (`reportRights().periodTabs`); the route table now
// names the same alternatives, so the rail and ⌘K show the page to the people it serves. No permission and no
// endpoint changes. Personas are the shared fixture; the Salonleitung also holds the Mitarbeiter role.
import { describe, expect, it } from "vitest";
import { pageIndex } from "../quick-search";
import { holdsAlternatives, mobileTabs, routeByKey, visibleRoute } from "../routes";
import { reportRights } from "$lib/page-rights";
import personas from "./fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const on = { availabilityEnabled: true };
const holder = (persona: string) => ({ permissions: P[persona] });
const salonleitung = { permissions: [...P.SALON_MANAGER, ...P.EMPLOYEE] };

const berichte = () => {
  const route = routeByKey("/team/berichte");
  if (route === null) throw new Error("/team/berichte is not in the route table");
  return route;
};

describe("Berichte for the Salonleitung (#992 N-15)", () => {
  it("is visible in the navigation for the Salonmanager with the Mitarbeiter role", () => {
    expect(visibleRoute(salonleitung, berichte(), on)).toBe(true);
    expect(visibleRoute(holder("SALON_MANAGER"), berichte(), on)).toBe(true);
  });

  it("is indexed under Team in ⌘K for her", () => {
    const hit = pageIndex(salonleitung, on).find((page) => page.href === "/team/berichte");
    expect(hit?.group).toBe("Team");
    expect(hit?.label).toBe("Berichte");
  });

  it("does not change her phone tab bar (Mein Tag, Heute im Salon, Aufgaben, Zeiten)", () => {
    expect(mobileTabs(salonleitung, on).map((tab) => tab.href)).toEqual([
      "/ich/tag",
      "/team/heute",
      "/team/aufgaben",
      "/team/zeiten",
    ]);
  });

  it("keeps the answer of every role that held the report permission already", () => {
    for (const persona of ["HR", "OWNER", "ADMIN", "MANAGER"]) {
      const expected = P[persona].includes("report:read:ZUGEWIESEN");
      const viaOverview = P[persona].includes("team-overview:read:ZUGEWIESEN");
      expect(visibleRoute(holder(persona), berichte(), on), persona).toBe(expected || viaOverview);
    }
    expect(visibleRoute(holder("HR"), berichte(), on)).toBe(true);
  });

  it("does not show it to a person with only own (EIGENE) permissions or to a trainer", () => {
    expect(visibleRoute(holder("EMPLOYEE"), berichte(), on)).toBe(false);
    expect(visibleRoute({ permissions: ["time-entry:read:EIGENE"] }, berichte(), on)).toBe(false);
    expect(visibleRoute(holder("TRAINER"), berichte(), on)).toBe(false);
    expect(visibleRoute({ permissions: [] }, berichte(), on)).toBe(false);
  });

  it("parity: the alternatives equal the two keys reportRights() reads for periodTabs", () => {
    const requires = berichte().requires;
    if (requires === null || requires === "children") throw new Error("Berichte is a page entry");
    expect(requires.map((alternative) => [...alternative])).toEqual([
      ["report:read:ZUGEWIESEN"],
      ["team-overview:read:ZUGEWIESEN"],
    ]);
    // Each key alone opens the page and yields a period tab — a change on one side only fails here.
    for (const key of ["report:read:ZUGEWIESEN", "team-overview:read:ZUGEWIESEN"]) {
      const user = { permissions: [key] };
      expect(holdsAlternatives(user, requires), key).toBe(true);
      expect(reportRights(user).periodTabs.length, key).toBeGreaterThan(0);
    }
    expect(holdsAlternatives({ permissions: ["shift:read:ZUGEWIESEN"] }, requires)).toBe(false);
  });
});
