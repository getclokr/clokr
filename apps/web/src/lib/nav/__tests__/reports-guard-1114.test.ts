// Issue #1114 — a person without the Team area who opens `/team/berichte` by URL saw the personal-closes branch
// of the reports page under a „Team / Berichte“ crumb, because the route file sat under no RouteGuard. The page is
// now guarded by its route-table permission and a denied person is sent to Ich › Konto (`deniedTo`), the page
// that already shows the own figures. Personas are the shared fixture.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminGuardDecision } from "../admin-route-permissions";
import { APP_ROUTES, crumbTrail, guardDeniedTarget, mayOpenPath, routeByKey } from "../routes";
import personas from "./fixtures/system-role-permissions.json";

const P = personas as Record<string, string[]>;
const user = (permissions: string[]) => ({ permissions });
const BERICHTE = "/team/berichte";

describe("Team › Berichte for a person without the Team area (#1114)", () => {
  it("denies a person with own reach only and sends her to Ich › Konto", () => {
    for (const own of [
      user(P.EMPLOYEE),
      user(["report:export:EIGENE", "time-entry:read:EIGENE"]),
      user(P.TRAINER),
    ]) {
      expect(adminGuardDecision(own, BERICHTE)).toBe("deny");
      expect(guardDeniedTarget(own, BERICHTE)).toBe("/ich/konto");
    }
  });

  it("keeps the page for everyone who holds report:read or team-overview:read", () => {
    for (const slot of ["HR", "OWNER", "ADMIN", "MANAGER", "SALON_MANAGER"]) {
      expect(adminGuardDecision(user(P[slot]), BERICHTE), slot).toBe("allow");
    }
    expect(adminGuardDecision(user(["report:read:ZUGEWIESEN"]), BERICHTE)).toBe("allow");
    expect(adminGuardDecision(user(["team-overview:read:ZUGEWIESEN"]), BERICHTE)).toBe("allow");
    // A Salonleitung also holds the Mitarbeiter role (#992).
    expect(adminGuardDecision(user([...P.SALON_MANAGER, ...P.EMPLOYEE]), BERICHTE)).toBe("allow");
  });

  it("waits while the permission list is not loaded and never denies on a missing list", () => {
    expect(adminGuardDecision({ permissions: undefined }, BERICHTE)).toBe("wait");
  });

  it("gives the denied person no „Team“ crumb: her target is an Ich page everyone may open", () => {
    const own = user(P.EMPLOYEE);
    const target = guardDeniedTarget(own, BERICHTE);
    expect(mayOpenPath(own, target)).toBe(true);
    expect(crumbTrail(target, own)[0].label).toBe("Ich");
  });

  it("every route's deniedTo is an openable page of the table for anyone signed in", () => {
    const withTarget = APP_ROUTES.filter((route) => route.deniedTo !== undefined);
    expect(withTarget.map((route) => route.href)).toContain(BERICHTE);
    for (const route of withTarget) {
      const target = routeByKey(route.deniedTo as string);
      expect(target, `${route.href} -> ${route.deniedTo}`).not.toBeNull();
      expect(target?.requires, `${route.href} -> ${route.deniedTo}`).toBeNull();
    }
  });

  it("falls back to the start page for a page without deniedTo", () => {
    expect(guardDeniedTarget(user(P.EMPLOYEE), "/team/zeiten")).toBe("/ich/tag");
    expect(guardDeniedTarget(user(P.HR), "/team/zeiten")).toBe("/verwalten");
  });

  it("the route file of Berichte sits under a layout with the shared RouteGuard", () => {
    const route = routeByKey(BERICHTE);
    const root = resolve(
      process.cwd(),
      "src",
      "routes",
      "(app)",
      (route?.file ?? "").replace(/^\//, ""),
    );
    const layout = join(root, "+layout.svelte");
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, "utf8")).toContain("<RouteGuard");
  });
});
