// Issue #1011 (finding U-02) — the reroute targets of Dienstplan Bedarf and Hinweise sat under no layout with
// the shared RouteGuard, so a reader without shift:plan saw the API's raw 403 text on a false empty state.
// This structural gate keeps every permission-gated page of the route table behind a RouteGuard (or a named,
// reasoned exception), and pins the persona decisions of the two tabs by hand (D-14 style).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adminGuardDecision } from "../admin-route-permissions";
import { APP_ROUTES, homeHref } from "../routes";
import personas from "./fixtures/system-role-permissions.json";

function webSrc(): string {
  try {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    if (existsSync(join(root, "app.html"))) return root;
  } catch {
    // fall through to the cwd-based root
  }
  return resolve(process.cwd(), "src");
}

const SRC = webSrc();
const APP_DIR = join(SRC, "routes", "(app)");
const p = personas as Record<string, string[]>;
const user = (permissions: string[] | undefined) => ({ permissions });

/** Route file (the file path a table entry renders) -> why it is deliberately still unguarded. */
const STILL_UNGUARDED: Record<string, string> = {
  "/inbox":
    "redirects itself in onMount through taskGates(...).page (Phase 378, #840), the same effect as the guard",
  "/reports":
    "also serves team-overview:read holders beyond its table entry (reportRights().periodTabs); a guard would lock the Salonleitung out (finding N-15)",
};

interface Checked {
  href: string;
  file: string;
  covered: boolean;
}

/** True when a +layout.svelte between routes/(app) and the page directory renders the shared RouteGuard. */
function guardedByLayout(file: string): boolean {
  const dirs = [APP_DIR];
  let dir = APP_DIR;
  for (const segment of file.split("/").filter(Boolean)) {
    dir = join(dir, segment);
    dirs.push(dir);
  }
  return dirs.some((d) => {
    const layout = join(d, "+layout.svelte");
    return existsSync(layout) && readFileSync(layout, "utf8").includes("<RouteGuard");
  });
}

function checkedRoutes(): Checked[] {
  const out: Checked[] = [];
  for (const entry of APP_ROUTES) {
    if (!Array.isArray(entry.requires)) continue;
    const file = entry.file ?? entry.href;
    expect(file, `${entry.href}: a dynamic segment is not mapped by this gate`).not.toMatch(
      /[[\]]/,
    );
    const pageFile = join(APP_DIR, file, "+page.svelte");
    expect(existsSync(pageFile), `${entry.href}: page file ${file}/+page.svelte is missing`).toBe(
      true,
    );
    out.push({ href: entry.href, file, covered: guardedByLayout(file) });
  }
  return out;
}

describe("route guard coverage (Issue #1011, U-02)", () => {
  const checked = checkedRoutes();

  it("every gated page of the route table is behind a RouteGuard layout or a named exception", () => {
    const uncovered = checked
      .filter((c) => !c.covered && !(c.file in STILL_UNGUARDED))
      .map((c) => c.file)
      .sort();
    expect(uncovered).toEqual([]);
  });

  it("each named exception is still a table page file and still uncovered (no stale entry)", () => {
    for (const file of Object.keys(STILL_UNGUARDED)) {
      const hit = checked.find((c) => c.file === file);
      expect(hit, `${file} is no longer a gated page of the route table`).toBeDefined();
      expect(hit!.covered, `${file} gained a guard: drop it from STILL_UNGUARDED`).toBe(false);
    }
  });

  it("the /inbox exception really redirects itself", () => {
    const source = readFileSync(join(APP_DIR, "inbox", "+page.svelte"), "utf8");
    expect(source).toContain("goto(homeHref(");
  });

  it("is not vacuous: it checked many pages, among them the three Dienstplan tabs", () => {
    expect(checked.length).toBeGreaterThanOrEqual(25);
    const hrefs = checked.map((c) => c.href);
    for (const href of [
      "/team/dienstplan",
      "/team/dienstplan/planung",
      "/team/dienstplan/konflikte",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("Bedarf and Hinweise: shift:plan holders open them, HR, TRAINER and EMPLOYEE are sent home", () => {
    for (const path of ["/team/dienstplan/planung", "/team/dienstplan/konflikte"]) {
      for (const slot of ["ADMIN", "OWNER", "MANAGER", "SALON_MANAGER"]) {
        expect(adminGuardDecision(user(p[slot]), path), `${slot} ${path}`).toBe("allow");
      }
      for (const slot of ["HR", "TRAINER", "EMPLOYEE"]) {
        expect(adminGuardDecision(user(p[slot]), path), `${slot} ${path}`).toBe("deny");
      }
    }
    expect(homeHref(user(p.HR))).toBe("/verwalten");
  });
});
