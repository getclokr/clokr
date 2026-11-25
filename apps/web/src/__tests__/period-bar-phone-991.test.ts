// Issue #991 N-29 / M-51 (D-991-11) - the phone period bar takes one row less: „Heute“ and the extra
// slot (Zeiten: Kalender/Liste) share ONE row under the arrows between 361 and 640 px, and the bar
// padding is 12/16 px. Below 361 px the previous stacking stays (the #564 clearance at 320 px).
//
// Measured on the block's real style with the shared media-query probe (jsdom evaluates no @media),
// with the probe's positive and negative controls. NOT provable here: real layout and geometry (the
// label clearing the arrows, nothing outside the viewport, the calendar's first week row in the first
// 390x844 screen) - that is `month-bar-narrow-viewport.spec.ts` in CI and the owner screenshots.
import { afterEach, describe, expect, it } from "vitest";
import { INVENTED_CLASS, cssForViewport, probeAt, styleBlockOf } from "$tests/media-query-probe";
import pickerSource from "../lib/components/ui/PeriodPicker.svelte?raw";

const css = styleBlockOf(pickerSource);
// An element no rule touches computes the initial value (jsdom reports `auto`, an absent property "").
const UNSET = /^(auto)?$/;

afterEach(() => {
  // The shared probe does not clean up after itself.
  document.head.querySelectorAll("style").forEach((s) => s.remove());
  document.body.innerHTML = "";
});

function probe(width: number) {
  return probeAt(width, cssForViewport(css, width));
}

describe("PeriodPicker, phone bar (N-29, M-51)", () => {
  it("at 390 px Heute and the extra slot are on grid row 2, spanning every track, at opposite ends", () => {
    const p = probe(390);
    const today = p.styles("month-bar-today", "button");
    const extra = p.styles("month-bar-extra", "div");
    for (const el of [today, extra]) {
      expect(el.getPropertyValue("grid-row")).toBe("2");
      expect(el.getPropertyValue("grid-column")).toBe("1 / -1");
    }
    expect(today.getPropertyValue("justify-self")).toBe("start");
    expect(extra.getPropertyValue("justify-self")).toBe("end");
  });

  it("at 390 px the bar padding is 12px 16px", () => {
    const bar = probe(390).styles("month-bar", "div");
    expect(bar.getPropertyValue("padding")).toBe("12px 16px");
  });

  it("at 340 px the extra slot has its own row again (row 3) and Heute is centred", () => {
    const p = probe(340);
    expect(p.styles("month-bar-extra", "div").getPropertyValue("grid-row")).toBe("3");
    expect(p.styles("month-bar-today", "button").getPropertyValue("justify-self")).toBe("center");
  });

  it("at 1024 px none of the narrow rules apply", () => {
    const p = probe(1024);
    for (const [cls, tag] of [
      ["month-bar-today", "button"],
      ["month-bar-extra", "div"],
    ] as const) {
      const el = p.styles(cls, tag);
      expect(el.getPropertyValue("grid-row")).toMatch(UNSET);
      expect(el.getPropertyValue("grid-column")).toMatch(UNSET);
      expect(el.getPropertyValue("justify-self")).toMatch(UNSET);
    }
    expect(p.styles("month-bar", "div").getPropertyValue("padding")).toBe("18px 24px");
  });

  it("controls: an invented class gets none of it, and the sheet is in effect at all", () => {
    const p = probe(390);
    const invented = p.styles(INVENTED_CLASS, "div");
    expect(invented.getPropertyValue("grid-row")).toMatch(UNSET);
    expect(invented.getPropertyValue("justify-self")).toMatch(UNSET);
    expect(invented.getPropertyValue("padding")).not.toBe("12px 16px");
    // Positive: the known class does differ from a class-less element of the same tag.
    expect(p.styles("month-bar", "div").getPropertyValue("padding")).not.toBe(
      p.styles("", "div").getPropertyValue("padding"),
    );
  });
});
