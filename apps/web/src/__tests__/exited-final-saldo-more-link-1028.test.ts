// Issue #1028 - the „und N weitere“ line of Berichte › „Ausgetreten, offener Endsaldo“ is a link to
// Verwalten › Personen (all statuses) for a reader who may open that page, plain text otherwise. The
// server bounds this table (#613), so the rest is not a list of this page but of the person list.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";

const { mayOpen } = vi.hoisted(() => ({ mayOpen: vi.fn((..._args: unknown[]) => false) }));
vi.mock("$lib/nav/routes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/nav/routes")>()),
  mayOpenPath: mayOpen,
}));

import { renderWithTheme } from "$tests/test-utils";
import ExitedFinalSaldoSection from "$lib/components/reports/ExitedFinalSaldoSection.svelte";
import type { ExitedOverviewRow } from "$lib/reports/overtime-overview-sections";

function row(n: number): ExitedOverviewRow {
  return {
    id: `id-${n}`,
    name: `Person Nr${n}`,
    employeeNumber: `N-${n}`,
    exitDate: "2026-10-15",
    exitedWithOpenFinalSaldo: true,
    balanceHours: 2,
    confirmedMinutes: 120,
    openMonthMinutes: 0,
    hasClosedMonth: true,
    unconfirmedMonths: 3,
  };
}

afterEach(() => cleanup());

describe("ExitedFinalSaldoSection - the „weitere“ line (Issue #1028)", () => {
  it("is a link to Verwalten › Personen with every status when the reader may open it", () => {
    mayOpen.mockReturnValue(true);
    renderWithTheme(ExitedFinalSaldoSection, {
      rows: Array.from({ length: 50 }, (_, i) => row(i)),
      total: 52,
    });
    const link = screen.getByRole("link", { name: "und 2 weitere" });
    expect(link.getAttribute("href")).toBe("/verwalten/personen?status=alle");
    expect(mayOpen.mock.calls.at(-1)?.[1]).toBe("/verwalten/personen");
  });

  it("stays plain text when the reader may not open the page", () => {
    mayOpen.mockReturnValue(false);
    renderWithTheme(ExitedFinalSaldoSection, {
      rows: Array.from({ length: 50 }, (_, i) => row(i)),
      total: 52,
    });
    expect(screen.queryByRole("link", { name: "und 2 weitere" })).toBeNull();
    expect(screen.getByTestId("exited-more")).toHaveTextContent("und 2 weitere");
  });
});
