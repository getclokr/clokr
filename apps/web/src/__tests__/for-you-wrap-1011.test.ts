// Issue #1011 (e) (a) - on Ich > Mein Tag a "Für dich" row was cut off on a phone
// ("Fr 13.11. ohne Zeite…"). At 390 px the text column between the status chip and the action
// button is only about 134 px wide, and ListRow gave `.list-title` and `.list-subtitle` a one-line
// ellipsis; its `wrap` prop released only the subtitle. The fix: `wrap` releases the title too,
// and the Für dich rows pass `wrap`.
//
// Each claim is proven where it is provable:
//   1. MOUNTED: a ListRow with `wrap` carries `list-text--wrap` on its text column, one without
//      `wrap` does not.
//   2. SOURCE PIN: jsdom computes no layout, so the rule itself is pinned by regex on the block's
//      style (same reasoning as ListRow-853): one selector list releases title and subtitle.
//   3. WIRING PIN: the Mein Tag page needs about twenty GETs to mount, so the `wrap` attribute on
//      its "Für dich" ListRow is pinned by a source read (same remedy as
//      dashboard-today-shift-source.test.ts).
// Every pin runs against a control so that a regex that cannot fail is noticed.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { renderWithTheme } from "$tests/test-utils";
import ListRow from "$lib/components/ui/ListRow.svelte";
import rowSource from "$lib/components/ui/ListRow.svelte?raw";
import dashboardSource from "../routes/(app)/dashboard/+page.svelte?raw";

afterEach(() => cleanup());

const leading = createRawSnippet(() => ({ render: () => "<span>Fehlt</span>" }));
const trailing = createRawSnippet(() => ({ render: () => "<a href='/x'>Nachtragen</a>" }));

const styleOf = (source: string) => source.slice(source.indexOf("<style>"));

/** True when ONE rule releases both title and subtitle of a wrapping row. */
function releasesTitleAndSubtitle(style: string): boolean {
  return /\.list-text--wrap \.list-title,\s*\.list-text--wrap \.list-subtitle\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/.test(
    style,
  );
}

/** The opening `<ListRow …>` tag of the "Für dich" list, or null. */
function forYouRowTag(source: string): string | null {
  const start = source.indexOf('<List ariaLabel="Für dich">');
  if (start === -1) return null;
  const end = source.indexOf("</List>", start);
  const block = source.slice(start, end);
  const tag = block.match(/<ListRow\b[^>]*>/);
  return tag ? tag[0] : null;
}

const WRAP_ATTR = /\swrap(\s|>|\/)/;

describe("ListRow wrap - mounted", () => {
  const props = {
    title: "Fr 13.11. ohne Zeiteintrag",
    subtitle: "Trage deine Zeiten nach",
    avatar: false,
    leading,
    trailing,
  };

  it("puts list-text--wrap on the text column when wrap is set", () => {
    const { container } = renderWithTheme(ListRow, { ...props, wrap: true });
    expect(container.querySelector(".list-text")!.classList.contains("list-text--wrap")).toBe(true);
  });

  it("does not put it there without wrap", () => {
    const { container } = renderWithTheme(ListRow, props);
    expect(container.querySelector(".list-text")!.classList.contains("list-text--wrap")).toBe(
      false,
    );
  });
});

describe("ListRow wrap - rule pin", () => {
  it("releases title and subtitle in one rule", () => {
    expect(releasesTitleAndSubtitle(styleOf(rowSource))).toBe(true);
  });

  it("keeps the default one-line ellipsis and the task-variant subtitle rule", () => {
    const style = styleOf(rowSource);
    expect(style).toMatch(/\.list-title,\s*\.list-subtitle\s*\{[^}]*white-space:\s*nowrap/);
    expect(style).toMatch(/\.list-row--task \.list-subtitle\s*\{[^}]*white-space:\s*normal/);
  });

  it("control: the pin fails on a copy without the title rule", () => {
    const withoutTitle = styleOf(rowSource).replace(/\.list-text--wrap \.list-title,\s*/, "");
    expect(releasesTitleAndSubtitle(withoutTitle)).toBe(false);
    // The replace must have changed something, otherwise this control proves nothing.
    expect(withoutTitle).not.toBe(styleOf(rowSource));
  });
});

describe("Mein Tag - Für dich passes wrap", () => {
  it("the Für dich ListRow carries the wrap attribute", () => {
    const tag = forYouRowTag(dashboardSource);
    expect(tag).not.toBeNull();
    expect(tag).toMatch(WRAP_ATTR);
  });

  it("control: the pin fails on a copy of the block without wrap", () => {
    const start = dashboardSource.indexOf('<List ariaLabel="Für dich">');
    const stripped =
      dashboardSource.slice(0, start) +
      dashboardSource.slice(start).replace(/(<ListRow\b[^>]*?)\swrap(?=[\s>])/, "$1");
    expect(stripped).not.toBe(dashboardSource);
    expect(forYouRowTag(stripped)).not.toMatch(WRAP_ATTR);
  });
});
