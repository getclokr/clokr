// Phase 114 (RU-05) — the pinning proof for `apps/web/src/lib/leave/vacation-summary.ts`.
//
// Acceptance criterion RU-05 demands: "**Keine Berechnung wurde geändert.**
// `vacSummaryTotal/CarryOver/Used/Planned/Left` und der Kartenwert liefern exakt dieselben
// Zahlen wie vorher — nachzuweisen z. B. über einen Test, der die Werte gegen die bisherige
// Ableitung pinnt."
//
// That proof is discharged by the LEGACY oracle below: it re-implements the eight pre-Phase-114
// inline `$derived` expressions from `apps/web/src/routes/(app)/leave/+page.svelte` LITERALLY,
// copied character for character, and a table of cases asserts the new pure function deep-equals
// it. The oracle is deliberately NOT written in terms of `deriveVacationSummary` — that would
// make the comparison a tautology. If the oracle and the module ever disagree, the MODULE is
// wrong; never "fix" the oracle to match.
//
// Issue #1109 (owner decision 28.11.2026) changed the MEANING of „Resturlaub“, so these expectations
// changed and nothing else: `left` (total + carryOver - used - planned) became `free`, the figure the
// card, Mein Tag, Ich › Konto and the dialog show, and it is `null` without a balance (it was 0);
// the old `remaining` (before pending) became `remainingBeforePending`; `planned` comes with the
// balance (`balance.pending`, the facade's pendingDays) instead of a second argument. The oracle's
// arithmetic is untouched and still compared literally — `free` of a facade-consistent balance must
// equal the old `left` for every case below — and every case, every exact value and the null
// contract stay as strict as before.
//
// Same convention as its sibling `vacation-balance.test.ts`: plain function calls, no component
// mount (no test in `apps/web` has ever mounted a route page), `describe`/`it`/`expect` imported
// explicitly because `vitest.config.ts` sets `globals: false`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { mapVacationBalance } from "../vacation-balance";
import type { VacationBalance } from "../vacation-balance";
import {
  deriveVacationSummary,
  vacationCardDelta,
  vacationPendingLine,
  VAC_CARD_LABEL,
  type VacationSummary,
} from "../vacation-summary";

// fileURLToPath decodes the %28/%29 that the "(app)" route group produces in import.meta.url.
const PAGE_URL = new URL("../../../routes/(app)/leave/+page.svelte", import.meta.url);
let PAGE: string;
try {
  PAGE = readFileSync(fileURLToPath(PAGE_URL), "utf8");
} catch {
  // Fallback: `pnpm --filter @clokr/web test` runs with cwd `apps/web`.
  PAGE = readFileSync(resolve(process.cwd(), "src/routes/(app)/leave/+page.svelte"), "utf8");
}

// Phase 415 (#415): `loadBalanceForType` — the "SECOND writer" the block below used to find on
// this same page — moved into the shared `lib/components/leave/LeaveRequestForm.svelte` and no
// longer shares state with `loadVacationSummary` at all (the two are now independent reads of
// the same endpoint, by design — see that component's own doc comment). It is still year-scoped,
// just via its own `entitlementYear` prop instead of the page's `calYear`.
const SHARED_FORM_URL = new URL("../../components/leave/LeaveRequestForm.svelte", import.meta.url);
let SHARED_FORM: string;
try {
  SHARED_FORM = readFileSync(fileURLToPath(SHARED_FORM_URL), "utf8");
} catch {
  SHARED_FORM = readFileSync(
    resolve(process.cwd(), "src/lib/components/leave/LeaveRequestForm.svelte"),
    "utf8",
  );
}

/** Same slicing idiom as `fnBody`, against the shared component instead of the page. */
function sharedFormFnBody(marker: string): string {
  const start = SHARED_FORM.indexOf(marker);
  expect(start, `marker not found in LeaveRequestForm.svelte: ${marker}`).toBeGreaterThan(-1);
  const end = SHARED_FORM.indexOf("\n  }", start);
  expect(end, `unterminated function: ${marker}`).toBeGreaterThan(start);
  return SHARED_FORM.slice(start, end);
}

