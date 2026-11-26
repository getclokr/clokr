// Issue #992 — the create link leaves the address once the dialog is open.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { withoutLeaveCreateDeepLink } from "../create-deep-link";

describe("withoutLeaveCreateDeepLink (Issue #992)", () => {
  it("drops create, employeeId and date and keeps every other parameter", () => {
    const url = new URL(
      "http://localhost/team/abwesenheiten?tab=team&create=1&employeeId=0b9f8b4e-2d1a-4c3b-9a7e-5f6d7c8b9a0e&date=2026-12-01&zoom=monat",
    );
    const next = withoutLeaveCreateDeepLink(url);
    expect(next.searchParams.get("create")).toBeNull();
    expect(next.searchParams.get("employeeId")).toBeNull();
    expect(next.searchParams.get("date")).toBeNull();
    expect(next.searchParams.get("tab")).toBe("team");
    expect(next.searchParams.get("zoom")).toBe("monat");
    expect(next.pathname).toBe("/team/abwesenheiten");
    // the input is not mutated
    expect(url.searchParams.get("create")).toBe("1");
  });

  it("the page strips the link right after it opened the dialog", () => {
    const src = readFileSync(
      join(__dirname, "../../../routes/(app)/team/leave/+page.svelte"),
      "utf-8",
    );
    const open = src.indexOf("createModalOpen = true;");
    expect(open).toBeGreaterThan(-1);
    const strip = src.indexOf("replaceState(withoutLeaveCreateDeepLink(", open);
    expect(strip).toBeGreaterThan(open);
    expect(strip - open).toBeLessThan(200);
  });
});
