// Issue #1030 - DataTable's additive `footer` snippet: one <tfoot> row with one cell per column,
// outside the body rows, an empty selection cell when `selectable`, and nothing at all without the
// prop. The card layout of the footer is the container query of the block (proven in the e2e); here
// the footer is the same DOM with a data-labelled cell per column.
import { afterEach, describe, expect, it } from "vitest";
import { createRawSnippet } from "svelte";
import { cleanup } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import DataTable from "../DataTable.svelte";
import tableSource from "../DataTable.svelte?raw";

afterEach(() => cleanup());

// A .ts test never imports a named export from a .svelte file (tsc cannot resolve it).
type Column = { key: string; label: string; primary?: boolean; align?: "start" | "end" };

const columns: Column[] = [
  { key: "name", label: "Person", primary: true },
  { key: "mon", label: "Mo", align: "end" },
  { key: "sum", label: "Summe", align: "end" },
];

const rows = [
  { id: 1, name: "Person A", mon: "8:00", sum: "8:00" },
  { id: 2, name: "Person B", mon: "6:00", sum: "6:00" },
];

const footer = createRawSnippet<[Column]>((column) => ({
  render: () => `<span data-footer-key="${column().key}">total ${column().key}</span>`,
}));

function render(props: Record<string, unknown> = {}) {
  return renderWithTheme(DataTable, {
    columns,
    rows,
    rowKey: (r: { id: number }) => r.id,
    caption: "Stunden",
    ...props,
  });
}

describe("DataTable - footer", () => {
  it("renders exactly one tfoot row with one labelled cell per column, after the body", () => {
    const { container } = render({ footer });
    const foot = container.querySelectorAll("tfoot");
    expect(foot).toHaveLength(1);
    expect(foot[0].querySelectorAll("tr")).toHaveLength(1);
    const cells = [...foot[0].querySelectorAll("td")];
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["Person", "Mo", "Summe"]);
    expect(cells.map((c) => c.textContent)).toEqual(["total name", "total mon", "total sum"]);
    // The footer is not a body row: the body keeps exactly the data rows.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(rows.length);
    expect(
      container.querySelector("table")!.lastElementChild!.tagName.toLowerCase(),
      "tfoot is the last child of the table",
    ).toBe("tfoot");
  });

  it("marks the primary and the end-aligned cells like the body cells", () => {
    const { container } = render({ footer });
    const cells = [...container.querySelectorAll("tfoot td")];
    expect(cells[0].classList.contains("dt-primary-cell")).toBe(true);
    expect(cells[1].classList.contains("dt-end")).toBe(true);
  });

  it("adds an empty selection cell in front when the table is selectable", () => {
    const { container } = render({ footer, selectable: true });
    const cells = [...container.querySelectorAll("tfoot td")];
    expect(cells).toHaveLength(columns.length + 1);
    expect(cells[0].classList.contains("dt-select-cell")).toBe(true);
    expect(cells[0].textContent).toBe("");
  });

  it("renders no tfoot without the prop and leaves the body as before", () => {
    const { container } = render();
    expect(container.querySelectorAll("tfoot")).toHaveLength(0);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(rows.length);
  });

  it("gives the footer row the card layout of the body rows below 760 px", () => {
    expect(tableSource).toMatch(/\.dt-table tfoot,/);
    expect(tableSource).toMatch(/\.dt-table :global\(tfoot tr\)/);
  });
});
