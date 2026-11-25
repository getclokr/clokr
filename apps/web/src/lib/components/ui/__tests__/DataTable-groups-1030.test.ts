// Issue #1030 - DataTable's additive row groups, equal-width fixed layout and sticky first column.
// One table, one raster: a group header row is rendered in front of the first shown row of each
// group, so two groups share their day columns. Without the props the table renders as before.
import { afterEach, describe, expect, it } from "vitest";
import { createRawSnippet } from "svelte";
import { cleanup } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import DataTable from "../DataTable.svelte";
import tableSource from "../DataTable.svelte?raw";

afterEach(() => cleanup());

const columns = [
  { key: "name", label: "Person", primary: true },
  { key: "mon", label: "Mo", align: "end" as const },
];

const rows = [
  { id: 1, name: "A", mon: "1", group: "team" },
  { id: 2, name: "B", mon: "2", group: "team" },
  { id: 3, name: "C", mon: "3", group: "helpers" },
];

function render(props: Record<string, unknown> = {}) {
  return renderWithTheme(DataTable, {
    columns,
    rows,
    rowKey: (r: { id: number }) => r.id,
    caption: "Stunden",
    ...props,
  });
}

describe("DataTable - row groups", () => {
  it("renders one header row in front of the first row of each group, in ONE table body", () => {
    const { container } = render({ rowGroup: (r: { group: string }) => r.group });
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelectorAll("tbody")).toHaveLength(1);
    const order = [...container.querySelectorAll("tbody tr")].map((tr) =>
      tr.classList.contains("dt-group") ? `[${tr.textContent?.trim()}]` : tr.textContent?.trim(),
    );
    expect(order).toEqual(["[team]", "A1", "B2", "[helpers]", "C3"]);
    const header = container.querySelector("tr.dt-group th")!;
    expect(header.getAttribute("scope")).toBe("colgroup");
    expect(header.getAttribute("colspan")).toBe(String(columns.length));
  });

  it("renders the header through the groupHeader snippet with the group name and its rows", () => {
    const groupHeader = createRawSnippet<[string, unknown[]]>((name, groupRows) => ({
      render: () => `<b>${name()} (${groupRows().length})</b>`,
    }));
    const { container } = render({ rowGroup: (r: { group: string }) => r.group, groupHeader });
    expect(
      [...container.querySelectorAll("tr.dt-group")].map((tr) => tr.textContent?.trim()),
    ).toEqual(["team (2)", "helpers (1)"]);
  });

  it("adds the colspan of the selection column and no header without the prop", () => {
    const grouped = render({ rowGroup: (r: { group: string }) => r.group, selectable: true });
    expect(grouped.container.querySelector("tr.dt-group th")!.getAttribute("colspan")).toBe("3");
    cleanup();
    const plain = render();
    expect(plain.container.querySelectorAll("tr.dt-group")).toHaveLength(0);
    expect(plain.container.querySelectorAll("tbody tr")).toHaveLength(rows.length);
  });
});

describe("DataTable - fixed equal columns and sticky first column", () => {
  it("switches to a fixed layout with the caller's minimum width and a sticky first column", () => {
    const { container } = render({ fixedMinWidth: "40rem", stickyFirst: true, dense: true });
    const table = container.querySelector("table")!;
    expect(table.classList.contains("dt-fixed")).toBe(true);
    expect(table.classList.contains("dt-sticky-first")).toBe(true);
    expect(table.classList.contains("dt-dense")).toBe(true);
    expect(table.getAttribute("style")).toBe("min-width: 40rem;");
  });

  it("leaves the table as before without the props", () => {
    const { container } = render();
    const table = container.querySelector("table")!;
    expect(table.classList.contains("dt-fixed")).toBe(false);
    expect(table.classList.contains("dt-sticky-first")).toBe(false);
    expect(table.classList.contains("dt-dense")).toBe(false);
    expect(table.getAttribute("style")).toBeNull();
  });

  it("turns a group header into a heading between cards on the narrow layout", () => {
    expect(tableSource).toMatch(/@container \(max-width: 759\.98px\)[\s\S]*tr\.dt-group th/);
    expect(tableSource).toMatch(/table-layout: fixed/);
  });
});
