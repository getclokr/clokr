// Issue #849 (2) — the self-test read "1 – 18 von 14 Einträge · Seite 1 von 2" under the dashboard's
// Team-Wochenübersicht (14 rows, 10 per page). The range must never pass the total: 1–10 on page 1,
// 11–14 on page 2. This pins the count text the dashboard passes `teamWeek.team.length` into.
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import Pagination from "../Pagination.svelte";

// Issue #1028 re-target, with reason: `Pagination` is now a delegate of the shared `Pager`, which has
// no `.pag-range` class (its range sits in `data-testid="pager-range"`) and no „Seite x von y“ line;
// the count text itself (every range assertion below) is unchanged.
function rangeText(): string {
  const el = document.querySelector('[data-testid="pager-range"]');
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("Pagination count text (Issue #849)", () => {
  it("14 rows at 10 per page read 1–10 von 14, then 11–14 von 14", async () => {
    renderWithTheme(Pagination, { total: 14, page: 1, pageSize: 10 });
    expect(rangeText()).toBe("1–10 von 14 Einträge");

    await fireEvent.click(screen.getByLabelText("Nächste Seite"));
    expect(rangeText()).toBe("11–14 von 14 Einträge");
  });

  it("the end of the range never exceeds the total", () => {
    renderWithTheme(Pagination, { total: 14, page: 1, pageSize: 25, showWhenSinglePage: true });
    expect(rangeText()).toBe("1–14 von 14 Einträge");
  });
});
