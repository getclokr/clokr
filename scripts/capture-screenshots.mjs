#!/usr/bin/env node
/**
 * capture-screenshots.mjs — standalone screenshot capturer for the Clokr web app.
 *
 * Drives a running Clokr web server with a real Chromium (the one bundled with the repo's
 * already-installed @playwright/test) and produces up to three output sets, chosen with the
 * repeatable `--set <name>` flag (no flag = `design` + `readme`, as before):
 *
 *   --set handbuch  The Handbuch screenshots (Issue #1064). Reads every capture note
 *                   (`<!-- SCREENSHOT file=… role=… url=… show="…" -->`) from docs/handbuch/**
 *                   via scripts/screenshot-notes.mjs, signs in as the note's `role`, opens its
 *                   v2 `url` at 1440 x 900 in LIGHT mode and screenshots the page's main content
 *                   landmark (`main#main-content`, i.e. without sidebar and top bar) into
 *                   docs/handbuch/bilder/<file name>. Pages under /login are shot logged out.
 *   --set readme    The README hero subset → images/screenshot-*.png, 1280 x 800, full page,
 *                   light mode, on the v2 paths (/ich/tag, /ich/zeiten, /ich/abwesenheiten,
 *                   /team/berichte, /verwalten/personen, /ich/profil).
 *   --set design    The legacy 31-page design set → OUT_DIR (default docs/design/screenshots,
 *                   local-only, gitignored). Its paths are the pre-v2 routes and are kept only so
 *                   the old flag-less invocation keeps its behaviour; use handbuch/readme for v2.
 *
 * This is a *script*, not a Playwright test. Every capture is wrapped in try/catch: one bad route
 * never aborts the run, and a summary is printed at the end (exit 1 only if nothing was captured).
 *
 * ── Usage: capturing the Handbuch + README screenshots (checkpoint CP-1 of #1064) ─────
 *
 * Use a throwaway stack with ONLY fictional demo data — never the dev database. The rich demo
 * tenant (10 invented people in two salons, filled roster, open leave requests, break findings)
 * comes from packages/db/src/seed-demo.ts, NOT from `SEED_DEMO_DATA=true` (that variable runs the
 * minimal seed.ts: one admin and one employee, nothing to show on most pages). The two seeds are
 * mutually exclusive (both create tenant slug "demo-clokr"), so start the stack WITHOUT
 * SEED_DEMO_DATA and seed the rich tenant into its (tmpfs) database:
 *
 *   docker compose -f docker-compose.test.yml up --build --wait        # web :3001, api :4001, db :5433
 *   DATABASE_URL="postgresql://clokr:clokr@localhost:5433/clokr_test" \
 *     pnpm --filter @clokr/db exec tsx src/seed-demo.ts                  # prints the logins
 *
 *   BASE_URL=http://localhost:3001 \
 *   ADMIN_EMAIL=admin@clokr.de ADMIN_PASSWORD=demo1234 \
 *   MANAGER_EMAIL=lena.vogel@demo.clokr.de MANAGER_PASSWORD=demo1234 \
 *   EMP_EMAIL=aylin.kaya@demo.clokr.de EMP_PASSWORD=demo1234 \
 *     node scripts/capture-screenshots.mjs --set handbuch --set readme
 *
 *   docker compose -f docker-compose.test.yml down -v
 *
 * Personas (packages/db/src/seed-demo.ts; every user shares the seed's one demo password, printed
 * by the seed when it finishes): admin@clokr.de = Admin, lena.vogel@ / jonas.berg@demo.clokr.de =
 * Manager, aylin.kaya@demo.clokr.de = Mitarbeiterin (SHIFT_BASED, so „Ich › Dienstplan“ shows
 * shifts). With the minimal seed instead: admin@clokr.de / max@clokr.de use the passwords of
 * packages/db/src/seed-credentials.ts and the pages stay mostly empty.
 * Output: docs/handbuch/bilder/*.png and images/screenshot-*.png. Review every PNG for personal
 * data before committing (only fictional demo persons, no non-demo e-mail address).
 *
 * ── Config (all via env vars, with defaults) ────────────────────────────────────────
 *   BASE_URL          default http://localhost:3000   (dev web server; the test stack is :3001)
 *   ADMIN_EMAIL       default admin@clokr.de
 *   ADMIN_PASSWORD    default admin1234               (the minimal seed's password)
 *   MANAGER_EMAIL     default: falls back to ADMIN_EMAIL (Admin has the team reach too)
 *   MANAGER_PASSWORD  default: falls back to ADMIN_PASSWORD
 *   EMP_EMAIL         default: falls back to ADMIN_EMAIL (a warning says so — the shots then
 *   EMP_PASSWORD      default: falls back to ADMIN_PASSWORD  show the admin's start pages)
 *   OUT_DIR           default docs/design/screenshots (design set only)
 *   HEADLESS          default true  (set HEADLESS=false to watch it run)
 *
 * NOTE: credentials are NEVER hardcoded to anything real — the demo creds are supplied
 * at runtime. The defaults above are the repo's generic test values.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

import { collectHandbuchNotes, validateNotes } from "./screenshot-notes.mjs";

// ── Resolve @playwright/test even though it lives in apps/e2e/node_modules ────────────
// This script sits at repo-root/scripts and is run with a bare `node`, so a plain
// `import "@playwright/test"` would not resolve from the repo root. We locate the module
// via createRequire against several candidate base dirs, then import its file URL.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

async function loadPlaywright() {
  const candidates = [
    join(REPO_ROOT, "apps", "e2e", "package.json"), // where @playwright/test is installed
    join(REPO_ROOT, "package.json"),
    join(process.cwd(), "package.json"),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(base);
      // @playwright/test is CommonJS — require() returns the object with `chromium`
      // directly. (A dynamic import() of a CJS file would hide it under `.default`.)
      const mod = req("@playwright/test");
      return mod;
    } catch {
      /* try next candidate */
    }
  }
  // Last resort: a bare specifier (works if the loader can resolve it directly).
  return import("@playwright/test");
}