/** The body of one top-level function of `leave/+page.svelte`, from its declaration to the
 *  two-space-indented `}` that closes it. Slicing keeps each assertion inside the function it
 *  is about, so a match elsewhere on this 2700-line page cannot make a broken wiring look fixed. */
function fnBody(marker: string): string {
  const start = PAGE.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const end = PAGE.indexOf("\n  }", start);
  expect(end, `unterminated function: ${marker}`).toBeGreaterThan(start);
  return PAGE.slice(start, end);
}

/** Build a `VacationBalance` from the four numbers that actually drive the arithmetic.
 *  `provisionalUsed`, `carryOverDeadline`, `section9Movements` and `exitOverUseWarningMessage`
 *  play no part in any of the eight formulas — they are carried only so the fixture is a real
 *  `VacationBalance`. */
function balance(total: number, used: number, carryOver: number, pending = 0): VacationBalance {
  return {
    total,
    used,
    provisionalUsed: 0,
    carryOver,
    carryOverDeadline: null,
    section9Movements: [],
    exitOverUseWarningMessage: null,
    carryOverKeptWithoutNotice: 0,
    // Issue #1109: what the Resturlaub facade delivers — `freeDays` is always remaining minus pending.
    pending,
    free: total + carryOver - used - pending,
  };
}

// ── The LEGACY oracle: the eight formulas exactly as they read before Phase 114 ─────────────
//
// Six from `leave/+page.svelte:992-999`:
//   let vacSummaryTotal = $derived(vacationBalance?.total ?? 0);
//   let vacSummaryCarryOver = $derived(vacationBalance?.carryOver ?? 0);
//   let vacSummaryUsed = $derived(vacationBalance?.used ?? 0);
//   let vacSummaryPlanned = $derived(pendingVacDays);
//   let vacSummaryCarryOverRemaining = $derived(Math.max(0, vacSummaryCarryOver - vacSummaryUsed));
//   let vacSummaryLeft = $derived(
//     vacSummaryTotal + vacSummaryCarryOver - vacSummaryUsed - vacSummaryPlanned,
//   );
// the seventh from `:919-923` — note the `null`, not `0`:
//   let vacRemaining = $derived(
//     vacationBalance
//       ? vacationBalance.total + vacationBalance.carryOver - vacationBalance.used
//       : null,
//   );
// and the eighth inlined in the card's `delta` prop at `:1146-1147`:
//   delta={vacationBalance
//     ? `von ${vacationBalance.total + vacationBalance.carryOver} verfügbar`
//     : undefined}
function LEGACY(vacationBalance: VacationBalance | null): VacationSummary {
  // The pre-#1109 second argument is the balance's own pending days now.
  const pendingVacDays = vacationBalance?.pending ?? 0;
  const vacSummaryTotal = vacationBalance?.total ?? 0;
  const vacSummaryCarryOver = vacationBalance?.carryOver ?? 0;
  const vacSummaryUsed = vacationBalance?.used ?? 0;
  const vacSummaryPlanned = pendingVacDays;
  const vacSummaryCarryOverRemaining = Math.max(0, vacSummaryCarryOver - vacSummaryUsed);
  const vacSummaryLeft = vacSummaryTotal + vacSummaryCarryOver - vacSummaryUsed - vacSummaryPlanned;
  const vacRemaining = vacationBalance
    ? vacationBalance.total + vacationBalance.carryOver - vacationBalance.used
    : null;
  // The card's delta line interpolated `total + carryOver`; the number inside it is what
  // `availableTotal` must reproduce, and it was absent (`undefined` delta) without a balance.
  const cardAvailableTotal = vacationBalance
    ? vacationBalance.total + vacationBalance.carryOver
    : null;
  return {
    total: vacSummaryTotal,
    carryOver: vacSummaryCarryOver,
    used: vacSummaryUsed,
    planned: vacSummaryPlanned,
    carryOverRemaining: vacSummaryCarryOverRemaining,
    // #1109: the old `left`, now `free`; `null` without a balance (the old 0 never reached a screen).
    free: vacationBalance ? vacSummaryLeft : null,
    remainingBeforePending: vacRemaining,
    availableTotal: cardAvailableTotal,
  };
}

