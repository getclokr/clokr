// Issue #1028 - DataTable pages with the shared Pager: 25 rows by default (table kind), the size stored
// per table and person through the list-preference store, server mode with `total`, a bindable `page`
// for deep links, a reset on sort / `pageResetKey`, selection on the shown page only, and `Pagination`
// as the legacy delegate of the same Pager.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }));
vi.mock("$api/preferences", () => ({ savePreferences: saveSpy, fetchPreferences: vi.fn() }));

import { renderWithTheme } from "$tests/test-utils";
import { prefsHydrated } from "$stores/prefs-state";
import { listPrefs, resetListPrefs } from "$stores/list-prefs";
import { pageOfIndex } from "$lib/lists/list-page";
import DataTable from "../DataTable.svelte";
import Pagination from "../Pagination.svelte";
import tableSource from "../DataTable.svelte?raw";

interface Row {
  id: number;
  name: string;
}

const columns = [{ key: "name", label: "Name", primary: true }];

function people(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}` }));
}

function render(over: Record<string, unknown> = {}) {
  return renderWithTheme(DataTable, {
    columns,
    rows: people(60),
    rowKey: (r: Row) => r.id,
    caption: "Personen",
    listId: "verwalten.rollen.rollen",
    ...over,
  } as never);
}

function names(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody td")].map((td) => td.textContent?.trim() ?? "");
}

function range(): string {
  return (screen.getByTestId("pager-range").textContent ?? "").replace(/\s+/g, " ").trim();
}

async function pickSize(size: number) {
  await fireEvent.change(screen.getByLabelText("Zeilen pro Seite"), {
    target: { value: String(size) },
  });
}

beforeEach(() => {
  saveSpy.mockReset();
  saveSpy.mockImplementation(async (body: { lists: Record<string, unknown> }) => ({
    lists: body.lists,
  }));
  prefsHydrated.set(false);
  resetListPrefs();
});

afterEach(() => cleanup());

describe("DataTable paging - client mode (Issue #1028)", () => {
  it("shows 25 of 60 rows by default and steps to rows 26-50", async () => {
    const { container } = render();
    expect(names(container)).toHaveLength(25);
    expect(range()).toBe("1–25 von 60");
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(range()).toBe("26–50 von 60");
    expect(names(container)[0]).toBe("Person 26");
  });

  it("shows 50 rows after the size choice and returns to page 1", async () => {
    const { container } = render();
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await pickSize(50);
    expect(names(container)).toHaveLength(50);
    expect(range()).toBe("1–50 von 60");
  });

  it("renders no pager up to 25 rows", () => {
    const { container } = render({ rows: people(25) });
    expect(names(container)).toHaveLength(25);
    expect(screen.queryByRole("navigation", { name: "Seitennavigation" })).toBeNull();
  });

  it("with a listId the size comes from the store and a change is saved once", async () => {
    prefsHydrated.set(true);
    listPrefs.set({ "verwalten.rollen.rollen": { pageSize: 50 } });
    const { container } = render();
    expect(names(container)).toHaveLength(50);
    await pickSize(100);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      lists: { "verwalten.rollen.rollen": { pageSize: 100 } },
    });
    expect(names(container)).toHaveLength(60);
  });

  it("without a listId the size lives for the visit only and nothing is saved", async () => {
    prefsHydrated.set(true);
    const { container } = render({ listId: undefined });
    await pickSize(50);
    expect(names(container)).toHaveLength(50);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("falls back to 25 for a stored size that is no table size", () => {
    listPrefs.set({ "verwalten.rollen.rollen": { pageSize: 7 } });
    const { container } = render();
    expect(names(container)).toHaveLength(25);
  });

  it("starts at the register's own default size of a table that names one", () => {
    const { container } = render({ listId: "ich.zeiten.eintraege" });
    expect(names(container)).toHaveLength(50);
  });
});

describe("DataTable paging - deep link, reset and selection (Issue #1028)", () => {
  it("shows the row a caller pages to through the bindable page", () => {
    const { container } = render({ page: pageOfIndex(41, 25) });
    expect(range()).toBe("26–50 von 60");
    expect(names(container)).toContain("Person 42");
  });

  it("clamps a page beyond the last one", () => {
    render({ page: 9 });
    expect(range()).toBe("51–60 von 60");
  });

  it("keeps the page when a new rows array with the same keys arrives", async () => {
    const view = render();
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await view.rerender({ rows: people(60) } as never);
    expect(range()).toBe("26–50 von 60");
  });

  it("returns to page 1 when the sort changes", async () => {
    const view = render({ sort: null });
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await view.rerender({ sort: { key: "name", dir: "desc" } } as never);
    expect(range()).toBe("1–25 von 60");
  });

  it("returns to page 1 when pageResetKey changes", async () => {
    const view = render({ pageResetKey: "a" });
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(range()).toBe("26–50 von 60");
    await view.rerender({ pageResetKey: "b" } as never);
    expect(range()).toBe("1–25 von 60");
  });

  it("acts on the shown page with the header checkbox and keeps keys of other pages", async () => {
    const onSelectionChange = vi.fn();
    render({ selectable: true, selectedKeys: [40], onSelectionChange });
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "Alle angezeigten Zeilen auswählen" }),
    );
    const next = onSelectionChange.mock.calls.at(-1)?.[0] as number[];
    expect(next).toHaveLength(26);
    expect(next).toContain(40);
    expect(next).toContain(1);
    expect(next).not.toContain(26);
  });

  it("has one pager that serves the table and its card layout (one DOM)", () => {
    render();
    expect(screen.getAllByRole("navigation", { name: "Seitennavigation" })).toHaveLength(1);
  });
});

describe("DataTable paging - server mode (Issue #1028)", () => {
  it("does not slice the rows, shows `total` and reports the page and size changes", async () => {
    const onPageChange = vi.fn();
    const { container } = render({ rows: people(25), total: 80, onPageChange });
    expect(names(container)).toHaveLength(25);
    expect(range()).toBe("1–25 von 80");
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(onPageChange).toHaveBeenLastCalledWith({ page: 2, pageSize: 25 });
    await pickSize(50);
    expect(onPageChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });
  });

  it("adopts an explicitly stored size when the caller owns the size", () => {
    const onPageChange = vi.fn();
    listPrefs.set({ "verwalten.rollen.rollen": { pageSize: 50 } });
    render({ rows: people(25), total: 80, pageSize: 25, onPageChange });
    expect(onPageChange).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
  });
});

describe("Pagination delegate (Issue #1028)", () => {
  it("renders the shared Pager with the noun after the range", async () => {
    renderWithTheme(Pagination, { total: 14, page: 1, pageSize: 10 });
    expect(range()).toBe("1–10 von 14 Einträge");
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(range()).toBe("11–14 von 14 Einträge");
  });

  it("owns no markup of its own any more", () => {
    renderWithTheme(Pagination, { total: 14, page: 1, pageSize: 10 });
    expect(document.querySelector(".pag-wrap")).toBeNull();
  });
});

describe("DataTable source (Issue #1028)", () => {
  it("renders the shared Pager and no pager of its own", () => {
    expect(tableSource).toContain("<Pager");
    expect(tableSource).not.toContain("<Pagination");
  });
});
