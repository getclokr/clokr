// Issue #291 — the day column of the SHIFT_BASED entry table used to be headed "Gesamtsaldo"
// with the title "Kumulierter Gesamtsaldo bis zu diesem Tag (§615)". Its value was
// `carryOverIn + balanceMinutes(day 1..D of the displayed month)` (month-saldo.ts), and
// `carryOverIn` came from the most recent CLOSED month's SaldoSnapshot — so months that were
// never closed were not in it. With three unclosed months the column showed +10:26 while the
// account's actual saldo was −70:12 (measured on a production tenant, 2026-09-21): two things
// called "Gesamtsaldo" on one screen, disagreeing by 80 hours. #291 therefore renamed the column
// „Saldo seit Abschluss“ and its tooltip said unclosed months are not in it.
//
// Issue #681 made that tooltip FALSE: the series now starts at the open-month carry-in and carries
// every unclosed month. Issue #1029 (owner) therefore reverses the #291 wording where it was named:
//  - Team › Zeiten has no cumulative column any more (no „Saldo seit Abschluss“): its list shows ONE
//    „Differenz“ column holding the server's day step (`balanceMinutes`), with `DAY_DIFF_TITLE`;
//    the running saldo is labelled „Gesamtsaldo bis zu diesem Tag“ in the cell tooltip and day view.
//  - Ich › Zeiten (SHIFT_BASED) keeps a running column, now named „Stand“, whose tooltip names the
//    carry from all previous months and no longer claims unclosed months are missing.
// The over-promising name „Gesamtsaldo“ as a column HEADER stays forbidden (#291).
//
// This reads two EXPLICIT file paths — it does not walk a tree — so it is `not-a-guard` for
// lint-guard-vacuity.ts and needs no input proof. It still fails loudly if either file moves,
// because readFileSync throws.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DAY_DIFF_TITLE } from "../day-saldo";

const WEB_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ICH = path.join(WEB_SRC, "routes/(app)/time-entries/+page.svelte");
const TEAM = path.join(WEB_SRC, "routes/(app)/team/time-entries/+page.svelte");
const PAGES = [ICH, TEAM] as const;

describe("day columns — the name matches what the column actually contains (#291, #681, #1029)", () => {
  it.each(PAGES)("%s never heads a column „Gesamtsaldo“ and keeps no #291 wording", (page) => {
    const source = readFileSync(page, "utf-8");
    expect(source).not.toContain(">Gesamtsaldo<");
    expect(source).not.toContain("Kumulierter Gesamtsaldo");
    expect(source).not.toContain("Saldo seit Abschluss");
    // #681: unclosed months ARE in the running series, so this claim must not come back.
    expect(source).not.toContain("Nicht abgeschlossene Vormonate sind darin nicht enthalten");
  });

  it("Team › Zeiten has one Differenz column with the day-step tooltip and no running column", () => {
    const source = readFileSync(TEAM, "utf-8");
    expect(source).toContain('label: "Differenz"');
    expect(source).toContain("title: DAY_DIFF_TITLE");
    expect(source).not.toContain('key: "saldo"');
    expect(DAY_DIFF_TITLE).toBe("So verändert dieser Tag den Gesamtsaldo.");
  });

  it("Ich › Zeiten names its SHIFT_BASED running column „Stand“ and says the carry is included", () => {
    const source = readFileSync(ICH, "utf-8");
    expect(source).toContain('label: "Stand"');
    expect(source).toContain("mit dem Übertrag aus allen Vormonaten");
  });
});