describe("deriveVacationSummary — the issue #117 scenario, pinned exactly", () => {
  it("reproduces every number the issue tabulates, plus the 38 and the free days of #1109", () => {
    const summary = deriveVacationSummary(balance(24, 31, 14, 3));
    expect(summary).toEqual({
      total: 24,
      carryOver: 14,
      used: 31,
      planned: 3,
      carryOverRemaining: 0, // max(0, 14 - 31)
      free: 4, // 24 + 14 - 31 - 3 — the one Resturlaub figure, beantragte subtracted (#1109)
      remainingBeforePending: 7, // 38 - 31 — the former card value, beantragte NOT subtracted
      availableTotal: 38, // 24 + 14
    });
  });
});

// ── RU-05: the legacy-oracle table ──────────────────────────────────────────────────────────
describe("deriveVacationSummary vs. the legacy inline derivations", () => {
  const cases: Array<{
    name: string;
    total: number;
    used: number;
    carryOver: number;
    planned: number;
  }> = [
    { name: "issue #117 scenario", total: 24, used: 31, carryOver: 14, planned: 3 },
    { name: "no carry-over at all", total: 30, used: 5, carryOver: 0, planned: 0 },
    {
      name: "carryOver > used, so carryOverRemaining is 9",
      total: 20,
      used: 5,
      carryOver: 14,
      planned: 2,
    },
    { name: "free goes negative (-8)", total: 20, used: 25, carryOver: 0, planned: 3 },
    { name: "all zero", total: 0, used: 0, carryOver: 0, planned: 0 },
    {
      name: "used exactly equals carryOver, so carryOverRemaining is 0",
      total: 24,
      used: 14,
      carryOver: 14,
      planned: 0,
    },
    { name: "half-days", total: 25.5, used: 3.5, carryOver: 2.5, planned: 1 },
  ];

  it.each(cases)(
    "$name: deep-equals the literal re-implementation of the old formulas",
    ({ total, used, carryOver, planned }) => {
      const b = balance(total, used, carryOver, planned);
      expect(deriveVacationSummary(b)).toEqual(LEGACY(b));
    },
  );

  it("does not clamp `free` — it may be negative", () => {
    const b = balance(20, 25, 0, 3);
    expect(deriveVacationSummary(b).free).toBe(-8);
    expect(deriveVacationSummary(b).free).toBe(LEGACY(b).free);
  });

  it("does clamp `carryOverRemaining` at 0", () => {
    const b = balance(24, 31, 14, 3);
    expect(deriveVacationSummary(b).carryOverRemaining).toBe(0);
    // and it is NOT the raw -17 the subtraction would give
    expect(deriveVacationSummary(b).carryOverRemaining).not.toBe(-17);
  });

  it("keeps half-day arithmetic exactly as the old expressions produced it", () => {
    const b = balance(25.5, 3.5, 2.5, 1);
    const summary = deriveVacationSummary(b);
    expect(summary.remainingBeforePending).toBe(24.5); // 25.5 + 2.5 - 3.5
    expect(summary.availableTotal).toBe(28); // 25.5 + 2.5
    expect(summary.free).toBe(23.5); // 28 - 3.5 - 1
    expect(summary).toEqual(LEGACY(b));
  });
});

// ── Issue #1109: ONE Resturlaub number, from the server ────────────────────────────────────────
describe("deriveVacationSummary — `free` is the server's figure, passed through (Issue #1109)", () => {
  it("takes `free` from the balance and does not subtract the pending days a second time", () => {
    // A balance whose `free` is NOT what total + carryOver - used - pending would give: the
    // summary must show the server's number, never its own arithmetic.
    const b: VacationBalance = { ...balance(24, 31, 14, 3), free: 11 };
    expect(deriveVacationSummary(b).free).toBe(11);
  });

  it("equals the figure of every other screen: Konto and the card read the same summary", () => {
    const b = balance(30, 4, 0, 2.5);
    expect(deriveVacationSummary(b).free).toBe(23.5);
    expect(deriveVacationSummary(b).planned).toBe(2.5);
  });

  it("is the figure before pending only in `remainingBeforePending`, which is no Resturlaub", () => {
    const summary = deriveVacationSummary(balance(30, 4, 0, 2.5));
    expect(summary.remainingBeforePending).toBe(26);
    expect(summary.free).not.toBe(summary.remainingBeforePending);
  });

  it("with no pending requests both figures agree", () => {
    const summary = deriveVacationSummary(balance(30, 4, 0, 0));
    expect(summary.free).toBe(summary.remainingBeforePending);
  });
});

