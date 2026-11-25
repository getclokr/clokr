// Issue #1028 - the web half of the list register (`packages/types/list-preferences.json`) and the
// pure paging helpers. The API validates a PUT against the same file; here the shown page size and
// filter are RESOLVED against it, so a missing, unknown or invalid stored value can never reach a widget.
import { describe, it, expect } from "vitest";
import register from "@clokr/types/list-preferences.json";
import { TASK_KIND_VALUES } from "$lib/team/task-model";
import { ATTENDANCE_FILTERS } from "$lib/dashboard/heute-im-salon";
import {
  LIST_IDS,
  defaultFilterOf,
  defaultPageSizeOf,
  filtersOf,
  isListId,
  pageSizesOf,
  resolveListPreference,
} from "../list-registry";
import { clampPage, pageCount, pageOfIndex, pageSlice, rangeLabel } from "../list-page";

describe("list register (Issue #1028)", () => {
  it("names the sizes of both kinds and a default inside each", () => {
    expect(register.pageSizes.widget).toEqual([5, 10, 20]);
    expect(register.pageSizes.table).toEqual([25, 50, 100]);
    expect(register.pageSizes.widget).toContain(register.defaults.widget);
    expect(register.pageSizes.table).toContain(register.defaults.table);
    // The walked set is not empty (a moved register must turn this red, never pass over nothing).
    expect(LIST_IDS.length).toBeGreaterThanOrEqual(12);
  });

  it("every list's own default size is one of its kind's sizes, every default filter is offered", () => {
    for (const id of LIST_IDS) {
      expect(pageSizesOf(id)).toContain(defaultPageSizeOf(id));
      const filters = filtersOf(id);
      const defaultFilter = defaultFilterOf(id);
      if (filters && defaultFilter !== undefined) expect(filters).toContain(defaultFilter);
    }
  });

  it("an unset preference reads the list's default size and default filter", () => {
    expect(resolveListPreference("team.heute.aufgaben", undefined)).toEqual({
      pageSize: 5,
      filter: "alle",
    });
    expect(resolveListPreference("team.heute.jetzt", undefined)).toEqual({
      pageSize: 5,
      filter: "anwesend",
    });
    expect(resolveListPreference("team.heute.team-woche", undefined)).toEqual({
      pageSize: 25,
      filter: null,
    });
  });

  it("a valid stored size and filter win", () => {
    expect(
      resolveListPreference("team.heute.aufgaben", { pageSize: 20, filter: "nachtrag" }),
    ).toEqual({ pageSize: 20, filter: "nachtrag" });
    expect(resolveListPreference("team.heute.team-woche", { pageSize: 100 })).toEqual({
      pageSize: 100,
      filter: null,
    });
  });

  it.each([
    ["a size of the other kind", { pageSize: 25 }],
    ["a size that is no size", { pageSize: 7 }],
    ["a size that is a string", { pageSize: "10" }],
    ["a filter outside the allow-list", { filter: "bogus" }],
    ["a filter that is a number", { filter: 42 }],
    ["an entry that is not an object", 10],
    ["null", null],
  ])("%s falls back to the default", (_label, stored) => {
    expect(resolveListPreference("team.heute.aufgaben", stored as never)).toEqual({
      pageSize: 5,
      filter: "alle",
    });
  });

  it("a code filter of a list without an allow-list is taken when it has the code shape", () => {
    expect(resolveListPreference("team.heute.demnaechst", { filter: "SICK" }).filter).toBe("SICK");
    expect(resolveListPreference("team.heute.demnaechst", { filter: "a b" }).filter).toBe("alle");
  });

  it("a list without any filter never resolves one", () => {
    expect(resolveListPreference("ich.tag.fuer-dich", { filter: "alle" }).filter).toBeNull();
  });

  it("the filter values of Aufgaben are „alle“ plus the task kinds of the KPI", () => {
    expect(filtersOf("team.heute.aufgaben")).toEqual(["alle", ...TASK_KIND_VALUES]);
  });

  it("the filter values of Jetzt im Salon are the keys of ATTENDANCE_FILTERS", () => {
    expect(filtersOf("team.heute.jetzt")).toEqual(Object.keys(ATTENDANCE_FILTERS));
  });

  it("isListId is an allow-list over own keys", () => {
    expect(isListId("team.heute.aufgaben")).toBe(true);
    expect(isListId("constructor")).toBe(false);
    expect(isListId("__proto__")).toBe(false);
    expect(isListId(undefined)).toBe(false);
  });
});

describe("list paging helpers (Issue #1028)", () => {
  const rows = Array.from({ length: 44 }, (_, i) => i + 1);

  it("pageSlice cuts the rows of one page", () => {
    expect(pageSlice(rows, 1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageSlice(rows, 9, 5)).toEqual([41, 42, 43, 44]);
    expect(pageSlice(rows, 99, 5)).toEqual([]);
    expect(pageSlice([], 1, 5)).toEqual([]);
  });

  it("pageCount is at least one page", () => {
    expect(pageCount(44, 5)).toBe(9);
    expect(pageCount(45, 5)).toBe(9);
    expect(pageCount(46, 5)).toBe(10);
    expect(pageCount(0, 5)).toBe(1);
  });

  it("clampPage keeps a page inside 1..pageCount", () => {
    expect(clampPage(0, 44, 5)).toBe(1);
    expect(clampPage(12, 44, 5)).toBe(9);
    expect(clampPage(3, 44, 5)).toBe(3);
    expect(clampPage(5, 0, 5)).toBe(1);
    expect(clampPage(Number.NaN, 44, 5)).toBe(1);
  });

  it("pageOfIndex gives the page that holds a zero-based row index", () => {
    expect(pageOfIndex(0, 25)).toBe(1);
    expect(pageOfIndex(24, 25)).toBe(1);
    expect(pageOfIndex(25, 25)).toBe(2);
    expect(pageOfIndex(-1, 25)).toBe(1);
  });

  it("rangeLabel reads „a–b von n“, never „1–0“", () => {
    expect(rangeLabel(1, 5, 44)).toBe("1–5 von 44");
    expect(rangeLabel(9, 5, 44)).toBe("41–44 von 44");
    expect(rangeLabel(1, 25, 14)).toBe("1–14 von 14");
    expect(rangeLabel(1, 5, 0)).toBe("0 von 0");
  });
});
