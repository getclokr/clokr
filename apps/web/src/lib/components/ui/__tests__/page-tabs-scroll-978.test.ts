import { describe, expect, it } from "vitest";

import { REVEAL_MARGIN, scrollLeftToReveal } from "../page-tabs-scroll";

// Issue #978: the strip scrolls so that the current tab is fully visible, with room for the faded
// edge, and stays put when it already is.
describe("scrollLeftToReveal (#978)", () => {
  const strip = { scrollLeft: 0, clientWidth: 360 };

  it("keeps the position when the tab is already in view", () => {
    expect(scrollLeftToReveal(strip, { offsetLeft: 100, offsetWidth: 80 })).toBe(0);
    expect(
      scrollLeftToReveal(
        { scrollLeft: 50, clientWidth: 360 },
        { offsetLeft: 120, offsetWidth: 80 },
      ),
    ).toBe(50);
  });

  it("scrolls right until a tab behind the edge ends one margin before it", () => {
    const tab = { offsetLeft: 500, offsetWidth: 90 };
    const next = scrollLeftToReveal(strip, tab);
    expect(next).toBe(500 + 90 + REVEAL_MARGIN - 360);
    expect(tab.offsetLeft + tab.offsetWidth + REVEAL_MARGIN).toBe(next + strip.clientWidth);
  });

  it("scrolls left until a tab before the edge starts one margin after it", () => {
    expect(
      scrollLeftToReveal(
        { scrollLeft: 400, clientWidth: 360 },
        { offsetLeft: 200, offsetWidth: 90 },
      ),
    ).toBe(200 - REVEAL_MARGIN);
  });

  it("never goes below zero for the first tab", () => {
    expect(
      scrollLeftToReveal({ scrollLeft: 300, clientWidth: 360 }, { offsetLeft: 0, offsetWidth: 90 }),
    ).toBe(0);
  });
});
