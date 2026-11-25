// Issue #1028 - after a person-made page change the list scrolls its top under the top bar, but only when
// the first row of the new page is not on screen at all (the walkthrough of Issue #710 found the first
// row of page 2 above the fold on a phone: the pager text changed, nothing else did).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_ROW_SELECTOR, TOPBAR_HEIGHT, firstRowIsInView, revealListTop } from "../reveal-list";

const VIEWPORT = 800;

/** A list root with one row; `rect` places the row, the root itself is never measured while a row exists. */
function list(rowTag: "li" | "tr", rect: { top: number; bottom: number } | null) {
  const root = document.createElement("section");
  if (rect) {
    const row = document.createElement(rowTag);
    row.getBoundingClientRect = () =>
      ({ ...rect, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    if (rowTag === "tr") {
      const table = document.createElement("table");
      const body = document.createElement("tbody");
      body.appendChild(row);
      table.appendChild(body);
      root.appendChild(table);
    } else {
      const ul = document.createElement("ul");
      ul.appendChild(row);
      root.appendChild(ul);
    }
  }
  root.getBoundingClientRect = () =>
    ({ top: 0, bottom: 10, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
  return root;
}

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy as never;
  Object.defineProperty(window, "innerHeight", { value: VIEWPORT, configurable: true });
});

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("firstRowIsInView", () => {
  it("is false for a row entirely above the viewport", () => {
    expect(firstRowIsInView(list("li", { top: -400, bottom: -10 }), VIEWPORT)).toBe(false);
  });

  it("is false for a row hidden under the top bar", () => {
    expect(firstRowIsInView(list("li", { top: -60, bottom: TOPBAR_HEIGHT }), VIEWPORT)).toBe(false);
  });

  it("is true for a row that is at least partly visible", () => {
    expect(firstRowIsInView(list("li", { top: -200, bottom: TOPBAR_HEIGHT + 1 }), VIEWPORT)).toBe(
      true,
    );
    expect(firstRowIsInView(list("tr", { top: 300, bottom: 600 }), VIEWPORT)).toBe(true);
    expect(
      firstRowIsInView(list("tr", { top: VIEWPORT - 1, bottom: VIEWPORT + 300 }), VIEWPORT),
    ).toBe(true);
  });

  it("is false for a row below the bottom edge", () => {
    expect(firstRowIsInView(list("li", { top: VIEWPORT, bottom: VIEWPORT + 100 }), VIEWPORT)).toBe(
      false,
    );
  });

  it("measures the root itself when the list has no row", () => {
    const root = list("li", null);
    expect(root.querySelector(FIRST_ROW_SELECTOR)).toBeNull();
    // The root box (0..10) ends above the top-bar line: not on screen.
    expect(firstRowIsInView(root, VIEWPORT)).toBe(false);
  });
});

describe("revealListTop", () => {
  it("scrolls the list to the top when its first row is above the fold", () => {
    revealListTop(list("li", { top: -400, bottom: -10 }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  });

  it("does not scroll when the first row is on screen (a short last page stays at its pager)", () => {
    revealListTop(list("tr", { top: -100, bottom: 150 }));
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("does nothing without an element and survives a missing scrollIntoView", () => {
    expect(() => revealListTop(null)).not.toThrow();
    expect(() => revealListTop(undefined)).not.toThrow();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    expect(() => revealListTop(list("li", { top: -400, bottom: -10 }))).not.toThrow();
  });
});
