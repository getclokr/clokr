// Issue #992 (N-21, D-992-06) - a column with `cardHidden` stays in the table and is left out of the card
// layout: its cells carry `data-card-hidden` and a rule inside the narrow container block hides them.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/svelte";
import postcss from "postcss";
import { renderWithTheme } from "$tests/test-utils";
import DataTable from "../DataTable.svelte";
import tableSource from "../DataTable.svelte?raw";

afterEach(() => cleanup());

const rows = [{ id: 1, name: "Person A", hours: "40:00", roles: "Mitarbeiter" }];

function render(hidden: boolean) {
  return renderWithTheme(DataTable, {
    columns: [
      { key: "name", label: "Name", primary: true },
      { key: "hours", label: "Std./Woche", cardHidden: hidden },
      { key: "roles", label: "Rollen", cardHidden: hidden },
    ],
    rows,
    rowKey: (r: { id: number }) => r.id,
    caption: "Personen",
    cell: undefined,
  });
}

describe("DataTable - cardHidden (#992)", () => {
  it("marks the cells of a cardHidden column and leaves the table's columns as they are", () => {
    const { container } = render(true);
    const marked = [...container.querySelectorAll("tbody td[data-card-hidden]")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(marked).toEqual(["Std./Woche", "Rollen"]);
    // The head keeps every column: the wide table is unchanged.
    expect([...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim())).toEqual(
      ["Name", "Std./Woche", "Rollen"],
    );
  });

  it("marks nothing without the prop (negative control)", () => {
    const { container } = render(false);
    expect(container.querySelectorAll("[data-card-hidden]")).toHaveLength(0);
  });

  it("hides the marked cells only inside the narrow container block", () => {
    const style = [...tableSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join("\n");
    let insideNarrow = false;
    let outside = false;
    postcss.parse(style).walkRules((rule) => {
      if (!rule.selector.includes("[data-card-hidden]")) return;
      const parent = rule.parent;
      const hides = rule.some(
        (node) => node.type === "decl" && node.prop === "display" && node.value === "none",
      );
      if (parent && parent.type === "atrule" && "params" in parent) {
        if (
          (parent as unknown as { name: string }).name === "container" &&
          (parent as unknown as { params: string }).params === "(max-width: 759.98px)" &&
          hides
        ) {
          insideNarrow = true;
        } else outside = true;
      } else outside = true;
    });
    expect(insideNarrow, "the rule sits in the 759.98px container block").toBe(true);
    expect(outside, "no rule hides a marked cell outside it").toBe(false);
  });
});