describe("mapVacationBalance — carries the facade's pending and free days (Issue #1109)", () => {
  const row = (vb?: { pendingDays?: number; freeDays?: number } | null) => ({
    typeCode: "VACATION",
    leaveType: { name: "Urlaub" },
    totalDays: 30,
    usedDays: 4,
    carriedOverDays: 0,
    effectiveCarryOverDays: 0,
    carryOverDeadline: null,
    vacationBalance: vb,
  });

  it("reads pendingDays and freeDays of the facade block", () => {
    const mapped = mapVacationBalance(row({ pendingDays: 2.5, freeDays: 23.5 }));
    expect(mapped?.pending).toBe(2.5);
    expect(mapped?.free).toBe(23.5);
  });

  it("falls back to the figure before pending, and no pending days, without a facade block", () => {
    const mapped = mapVacationBalance(row(undefined));
    expect(mapped?.pending).toBe(0);
    expect(mapped?.free).toBe(26);
  });
});

// ── The `null` contract — this is what keeps the card rendering "–" ─────────────────────────
describe("deriveVacationSummary with no balance", () => {
  it("returns 0 for the six summary fields (the strip renders zeros, as before)", () => {
    const summary = deriveVacationSummary(null);
    expect(summary.total).toBe(0);
    expect(summary.carryOver).toBe(0);
    expect(summary.used).toBe(0);
    expect(summary.planned).toBe(0);
    expect(summary.carryOverRemaining).toBe(0);
  });

  it("returns `free: null`, NOT 0 — if this became 0 the Urlaubskonto card would show a fake '0' instead of the en-dash placeholder", () => {
    expect(deriveVacationSummary(null).free).toBeNull();
    expect(deriveVacationSummary(null).remainingBeforePending).toBeNull();
  });

  it("returns `availableTotal: null`, NOT 0 — if this became 0 the card would render a breakdown line for a balance it does not have", () => {
    expect(deriveVacationSummary(null).availableTotal).toBeNull();
  });

  it("matches the legacy oracle for a null balance too", () => {
    expect(deriveVacationSummary(null)).toEqual(LEGACY(null));
  });
});

describe("deriveVacationSummary — `planned` passes straight through", () => {
  it("is neither clamped nor rounded nor year-filtered (the facade's pendingDays is already year-scoped)", () => {
    expect(deriveVacationSummary(balance(24, 0, 0, 0.5)).planned).toBe(0.5);
    expect(deriveVacationSummary(balance(24, 0, 0, 99)).planned).toBe(99);
    // Negative input is nonsense but must not be silently swallowed — the old
    // `$derived(pendingVacDays)` did nothing to it either.
    expect(deriveVacationSummary(balance(24, 0, 0, -1)).planned).toBe(-1);
  });
});

describe("deriveVacationSummary — purity", () => {
  it("does not mutate its input balance object", () => {
    const b = balance(24, 31, 14, 3);
    const before: VacationBalance = JSON.parse(JSON.stringify(b));
    deriveVacationSummary(b);
    expect(b).toEqual(before);
  });
});

// ── Urlaubskonto-Karte: deutsche Beschriftung ──────────────────────────────────────────────
// Exact-string assertions on purpose. These four strings ARE the fix for issue #117 — a
// `toContain` would let a future edit reintroduce the ambiguity the phase removed.

