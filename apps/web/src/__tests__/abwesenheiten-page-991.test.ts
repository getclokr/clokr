// Issue #991 (N-03, N-17 legend, N-18, N-19, M-40; D-991-16..20) — the Abwesenheiten page. A route
// page cannot be mounted (no `$app` alias), so its wording is pinned from the source, next to a
// mounted-free check of the pure hint helper and a scan that no request label still says
// „Ausstehend“.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { vacationTakenHint } from "$lib/leave/vacation-summary";
import { SRC_ROOT, walkFiles } from "./design-source-files";

function readRouteFile(relativeFromHere: string, relativeFromCwd: string): string {
  try {
    return readFileSync(fileURLToPath(new URL(relativeFromHere, import.meta.url)), "utf8");
  } catch {
    return readFileSync(resolve(process.cwd(), relativeFromCwd), "utf8");
  }
}

const PAGE = readRouteFile(
  "../routes/(app)/leave/+page.svelte",
  "src/routes/(app)/leave/+page.svelte",
);
const TASK_ROW = readRouteFile(
  "../lib/components/team/aufgaben/TaskRow.svelte",
  "src/lib/components/team/aufgaben/TaskRow.svelte",
);

// ── N-18: the „Genommen & genehmigt“ hint sees a waiting request ────────────────────────────────

const TODAY = "2026-11-26";
const req = (over: Partial<Record<string, string>>) => ({
  typeCode: "VACATION",
  status: "APPROVED",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  ...over,
});

describe("vacationTakenHint (D-991-18)", () => {
  it("names the next approved vacation ahead", () => {
    expect(vacationTakenHint([req({})], TODAY)).toBe("nächster: 1.12.–2.12.");
  });

  it("names a waiting request when no approved one is ahead", () => {
    expect(vacationTakenHint([req({ status: "PENDING" })], TODAY)).toBe(
      "beantragt: 1.12.–2.12., wartet auf Entscheidung",
    );
  });

  it("prints one date for a one-day range (#991)", () => {
    const day = { startDate: "2026-12-02", endDate: "2026-12-02" };
    expect(vacationTakenHint([req({ status: "PENDING", ...day })], TODAY)).toBe(
      "beantragt: 2.12., wartet auf Entscheidung",
    );
    expect(vacationTakenHint([req(day)], TODAY)).toBe("nächster: 2.12.");
  });

  it("an approved vacation beats a pending one, even a later one", () => {
    const rows = [
      req({ status: "PENDING", startDate: "2026-11-30", endDate: "2026-11-30" }),
      req({ startDate: "2026-12-14", endDate: "2026-12-18" }),
    ];
    expect(vacationTakenHint(rows, TODAY)).toBe("nächster: 14.12.–18.12.");
  });

  it("takes the earliest of several", () => {
    const rows = [
      req({ startDate: "2027-01-04", endDate: "2027-01-08" }),
      req({ startDate: "2026-12-14", endDate: "2026-12-18" }),
    ];
    expect(vacationTakenHint(rows, TODAY)).toBe("nächster: 14.12.–18.12.");
  });

  it("ignores past requests and other types", () => {
    const rows = [
      req({ startDate: "2026-10-01", endDate: "2026-10-05" }),
      req({ status: "PENDING", startDate: "2026-08-01", endDate: "2026-08-02" }),
      req({ typeCode: "SICK", status: "PENDING" }),
      req({ typeCode: "SPECIAL" }),
    ];
    expect(vacationTakenHint(rows, TODAY)).toBe("kein Urlaub geplant");
  });

  it("ignores rejected and cancelled requests", () => {
    const rows = [req({ status: "REJECTED" }), req({ status: "CANCELLED" })];
    expect(vacationTakenHint(rows, TODAY)).toBe("kein Urlaub geplant");
  });

  it("a cancellation request still counts as an effective leave", () => {
    expect(vacationTakenHint([req({ status: "CANCELLATION_REQUESTED" })], TODAY)).toBe(
      "nächster: 1.12.–2.12.",
    );
  });

  it("a request that starts today counts as ahead", () => {
    const rows = [req({ status: "PENDING", startDate: TODAY, endDate: "2026-11-27" })];
    expect(vacationTakenHint(rows, TODAY)).toBe(
      "beantragt: 26.11.–27.11., wartet auf Entscheidung",
    );
  });

  it("says „kein Urlaub geplant“ without any request", () => {
    expect(vacationTakenHint([], TODAY)).toBe("kein Urlaub geplant");
  });

  it("the page reads the hint from the helper", () => {
    expect(PAGE).toContain("vacationTakenHint(myRequests, today)");
    expect(PAGE).not.toContain('"kein Urlaub geplant"');
  });
});

