// Issue #991 (N-27, M-27; D-991-22) — the recurring availability grid: light rows with a status edge
// from a data attribute (no inline colour), the trash only on an existing entry, removal through
// ConfirmDialog, and a phone row of two short lines. The grid is also Team › Verfügbarkeit's.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import { INVENTED_CLASS, cssForViewport, probeAt, styleBlockOf } from "$tests/media-query-probe";
import gridSource from "../AvailabilityWeekGrid.svelte?raw";
import AvailabilityWeekGrid from "../AvailabilityWeekGrid.svelte";

type Entry = { dayOfWeek: number; status: "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" };

const ENTRIES: Entry[] = [
  { dayOfWeek: 1, status: "AVAILABLE" },
  { dayOfWeek: 3, status: "UNAVAILABLE" },
];

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style").forEach((s) => s.remove());
});

function renderGrid(entries: Entry[] = ENTRIES) {
  return renderWithTheme(AvailabilityWeekGrid, { entries } as never);
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".av-recurring-row"));
const removeButtons = () => screen.queryAllByRole("button", { name: /^Eintrag für .* entfernen$/ });

describe("rows (M-27)", () => {
  it("offers the trash only for an existing entry: two entries, two buttons", () => {
    renderGrid();
    expect(rows()).toHaveLength(7);
    const buttons = removeButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Eintrag für Montag entfernen",
      "Eintrag für Mittwoch entfernen",
    ]);
    // An Icon, no emoji.
    for (const b of buttons) {
      expect(b.textContent).not.toContain("🗑");
      expect(b.querySelector("svg")).not.toBeNull();
    }
  });

  it("carries the status as data-status, and no element has an inline colour or border style", () => {
    const { container } = renderGrid();
    const status = rows().map((r) => r.getAttribute("data-status"));
    expect(status).toEqual(["AVAILABLE", "none", "UNAVAILABLE", "none", "none", "none", "none"]);
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[style]"))) {
      const style = el.getAttribute("style") ?? "";
      expect(style).not.toMatch(/border|color/);
    }
    expect(gridSource).not.toMatch(/style="[^"]*border/);
    expect(gridSource).not.toContain("borderColor");
  });

  it("the status options carry no glyph", () => {
    renderGrid();
    expect(document.querySelectorAll(".seg-glyph")).toHaveLength(0);
    expect(gridSource).not.toMatch(/glyph:/);
  });
});

describe("removing an entry (N-27)", () => {
  it("asks through ConfirmDialog and removes only after the confirmation", async () => {
    renderGrid();
    await fireEvent.click(removeButtons()[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Eintrag entfernen?")).toBeTruthy();
    expect(dialog.textContent).not.toContain("dauerhaft");
    // Still two entries until it is confirmed.
    expect(removeButtons()).toHaveLength(2);
    await fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(removeButtons()).toHaveLength(1));
    expect(rows()[0].getAttribute("data-status")).toBe("none");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Abbrechen keeps the entry", async () => {
    renderGrid();
    await fireEvent.click(removeButtons()[1]);
    const dialog = await screen.findByRole("dialog");
    await fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(removeButtons()).toHaveLength(2);
  });

  it("no raw alertdialog markup is left", () => {
    expect(gridSource).not.toContain("alertdialog");
    expect(gridSource).not.toContain("modal-actions");
    expect(gridSource).toContain("<ConfirmDialog");
  });
});

describe("phone row (N-27)", () => {
  // The probe evaluates width conditions only; the touch-target block (`pointer: coarse`) is dropped.
  const css = styleBlockOf(gridSource).replace(
    /@media \(pointer: coarse\)\s*\{[^{}]*\{[^{}]*\}\s*\}/g,
    "",
  );
  const norm = (v: string) => v.replace(/\s+/g, " ").trim();
  const probe = (width: number) => probeAt(width, cssForViewport(css, width));

  it("at 390 px: the day and its actions on row 1, the control under it over the full width", () => {
    const p = probe(390);
    const row = p.styles("av-recurring-row", "div");
    expect(norm(row.getPropertyValue("grid-template-areas"))).toBe(
      '"dow actions" "control control"',
    );
    expect(p.styles("av-dow", "span").getPropertyValue("grid-area")).toBe("dow");
    expect(p.styles("av-actions", "div").getPropertyValue("grid-area")).toBe("actions");
  });

  it("at 1024 px it is one row, with no named areas", () => {
    const row = probe(1024).styles("av-recurring-row", "div");
    expect(row.getPropertyValue("grid-template-areas")).not.toContain("control");
    expect(row.getPropertyValue("grid-template-columns")).toContain("auto");
  });

  it("controls: an invented class gets no areas", () => {
    const row = probe(390).styles(INVENTED_CLASS, "div");
    expect(row.getPropertyValue("grid-template-areas")).not.toContain("control");
  });
});