describe("Resturlaub label and pending line (Issue #1109)", () => {
  it("the label is the constant `Resturlaub`, with and without pending requests", () => {
    // The big number is the same free-days figure either way, so no qualifier is needed. The
    // retired `Resturlaub (ohne beantragte)` described a number that left the pending days out.
    expect(VAC_CARD_LABEL).toBe("Resturlaub");
    expect(VAC_CARD_LABEL).not.toContain("ohne beantragte");
  });

  it("NEVER names the Übertrag — the label means the free days and nothing else", () => {
    // This is the assertion that catches a future edit re-merging the two meanings that
    // issue #117 reported as colliding under one heading.
    expect(VAC_CARD_LABEL).not.toContain("Übertrag");
  });

  it("names the pending days under the figure: `davon 3 Tage beantragt`", () => {
    expect(vacationPendingLine(3)).toBe("davon 3 Tage beantragt");
  });

  it("says `1 Tag` for exactly one pending day, never `1 Tage`", () => {
    expect(vacationPendingLine(1)).toBe("davon 1 Tag beantragt");
    expect(vacationPendingLine(1)).not.toContain("1 Tage");
  });

  it("words half days with the German decimal comma and the plural", () => {
    expect(vacationPendingLine(0.5)).toBe("davon 0,5 Tage beantragt");
    expect(vacationPendingLine(2.5)).toBe("davon 2,5 Tage beantragt");
  });

  it("says nothing without pending days", () => {
    expect(vacationPendingLine(0)).toBeNull();
    expect(vacationPendingLine(-1)).toBeNull();
  });
});

describe("vacationCardDelta", () => {
  it("breaks the sum down when there is a Vorjahresübertrag (RU-04)", () => {
    expect(vacationCardDelta(24, 14)).toBe("von 38 gesamt (24 Anspruch + 14 Übertrag Vorjahr)");
  });

  it("stays a plain total when there is no Übertrag — nothing to break down", () => {
    expect(vacationCardDelta(24, 0)).toBe("von 24 gesamt");
  });

  it("renders half-days with the German decimal comma (Issue #853-19: the one day number format)", () => {
    expect(vacationCardDelta(25.5, 2.5)).toBe(
      "von 28 gesamt (25,5 Anspruch + 2,5 Übertrag Vorjahr)",
    );
  });

  it("rounds a float sum instead of printing it (0.1 + 0.2 carry-over)", () => {
    expect(vacationCardDelta(24, 0.1 + 0.2)).toBe(
      "von 24,3 gesamt (24 Anspruch + 0,3 Übertrag Vorjahr)",
    );
  });

  it("NEVER says `verfügbar` — that word labelled the 38 while the card's own value was 7", () => {
    expect(vacationCardDelta(24, 14)).not.toContain("verfügbar");
    expect(vacationCardDelta(24, 0)).not.toContain("verfügbar");
    expect(vacationCardDelta(25.5, 2.5)).not.toContain("verfügbar");
  });

  it("shows Anspruch and Übertrag as SEPARATE numbers whenever the Übertrag is > 0 (RU-03)", () => {
    // „Genommen 31 bei Anspruch 24" must resolve without the reader doing arithmetic.
    const delta = vacationCardDelta(24, 14);
    expect(delta).toContain(String(24));
    expect(delta).toContain(String(14));
    expect(delta).toContain("Übertrag Vorjahr");
  });
});

// ── Phase 117 (GitHub issue #122): the tiles' year IS the heading's year ─────────────────────
//
// Phase 114 recorded this defect as deferred item #1 and worked AROUND it — it is the reason no
// year appears in any tile label (`leave-page-vocabulary.test.ts:141`). What nothing asserted was
// the relationship itself: `loadVacationSummary()` hardcoded `new Date().getFullYear()` and was
// never called when the selector moved, so `Anspruch`/`Übertrag`/`Genommen` showed the current
// year under a heading naming another one, while `Beantragt` (fetched as
// `/leave/requests?year=${calYear}`) followed correctly and `Verbleibend` mixed the two.
//
// Two of these blocks read the PAGE SOURCE. That is deliberate and it is not a new harness: it is
// the same `readFileSync` technique `leave-page-vocabulary.test.ts` already uses, for the same
// reason — `apps/web/vitest.config.ts` declares no `$app/*` alias, so no route page in this repo
// can be mounted under vitest, and the thing under test here is a wiring decision that lives in
// the component, not in a pure function. The other two blocks pin the pure half at the seam
// Phase 114 built.