const { chromium } = await loadPlaywright();

// ── Config ───────────────────────────────────────────────────────────────────────────
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "docs/design/screenshots";
const IMAGES_DIR = "images"; // README hero subset — fixed location & names
const HEADLESS = process.env.HEADLESS !== "false";

// ── Sets (--set <design|readme|handbuch>, repeatable) ─────────────────────────────────
const SET_NAMES = ["design", "readme", "handbuch"];
function parseSets(argv) {
  const sets = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg === "--set" ? argv[++i] : arg.startsWith("--set=") ? arg.slice(6) : null;
    if (value === null) {
      console.error(
        `Unknown argument "${arg}". Usage: node scripts/capture-screenshots.mjs [--set <${SET_NAMES.join("|")}>]...`,
      );
      process.exit(2);
    }
    if (!SET_NAMES.includes(value)) {
      console.error(`Unknown set "${value}" (expected one of ${SET_NAMES.join(", ")})`);
      process.exit(2);
    }
    if (!sets.includes(value)) sets.push(value);
  }
  // No flag keeps the behaviour from before the flag existed: design + readme.
  return sets.length ? sets : ["design", "readme"];
}
const SETS = parseSets(process.argv.slice(2));

function resolveCreds() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@clokr.de";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin1234";
  // Employee creds fall back to admin creds so the script still runs (admin can view the
  // employee-perspective pages), but a warning is printed so the operator knows the
  // "employee view" shots were captured as admin.
  const empEmail = process.env.EMP_EMAIL || adminEmail;
  const empPassword = process.env.EMP_PASSWORD || adminPassword;
  const empIsFallback = !process.env.EMP_EMAIL;
  // Manager creds fall back to admin creds: the Admin role has the team reach too, so the team
  // pages render; a real Manager persona only changes who the shot is "signed in" as.
  const managerEmail = process.env.MANAGER_EMAIL || adminEmail;
  const managerPassword = process.env.MANAGER_PASSWORD || adminPassword;
  const managerIsFallback = !process.env.MANAGER_EMAIL;
  return {
    adminEmail,
    adminPassword,
    managerEmail,
    managerPassword,
    managerIsFallback,
    empEmail,
    empPassword,
    empIsFallback,
  };
}

const CREDS = resolveCreds();