// ── N-03: „Offen“ is the one word for a request that waits ──────────────────────────────────────

describe("„Offen“ for a request waiting for a decision (D-991-16)", () => {
  it("the status label, the status filter and the Aufgaben row say „Offen“", () => {
    expect(PAGE).toMatch(/s === "PENDING"\s*\?\s*"Offen"/);
    expect(PAGE).toContain('{ value: "PENDING", label: "Offen" }');
    expect(TASK_ROW).toContain('PENDING: { label: "Offen", tone: "warn" }');
  });

  // Phrases that contain „ausstehend“ and mean something else than a waiting request; each one is
  // allowed exactly, with its reason, so a new PENDING label cannot slip in under a broad pass.
  const ALLOWED: { phrase: string; reason: string }[] = [
    { phrase: "AU ausstehend", reason: "§ 9 case waits for the medical certificate (AU_PENDING)" },
    {
      phrase: "Urlaubsstornierung ausstehend",
      reason: "the reason an entry is invalid while a cancellation is pending",
    },
    { phrase: "Einladung ausstehend", reason: "invitation status of a person, not a request" },
  ];
  // The unused i18n bundle (I18N-01) keeps its legacy word; no importer outside lib/i18n.
  const ALLOWED_FILES = new Set(["lib/i18n/de.ts"]);

  it("no source line labels a waiting request „ausstehend“", () => {
    const sources = walkFiles(SRC_ROOT, [".svelte", ".ts"], { includeTests: false });
    expect(sources.length).toBeGreaterThan(300);
    const offenders: string[] = [];
    for (const file of sources) {
      if (ALLOWED_FILES.has(file.rel)) continue;
      file.text.split("\n").forEach((line, i) => {
        if (!/ausstehend/i.test(line)) return;
        const trimmed = line.trim();
        // A comment line is prose, not shown text.
        if (/^(\/\/|\/\*|\*|<!--)/.test(trimmed)) return;
        let rest = line;
        for (const a of ALLOWED) rest = rest.split(a.phrase).join("");
        if (/ausstehend/i.test(rest)) offenders.push(`${file.rel}:${i + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the scan flags a bare label (control)", () => {
    const line = '  PENDING: { label: "Ausstehend", tone: "warn" },';
    let rest = line;
    for (const a of ALLOWED) rest = rest.split(a.phrase).join("");
    expect(/ausstehend/i.test(rest)).toBe(true);
    const allowed = '  AU_PENDING: { label: "AU ausstehend", tone: "warn" },';
    rest = allowed;
    for (const a of ALLOWED) rest = rest.split(a.phrase).join("");
    expect(/ausstehend/i.test(rest)).toBe(false);
  });
});

// ── M-40: the toolbar shows the year while the own Planung has no plan ──────────────────────────

describe("Planung without a plan (D-991-20)", () => {
  it("the page tracks the panel's plan state and passes only the toolbar a year period", () => {
    expect(PAGE).toContain("onPlanState");
    expect(PAGE).toMatch(/planState/);
    expect(PAGE).toMatch(/toolbarPeriod/);
    expect(PAGE).toMatch(/period=\{toolbarPeriod\}/);
    // The panel keeps the page's own period, so no reload loop can start.
    const panel = PAGE.slice(PAGE.indexOf("<LeavePlanningPanel"));
    expect(panel.slice(0, panel.indexOf("/>"))).toContain("period={activePeriod}");
  });
});

describe("row menu trigger name (#991)", () => {
  it("the „…“ summary is an explicit button with an aria-label, so the name reaches assistive technology", () => {
    const at = PAGE.indexOf('class="lv-menu-btn"');
    expect(at).toBeGreaterThan(-1);
    const tag = PAGE.slice(at, PAGE.indexOf(">…</summary", at));
    expect(tag).toContain('role="button"');
    expect(tag).toContain('aria-label="Aktionen für');
  });
});