describe("loadVacationSummary fetches the SELECTED year (issue #122)", () => {
  it("takes the year as a REQUIRED parameter — a forgotten argument must be a compile error", () => {
    expect(PAGE).toContain("async function loadVacationSummary(year: number)");
  });

  it("has no wall-clock fallback left in either entitlement fetch", () => {
    // This exact line existed TWICE (loadVacationSummary and loadBalanceForType's VACATION
    // branch) and is the whole defect. `?? calYear`, a default parameter, or any other
    // reinstatement of "heute" would put it back in a new costume. `loadBalanceForType` moved to
    // the shared component in Phase 415 — checked there too.
    expect(PAGE).not.toContain("const year = new Date().getFullYear();");
    expect(SHARED_FORM).not.toContain("const year = new Date().getFullYear();");
  });

  it("interpolates the parameter into the entitlements URL", () => {
    const body = fnBody("async function loadVacationSummary(");
    expect(body).toContain("/leave/entitlements/${userId}?year=${year}");
    expect(body).not.toContain("new Date(");
  });

  it("year-scopes the shared dialog's own entitlements fetch too (Phase 415)", () => {
    // Phase 415 (#415): `loadBalanceForType("VACATION")` no longer assigns the PAGE's
    // `vacationBalance` — it lives in `LeaveRequestForm.svelte` now, with its OWN state,
    // independent of the tiles' writer (`loadVacationSummary` above). Left on the wall-clock
    // year regardless, it would show the wrong year's Resturlaub whenever the dialog opens while
    // viewing a different `calYear` — the same class of bug, in the new location.
    const body = sharedFormFnBody("async function loadBalanceForType(");
    expect(body).toContain("/leave/entitlements/${forEmployeeId}?year=${year}");
    expect(body).not.toContain("new Date(");
  });

  it("drops a superseded in-flight response instead of letting it overwrite a newer one", () => {
    const body = fnBody("async function loadVacationSummary(");
    expect(body).toContain("if (year !== calYear) return;");
    expect(body).toContain("if (year === calYear) vacSummaryLoading = false;");
  });
});