// Absolute output dirs (script is CWD-agnostic — resolve against repo root).
const OUT_DIR_ABS = resolve(REPO_ROOT, OUT_DIR);
const IMAGES_DIR_ABS = resolve(REPO_ROOT, IMAGES_DIR);
const DOCS_DIR_ABS = resolve(REPO_ROOT, "docs");
const HANDBUCH_DIR_ABS = join(DOCS_DIR_ABS, "handbuch"); // note `file` is relative to this folder
if (SETS.includes("design")) mkdirSync(OUT_DIR_ABS, { recursive: true });
if (SETS.includes("readme")) mkdirSync(IMAGES_DIR_ABS, { recursive: true });

// ── Viewports ─────────────────────────────────────────────────────────────────────────
const VP_DESKTOP = { width: 1440, height: 900 };
const VP_MOBILE = { width: 390, height: 844 };
const VP_README = { width: 1280, height: 800 };

// ── Route map ─────────────────────────────────────────────────────────────────────────
// Design set (31 shots). name → path → role → viewport → theme mode.
// Roles: "public" (no login), "emp" (employee perspective), "admin" (manager/admin).
// The employee-perspective shots (dashboard/time-entries/leave/settings) use `emp`
// because those screens are the personal-view hero surfaces; everything team/admin-wide
// uses `admin` (broadest access ⇒ most populated, least likely to 403 or be empty).
//
// The literal "01…31" index is reconstructed here from docs/design/README.md §5 (Screen
// specs) mapped onto the *real* SvelteKit routes under apps/web/src/routes/(app) and
// (auth). The README uses prototype route names (/time, /close, /compliance, /themes,
// /export …); the real routes differ and are used below.
const DESIGN_SHOTS = [
  // Public (captured logged-out, first)
  { name: "01-login", path: "/login", role: "public", vp: VP_DESKTOP },

  // Employee perspective
  { name: "02-dashboard", path: "/dashboard", role: "emp", vp: VP_DESKTOP },
  { name: "03-time-entries", path: "/time-entries", role: "emp", vp: VP_DESKTOP },
  { name: "04-leave", path: "/leave", role: "emp", vp: VP_DESKTOP },
  { name: "05-reports", path: "/reports", role: "emp", vp: VP_DESKTOP },
  { name: "06-settings", path: "/settings", role: "emp", vp: VP_DESKTOP },
  { name: "07-availability", path: "/availability", role: "emp", vp: VP_DESKTOP },

  // Manager / team
  { name: "08-inbox", path: "/inbox", role: "admin", vp: VP_DESKTOP },
  { name: "09-teamcal", path: "/teamcal", role: "admin", vp: VP_DESKTOP },
  { name: "10-team-time-entries", path: "/team/time-entries", role: "admin", vp: VP_DESKTOP },
  { name: "11-team-leave", path: "/team/leave", role: "admin", vp: VP_DESKTOP },
  { name: "12-shifts", path: "/shifts", role: "admin", vp: VP_DESKTOP },
  { name: "13-shifts-conflicts", path: "/shifts/conflicts", role: "admin", vp: VP_DESKTOP },

  // Admin — people
  { name: "14-employees", path: "/admin/employees", role: "admin", vp: VP_DESKTOP },
  // 15 employee-detail: id is discovered at runtime from the employees list (see EMP_DETAIL).
  { name: "15-employee-detail", path: "__EMP_DETAIL__", role: "admin", vp: VP_DESKTOP },

  // Admin — settings hub + tabs
  { name: "16-admin", path: "/admin", role: "admin", vp: VP_DESKTOP },
  { name: "17-admin-month-close", path: "/admin/month-close", role: "admin", vp: VP_DESKTOP },
  { name: "18-admin-audit", path: "/admin/audit", role: "admin", vp: VP_DESKTOP },
  { name: "19-admin-themes", path: "/ich/profil/erscheinungsbild", role: "admin", vp: VP_DESKTOP },
  { name: "20-admin-export", path: "/admin/export", role: "admin", vp: VP_DESKTOP },
  { name: "21-admin-integrations", path: "/admin/integrations", role: "admin", vp: VP_DESKTOP },
  { name: "22-admin-phorest", path: "/admin/phorest", role: "admin", vp: VP_DESKTOP }, // v1.9 new
  { name: "23-admin-vacation", path: "/admin/vacation", role: "admin", vp: VP_DESKTOP },
  { name: "24-admin-special-leave", path: "/admin/special-leave", role: "admin", vp: VP_DESKTOP },
  { name: "25-admin-shutdowns", path: "/admin/shutdowns", role: "admin", vp: VP_DESKTOP },
  { name: "26-admin-system", path: "/admin/system", role: "admin", vp: VP_DESKTOP },
  { name: "27-admin-import", path: "/admin/import", role: "admin", vp: VP_DESKTOP },

  // Public (logged-out)
  { name: "28-forgot-password", path: "/forgot-password", role: "public", vp: VP_DESKTOP },

  // Dark + mobile
  { name: "29-dashboard-dark", path: "/dashboard", role: "emp", vp: VP_DESKTOP, dark: true },
  { name: "30-dashboard-mobile", path: "/dashboard", role: "emp", vp: VP_MOBILE },
  { name: "31-time-entries-mobile", path: "/time-entries", role: "emp", vp: VP_MOBILE },
];

