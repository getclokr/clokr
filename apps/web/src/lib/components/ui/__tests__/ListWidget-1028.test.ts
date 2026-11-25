// Issue #1028 - the shared list widget: a page of rows, chips with the caller's counts, the head link,
// a stored page size and filter (read through the in-memory store, saved through PUT /me/preferences),
// a page that survives a new `items` array, and a body that keeps its height while paging.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { get } from "svelte/store";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }));
vi.mock("$api/preferences", () => ({ savePreferences: saveSpy, fetchPreferences: vi.fn() }));

vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
});

import { renderWithTheme } from "$tests/test-utils";
import { prefsHydrated } from "$stores/prefs-state";
import { listPrefs, resetListPrefs, setListPrefsFromServer } from "$stores/list-prefs";
import ListWidget from "../ListWidget.svelte";

interface Item {
  id: string;
  name: string;
  kind: string;
}

function items(n: number, kind = "urlaub"): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${kind}-${i}`,
    name: `Person ${i + 1}`,
    kind,
  }));
}

const row = createRawSnippet<[Item]>((item) => ({
  render: () => `<li data-testid="lw-row">${item().name}</li>`,
}));

const CHIPS = [
  { value: "alle", label: "Alle", count: 44 },
  { value: "urlaub", label: "Urlaub", count: 30 },
  { value: "nachtrag", label: "Nachtrag", count: 14 },
];

function base(over: Record<string, unknown> = {}) {
  return {
    listId: "team.heute.aufgaben",
    title: "Aufgaben",
    items: items(44),
    itemKey: (i: Item) => i.id,
    row,
    testId: "lw",
    ...over,
  } as never;
}

function rows(): string[] {
  return screen.queryAllByTestId("lw-row").map((r) => r.textContent ?? "");
}

beforeEach(() => {
  saveSpy.mockReset();
  prefsHydrated.set(false);
  resetListPrefs();
});

afterEach(() => cleanup());

describe("ListWidget (Issue #1028)", () => {
  it("shows the default size of rows and the range", () => {
    renderWithTheme(ListWidget, base());
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toBe("Person 1");
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("1–5 von 44");
    expect(screen.getByRole("heading", { level: 2, name: "Aufgaben" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aufgaben" })).toBeInTheDocument();
  });

  it("shows the stored page size of the person", () => {
    setListPrefsFromServer({ "team.heute.aufgaben": { pageSize: 20 } });
    renderWithTheme(ListWidget, base());
    expect(rows()).toHaveLength(20);
  });

  it("falls back to the default for a stored size that is no size", () => {
    listPrefs.set({ "team.heute.aufgaben": { pageSize: 7 } });
    renderWithTheme(ListWidget, base());
    expect(rows()).toHaveLength(5);
  });

  it("has no pager up to the smallest size", () => {
    renderWithTheme(ListWidget, base({ items: items(5) }));
    expect(rows()).toHaveLength(5);
    expect(screen.queryByRole("navigation", { name: "Seitennavigation" })).toBeNull();
  });

  it("renders the head link as a link to the full page", () => {
    renderWithTheme(ListWidget, base({ moreHref: "/team/aufgaben", moreLabel: "Alle Aufgaben" }));
    const link = screen.getByRole("link", { name: "Alle Aufgaben" });
    expect(link.getAttribute("href")).toBe("/team/aufgaben");
  });

  it("renders the chips with the caller's counts", () => {
    renderWithTheme(ListWidget, base({ filters: CHIPS, filterTestId: "lw-chips" }));
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Alle 44",
      "Urlaub 30",
      "Nachtrag 14",
    ]);
    expect(screen.getByRole("radio", { name: /^Alle/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("lw-chips")).toBeInTheDocument();
  });

  it("a chip click sets the effective filter, goes back to page 1 and saves once", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue({
      lists: { "team.heute.aufgaben": { pageSize: 5, filter: "urlaub" } },
    });
    const onFilterChange = vi.fn();
    renderWithTheme(ListWidget, base({ filters: CHIPS, onFilterChange }));
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("6–10 von 44");

    await fireEvent.click(screen.getByRole("radio", { name: /^Urlaub/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith({
      lists: { "team.heute.aufgaben": { pageSize: 5, filter: "urlaub" } },
    });
    expect(onFilterChange).toHaveBeenCalledWith("urlaub");
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("1–5 von 44");
    expect(screen.getByRole("radio", { name: /^Urlaub/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("a size change is saved with the complete entry (size and filter)", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue({
      lists: { "team.heute.aufgaben": { pageSize: 10, filter: "alle" } },
    });
    renderWithTheme(ListWidget, base({ filters: CHIPS }));
    await fireEvent.change(screen.getByLabelText("Zeilen pro Seite"), { target: { value: "10" } });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith({
      lists: { "team.heute.aufgaben": { pageSize: 10, filter: "alle" } },
    });
    expect(rows()).toHaveLength(10);
  });

  it("a list without a filter saves the size only", async () => {
    prefsHydrated.set(true);
    saveSpy.mockResolvedValue({ lists: { "ich.tag.fuer-dich": { pageSize: 10 } } });
    renderWithTheme(ListWidget, base({ listId: "ich.tag.fuer-dich", title: "Für dich" }));
    await fireEvent.change(screen.getByLabelText("Zeilen pro Seite"), { target: { value: "10" } });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith({ lists: { "ich.tag.fuer-dich": { pageSize: 10 } } });
  });

  it("shows the stored filter, and a URL filter wins for the visit without being stored", () => {
    setListPrefsFromServer({ "team.heute.aufgaben": { pageSize: 5, filter: "nachtrag" } });
    renderWithTheme(ListWidget, base({ filters: CHIPS }));
    expect(screen.getByRole("radio", { name: /^Nachtrag/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    cleanup();
    renderWithTheme(ListWidget, base({ filters: CHIPS, initialFilter: "urlaub" }));
    expect(screen.getByRole("radio", { name: /^Urlaub/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(get(listPrefs)["team.heute.aufgaben"]?.filter).toBe("nachtrag");
  });

  it("a new URL filter beats an earlier chip click of this visit", async () => {
    const { rerender } = renderWithTheme(ListWidget, base({ filters: CHIPS }));
    await fireEvent.click(screen.getByRole("radio", { name: /^Nachtrag/ }));
    expect(screen.getByRole("radio", { name: /^Nachtrag/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await rerender(base({ filters: CHIPS, initialFilter: "urlaub" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /^Urlaub/ }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
  });

  it("a stored filter that no chip offers shows „Alle“ and keeps the stored value", () => {
    setListPrefsFromServer({ "team.heute.aufgaben": { filter: "zeitkorrektur" } });
    renderWithTheme(ListWidget, base({ filters: CHIPS }));
    expect(screen.getByRole("radio", { name: /^Alle/ }).getAttribute("aria-checked")).toBe("true");
    expect(get(listPrefs)["team.heute.aufgaben"]?.filter).toBe("zeitkorrektur");
  });

  it("a new items array keeps the page and only clamps it", async () => {
    const { rerender } = renderWithTheme(ListWidget, base());
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("11–15 von 44");
    // The 30 s poll delivers a fresh array with the same rows.
    await rerender(base({ items: items(44) }));
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("11–15 von 44");
    // The list shrank below the page: clamp to the last page.
    await rerender(base({ items: items(12) }));
    expect(screen.getByTestId("pager-range").textContent?.trim()).toBe("11–12 von 12");
    expect(rows()).toEqual(["Person 11", "Person 12"]);
  });

  it("reserves the body height of a page while there are more rows than a page", () => {
    renderWithTheme(ListWidget, base({ rowHeight: 60 }));
    const body = document.querySelector(".lw-body") as HTMLElement;
    expect(body.style.minHeight).toBe("300px");
    cleanup();
    renderWithTheme(ListWidget, base({ items: items(3), rowHeight: 60 }));
    expect((document.querySelector(".lw-body") as HTMLElement).style.minHeight).toBe("");
  });

  it("shows the empty snippet without rows and no pager", () => {
    const empty = createRawSnippet(() => ({
      render: () => '<p data-testid="lw-empty">Nichts</p>',
    }));
    renderWithTheme(ListWidget, base({ items: [], empty }));
    expect(screen.getByTestId("lw-empty")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Seitennavigation" })).toBeNull();
  });

  it("renders a body snippet with the rows of the page (table widgets)", () => {
    const body = createRawSnippet<[Item[]]>((page) => ({
      render: () => `<div data-testid="lw-table">${page().length}</div>`,
    }));
    renderWithTheme(ListWidget, base({ row: undefined, body }));
    expect(screen.getByTestId("lw-table").textContent).toBe("5");
  });

  it("shows a skeleton while loading and no pager", () => {
    renderWithTheme(ListWidget, base({ loading: true }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Seitennavigation" })).toBeNull();
  });
});