describe("every year-changing path reloads the figures (D-02, issue #122)", () => {
  // #840 (D-840-13, E-01): the six navigation functions this block used to pin (`prevMonth`,
  // `nextMonth`, `gotoMonthYear`, `gotoToday`, `prevYear`, `nextYear`) went with the page's own
  // month and year bars: the one toolbar writes the URL, and the viewed year is the year of the
  // URL's anchor day. The invariant is the same - NO path changes the year without reloading the
  // figures - and is now held structurally: `calYear` cannot be assigned (it is derived), and the
  // one effect that reacts to it reloads the list, the sick days and the entitlement tiles.
  it("calYear is derived from the URL anchor day and never assigned", () => {
    expect(PAGE).toContain("const calYear = $derived(Number(urlState.datum.slice(0, 4)));");
    expect(PAGE).not.toMatch(/(^|[^\w$.])calYear\s*(\+\+|--|\+=|-=)/m);
    expect(PAGE).not.toMatch(/^\s*calYear\s*=[^=]/m);
    // The old assigning navigation is gone.
    for (const gone of ["function prevMonth(", "function nextYear(", "function gotoMonthYear("]) {
      expect(PAGE).not.toContain(gone);
    }
  });

  it("the one effect on calYear reloads the request list and the entitlement tiles", () => {
    const at = PAGE.indexOf("void calYear;");
    expect(at).toBeGreaterThan(-1);
    const effect = PAGE.slice(at, PAGE.indexOf("\n  });", at));
    expect(effect).toContain("await loadData();");
    expect(effect).toContain("loadVacationSummary(calYear)");
    // loadData() starts the sick-day read for the same year.
    expect(fnBody("async function loadData(")).toContain("loadSickDaysYear(calYear)");
  });

  it("has no zero-argument call left anywhere on the page", () => {
    expect(PAGE).not.toContain("loadVacationSummary()");
  });

  it("passes calYear at both call sites (the year effect and the post-write reload)", () => {
    expect((PAGE.match(/loadVacationSummary\(calYear\)/g) ?? []).length).toBe(2);
    expect(fnBody("async function reloadAll(")).toContain("loadVacationSummary(calYear)");
  });

  it("shows a loading state instead of the previous year's numbers while refetching (D-03)", () => {
    expect(PAGE).toContain("let vacSummaryLoading = $state(true)");
    // #851: the figures live in the Kennzahlenleiste; while the year's balance is being fetched
    // (`vacationBalance = null` first), every vacation cell reads „–“, never the left year's value.
    expect(fnBody("async function loadVacationSummary(")).toContain("vacationBalance = null;");
    // #928: Resturlaub is the one big figure of the balance block, the other figures its quiet
    // facts. While the year's balance is being fetched every figure still reads „–“ (or is not
    // shown at all), never the left year's value; the day figures still go through formatDays.
    expect(PAGE).toContain('{vacRemaining === null ? "–" : formatDays(vacRemaining)}');
    const items = PAGE.slice(PAGE.indexOf("let balanceItems = $derived<KpiItem[]>(["));
    expect(items).toContain(
      'value: vacationBalance ? vacSummaryUsed : "–",\n      format: formatDays,',
    );
    // „Verfällt“ only exists while a balance is loaded and a carry-over is at risk.
    expect(items).toMatch(
      /\.\.\.\(vacationBalance && carryDeadlineAhead && vacSummaryCarryOverRemaining > 0\s+\?\s+\[\s+\{\s+label: "Verfällt",\s+value: vacSummaryCarryOverRemaining,\s+format: formatDays,/,
    );
    // The bar under the figure is drawn only from a loaded balance.
    expect(PAGE).toContain("if (!vacationBalance) return null;");
  });
});

describe("one response, one year — no tile value survives a year switch (issue #122)", () => {
  // The reported symptom: Anspruch/Übertrag/Genommen from 2026 next to Beantragt from 2025,
  // with Verbleibend silently mixing them. These fixtures are chosen so that EVERY derived
  // field differs between the two years — if any one of them could be carried over from the
  // previous response, this test names it.
  const Y2025 = balance(30, 28, 5, 2);
  const Y2026 = balance(24, 3, 14, 2);

  it("derives every figure from the balance it was handed, and nothing else", () => {
    const a = deriveVacationSummary(Y2025);
    const b = deriveVacationSummary(Y2026);
    expect(a).toEqual({
      total: 30,
      carryOver: 5,
      used: 28,
      planned: 2,
      carryOverRemaining: 0,
      free: 5, // 30 + 5 - 28 - 2
      remainingBeforePending: 7,
      availableTotal: 35,
    });
    expect(b).toEqual({
      total: 24,
      carryOver: 14,
      used: 3,
      planned: 2,
      carryOverRemaining: 11,
      free: 33, // 24 + 14 - 3 - 2
      remainingBeforePending: 35,
      availableTotal: 38,
    });
    for (const key of [
      "total",
      "carryOver",
      "used",
      "carryOverRemaining",
      "free",
      "remainingBeforePending",
      "availableTotal",
    ] as const) {
      expect(a[key], `${key} must not be shared between the two years`).not.toBe(b[key]);
    }
  });

  it("`planned` is the viewed year's own pending days — it comes with the balance, not from a second list", () => {
    expect(deriveVacationSummary(balance(30, 28, 5, 2)).planned).toBe(2);
    expect(deriveVacationSummary(balance(24, 3, 14, 0)).planned).toBe(0);
  });
});

describe("a year without an entitlement row (D-04)", () => {
  it("renders zeros and the card's en-dash, never another year's numbers", () => {
    // The API returns no VACATION row for that year -> `.find()` yields undefined ->
    // mapVacationBalance -> null -> the strip's six zeros and `free === null`, which is
    // what makes the Urlaubskonto-Karte render „–". A fallback to a different year would be
    // the reported mixing defect in a new form; there is deliberately none.
    const noRow = mapVacationBalance(undefined);
    expect(noRow).toBeNull();
    const summary = deriveVacationSummary(noRow);
    expect(summary).toEqual({
      total: 0,
      carryOver: 0,
      used: 0,
      planned: 0,
      carryOverRemaining: 0,
      free: null,
      remainingBeforePending: null,
      availableTotal: null,
    });
  });
});
