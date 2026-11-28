// Issue #1095 — the Betriebsurlaub badge shows only for a row that carries the shutdown field.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import CompanyShutdownBadge from "../CompanyShutdownBadge.svelte";

describe("CompanyShutdownBadge", () => {
  it("shows Betriebsurlaub and the shutdown's name for a row with the field", () => {
    renderWithTheme(CompanyShutdownBadge, {
      row: {
        companyShutdownId: "sd1",
        companyShutdown: { id: "sd1", name: "Weihnachtsschließung" },
      },
    });
    const badge = screen.getByTestId("company-shutdown-badge");
    expect(badge.textContent).toContain("Betriebsurlaub");
    expect(screen.getByTestId("company-shutdown-badge-name").textContent).toBe(
      "Weihnachtsschließung",
    );
    expect(badge.getAttribute("title")).toBe("Betriebsurlaub: Weihnachtsschließung");
  });

  it("shows the word alone when the read carried the id without the name", () => {
    renderWithTheme(CompanyShutdownBadge, { row: { companyShutdownId: "sd1" } });
    expect(screen.getByTestId("company-shutdown-badge").textContent?.trim()).toBe("Betriebsurlaub");
    expect(screen.queryByTestId("company-shutdown-badge-name")).toBeNull();
  });

  it("renders nothing for a row without the field, even when its type text is the word", () => {
    renderWithTheme(CompanyShutdownBadge, {
      row: { companyShutdownId: null, companyShutdown: null, typeName: "Betriebsurlaub" } as never,
    });
    expect(screen.queryByTestId("company-shutdown-badge")).toBeNull();
  });
});
