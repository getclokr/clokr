// Issue #989: the write actions of the month-close and the team leave page are offered only to a caller
// who holds the permission the API checks for them. A source guard (the pages are not mounted in unit
// tests): each action's markup sits behind the matching `hasPermission` derivation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = resolve(process.cwd(), "src");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

describe("#989 write actions are permission-gated", () => {
  const monthPage = read("routes/(app)/admin/month-close/+page.svelte");
  const table = read("lib/components/admin/monatsabschluss/MonthStatusTable.svelte");
  const leavePage = read("routes/(app)/team/leave/+page.svelte");

  it("month close: close and unlock come from the month-close permissions", () => {
    expect(monthPage).toContain('hasPermission($authStore.user, "month-close:close:ZUGEWIESEN")');
    expect(monthPage).toContain('hasPermission($authStore.user, "month-close:unlock:ZUGEWIESEN")');
    expect(table).toMatch(/\{:else if canClose && \(ms\.status === "ready"/);
    expect(table).toMatch(/\{:else if canClose && selectedMonth !== null/);
    expect(table).toMatch(/\{:else if canUnlock && selectedMonth !== null/);
  });

  it("team leave: correct, attest, storno and create follow their permissions", () => {
    expect(leavePage).toContain('"leave-request:correct:ZUGEWIESEN"');
    expect(leavePage).toContain('"leave-request:attest:ZUGEWIESEN"');
    expect(leavePage).toMatch(/\{#if canCorrect\}/);
    expect(leavePage).toMatch(/\{#if canAttest && SICK_CODES/);
    expect(leavePage).toMatch(/\{#if mayCancelRequest\(/);
    // The team page files requests for OTHER persons only; a caller with just the own right uses /leave.
    expect(leavePage).toMatch(/\{:else if canCreateForOthers\}/);
    expect(leavePage).not.toContain("canCreateOwn");
  });

  it("an open request without decision right names who decides", () => {
    expect(leavePage).toContain("decider-hint");
  });
});