// README hero subset. name (fixed) → path → role. All 1280x800, full-page, light mode.
// v2 paths (redesign of #603): the old shot → the closest v2 page. The personal pages use the
// employee view (timer card, calendar and balances look best populated there); reports, the
// people list and the team start page use the manager/admin persona.
const README_SHOTS = [
  { name: "screenshot-dashboard", path: "/ich/tag", role: "emp" }, // was /dashboard
  { name: "screenshot-time-entries", path: "/ich/zeiten", role: "emp" }, // was /time-entries
  { name: "screenshot-leave", path: "/ich/abwesenheiten", role: "emp" }, // was /leave
  { name: "screenshot-reports", path: "/team/berichte", role: "manager" }, // was /reports
  { name: "screenshot-employees", path: "/verwalten/personen", role: "admin" }, // was /admin/employees
  { name: "screenshot-settings", path: "/ich/profil", role: "emp" }, // was /settings
];

// ── Result tracking ────────────────────────────────────────────────────────────────────
const results = []; // { name, set, status: "ok" | "fail", detail }
function record(set, name, status, detail = "") {
  results.push({ set, name, status, detail });
  const tag = status === "ok" ? "✓" : "✗";
  console.log(`  ${tag} [${set}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────

/**
 * Replicates the e2e login UI flow (apps/e2e/tests/helpers.ts):
 *   goto /login → fill E-Mail + Passwort → click "Anmelden" → wait for /dashboard.
 * Uses substring label matching (the real field label is "E-Mail-Adresse").
 */
async function login(page, email, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  // E-Mail field — label is "E-Mail-Adresse", match on the "E-Mail" substring.
  await page
    .getByLabel(/e-?mail/i)
    .first()
    .fill(email);
  // Password field — label is exactly "Passwort" (avoid the show/hide toggle aria-labels).
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: /anmelden/i }).click();
  // The landing page depends on the person (homeHref() in apps/web/src/lib/nav/routes.ts: Heute im
  // Salon, Verwalten or Mein Tag), so wait until the browser has left the sign-in pages instead.
  await page.waitForURL((url) => !/^\/(login|otp)(\/|$)/.test(url.pathname), { timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * Wait for layout to settle: networkidle + fonts loaded + no running animations,
 * bounded by a timeout so an always-animating page (live timer pulse) still proceeds.
 */
async function settle(page, timeout = 2500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page
    .waitForFunction(
      () => {
        if (document.fonts && document.fonts.status !== "loaded") return false;
        const anims = document.getAnimations?.() ?? [];
        // Ignore infinite/looping animations (timer pulse) — only block on finite ones.
        const blocking = anims.filter(
          (a) => a.playState === "running" && a.effect?.getTiming?.().iterations !== Infinity,
        );
        return blocking.length === 0;
      },
      null,
      { timeout },
    )
    .catch(() => {});
  // Small settle margin for chart.js canvases / entrance stagger.
  await page.waitForTimeout(600);
}

/** Navigate to an app path, tolerating client-side redirects. */
async function gotoApp(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page);
}

/** Set (or clear) dark mode via the app's own mechanism: localStorage `mode` + reload. */
async function setDarkMode(page, enabled) {
  await page.evaluate((on) => {
    if (on) localStorage.setItem("mode", "dark");
    else localStorage.setItem("mode", "light");
  }, enabled);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
}

/** Discover the first employee-detail URL from the /admin/employees list. */
async function discoverEmployeeDetailPath(page) {
  await gotoApp(page, "/admin/employees");
  const href = await page
    .locator('a[href^="/admin/employees/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  return href; // e.g. "/admin/employees/<id>" or null if list empty
}

async function capture(page, absPath) {
  await page.screenshot({ path: absPath, fullPage: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log("Clokr screenshots");
  console.log(`  SETS       : ${SETS.join(", ")}`);
  console.log(`  BASE_URL   : ${BASE_URL}`);
  if (SETS.includes("design")) console.log(`  OUT_DIR    : ${OUT_DIR_ABS}`);
  if (SETS.includes("readme")) console.log(`  IMAGES_DIR : ${IMAGES_DIR_ABS}`);
  if (SETS.includes("handbuch")) console.log(`  HANDBUCH   : ${join(HANDBUCH_DIR_ABS, "bilder")}`);
  console.log(`  ADMIN      : ${CREDS.adminEmail}`);
  console.log(
    `  MANAGER    : ${CREDS.managerEmail}${CREDS.managerIsFallback ? "  (fallback → ADMIN)" : ""}`,
  );
  console.log(
    `  EMP        : ${CREDS.empEmail}${CREDS.empIsFallback ? "  (fallback → ADMIN — set EMP_EMAIL/EMP_PASSWORD for a true employee view)" : ""}`,
  );
  console.log("");

  const browser = await chromium.launch({ headless: HEADLESS });

  // One context (and one page) per role. Login once per role.
  /** @type {Record<string, {ctx: any, page: any}>} */
  const sessions = {};

  // Light mode unless a shot flips it itself (the dark design shot writes localStorage `mode`).
  async function newLightContext() {
    const ctx = await browser.newContext({
      viewport: VP_DESKTOP,
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    await ctx.addInitScript(() => {
      if (localStorage.getItem("mode") === null) localStorage.setItem("mode", "light");
    });
    return ctx;
  }

  async function getSession(role) {
    if (role === "public") {
      if (!sessions.public) {
        const ctx = await newLightContext();
        sessions.public = { ctx, page: await ctx.newPage() };
      }
      return sessions.public;
    }
    if (sessions[role]) return sessions[role];
    const ctx = await newLightContext();
    const page = await ctx.newPage();
    const email = { admin: CREDS.adminEmail, manager: CREDS.managerEmail }[role] ?? CREDS.empEmail;
    const password =
      { admin: CREDS.adminPassword, manager: CREDS.managerPassword }[role] ?? CREDS.empPassword;
    try {
      await login(page, email, password);
    } catch (err) {
      console.error(`  ! login failed for role "${role}" (${email}): ${err.message}`);
      throw err;
    }
    sessions[role] = { ctx, page };
    return sessions[role];
  }

  // Resolve the runtime employee-detail path once (needs an admin session).
  let empDetailPath = null;
  if (SETS.includes("design")) {
    try {
      const { page } = await getSession("admin");
      empDetailPath = await discoverEmployeeDetailPath(page);
      if (!empDetailPath)
        console.warn("  ! No employee rows found — 15-employee-detail will be skipped.");
    } catch {
      console.warn("  ! Could not establish admin session for employee-detail discovery.");
    }
  }

  // ── Design set (OUT_DIR) ──────────────────────────────────────────────────────────
  if (SETS.includes("design")) console.log("\n── Design set → OUT_DIR ──");
  for (const shot of SETS.includes("design") ? DESIGN_SHOTS : []) {
    try {
      let path = shot.path;
      if (path === "__EMP_DETAIL__") {
        if (!empDetailPath) {
          record("design", shot.name, "fail", "no employee id discovered");
          continue;
        }
        path = empDetailPath;
      }

      const { page } = await getSession(shot.role);

      // Viewport for this shot (mobile shots differ from the context default).
      await page.setViewportSize(shot.vp);

      if (shot.role === "public") {
        await gotoApp(page, path);
      } else {
        await gotoApp(page, path);
      }

      // Dark shot: flip mode via app mechanism, then reload; reset afterwards.
      if (shot.dark) {
        await setDarkMode(page, true);
      }

      await settle(page);
      await capture(page, join(OUT_DIR_ABS, `${shot.name}.png`));
      record(
        "design",
        shot.name,
        "ok",
        `${path} @ ${shot.vp.width}x${shot.vp.height}${shot.dark ? " (dark)" : ""}`,
      );

      // Undo per-shot state so later captures in the same session are unaffected.
      if (shot.dark) await setDarkMode(page, false);
      if (shot.vp !== VP_DESKTOP) await page.setViewportSize(VP_DESKTOP);
    } catch (err) {
      record("design", shot.name, "fail", err.message);
      // Best-effort reset so a mid-shot failure doesn't poison the session.
      try {
        const { page } = sessions[shot.role] || {};
        if (page) {
          await page.setViewportSize(VP_DESKTOP);
          await page.evaluate(() => localStorage.setItem("mode", "light")).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }
  }

  // ── README hero subset (images/) ───────────────────────────────────────────────────
  if (SETS.includes("readme")) console.log("\n── README subset → images/ ──");
  for (const shot of SETS.includes("readme") ? README_SHOTS : []) {
    try {
      const { page } = await getSession(shot.role);
      await page.setViewportSize(VP_README);
      await gotoApp(page, shot.path);
      await settle(page);
      await capture(page, join(IMAGES_DIR_ABS, `${shot.name}.png`));
      record("readme", shot.name, "ok", `${shot.path} @ ${VP_README.width}x${VP_README.height}`);
      await page.setViewportSize(VP_DESKTOP);
    } catch (err) {
      record("readme", shot.name, "fail", err.message);
    }
  }

  // ── Handbuch set (docs/handbuch/bilder) ───────────────────────────────────────────────
  if (SETS.includes("handbuch")) {
    console.log("\n── Handbuch set → docs/handbuch/bilder ──");
    const notes = collectHandbuchNotes(DOCS_DIR_ABS);
    const problems = validateNotes(notes);
    if (problems.length) {
      for (const p of problems) console.error(`  ! ${p.page}:${p.line}: ${p.message}`);
      console.error("  ! Fix the capture notes first (see scripts/screenshot-notes.mjs).");
      await browser.close().catch(() => {});
      process.exit(2);
    }
    mkdirSync(join(HANDBUCH_DIR_ABS, "bilder"), { recursive: true });
    for (const note of notes) {
      const label = `${note.page}:${note.line} ${note.file}`;
      try {
        // Sign-in pages are shot logged out; every other note as the persona of its `role`.
        const isAuthPage = /^\/(login|forgot-password|reset-password)(\/|\?|$)/.test(note.url);
        const { page } = await getSession(isAuthPage ? "public" : note.role);
        await page.setViewportSize(VP_DESKTOP);
        await gotoApp(page, note.url);
        // The note names a page the persona may not open → the app redirects; refuse such a shot.
        const landed = new URL(page.url());
        const wanted = new URL(note.url, BASE_URL);
        if (landed.pathname !== wanted.pathname) {
          throw new Error(`redirected to ${landed.pathname} (role ${note.role} may not open it?)`);
        }
        const main = page.locator("main#main-content");
        await main.waitFor({ state: "visible", timeout: 10_000 });
        await settle(page);
        await main.screenshot({ path: join(HANDBUCH_DIR_ABS, note.file) });
        record("handbuch", note.file, "ok", `${note.url} as ${note.role}`);
      } catch (err) {
        record("handbuch", note.file, "fail", `${label}: ${err.message}`);
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────────────
  for (const s of Object.values(sessions)) {
    await s.ctx.close().catch(() => {});
  }
  await browser.close().catch(() => {});

  // ── Summary ─────────────────────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.status === "ok");
  const fail = results.filter((r) => r.status === "fail");
  console.log("\n────────────── Summary ──────────────");
  console.log(`  Captured : ${ok.length}`);
  console.log(`  Failed   : ${fail.length}`);
  if (fail.length) {
    console.log("  Failures:");
    for (const f of fail) console.log(`    - [${f.set}] ${f.name}: ${f.detail}`);
  }
  console.log("─────────────────────────────────────");

  // Non-zero exit if everything failed (likely stack down / bad creds); otherwise 0.
  process.exitCode = ok.length === 0 ? 1 : 0;
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
