// Issue #1028 - the Pager: the range in a polite live region, ‹ › buttons, the page-size choice, hidden
// while every row fits the smallest size.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/svelte";
import { renderWithTheme } from "$tests/test-utils";
import Pager from "../Pager.svelte";

const WIDGET_SIZES = [5, 10, 20];

function range(): string {
  return (screen.getByTestId("pager-range").textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("Pager (Issue #1028)", () => {
  it("reads „1–5 von 44“ in a polite live region", () => {
    renderWithTheme(Pager, { total: 44, page: 1, pageSize: 5, sizes: WIDGET_SIZES });
    expect(range()).toBe("1–5 von 44");
    const live = screen.getByTestId("pager-range");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("navigation", { name: "Seitennavigation" })).toBeInTheDocument();
  });

  it("is hidden while the rows fit the smallest size", () => {
    const { container } = renderWithTheme(Pager, {
      total: 5,
      page: 1,
      pageSize: 5,
      sizes: WIDGET_SIZES,
    });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("shows from one row more than the smallest size", () => {
    renderWithTheme(Pager, { total: 6, page: 1, pageSize: 5, sizes: WIDGET_SIZES });
    expect(range()).toBe("1–5 von 6");
  });

  it("disables ‹ on the first page and › on the last, and steps through the pages", async () => {
    const onChange = vi.fn();
    renderWithTheme(Pager, { total: 44, page: 1, pageSize: 20, sizes: WIDGET_SIZES, onChange });
    const prev = screen.getByRole("button", { name: "Vorherige Seite" });
    const next = screen.getByRole("button", { name: "Nächste Seite" });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    await fireEvent.click(next);
    expect(range()).toBe("21–40 von 44");
    expect(onChange).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    await fireEvent.click(next);
    expect(range()).toBe("41–44 von 44");
    expect(next).toBeDisabled();
    expect(prev).not.toBeDisabled();
    await fireEvent.click(prev);
    expect(range()).toBe("21–40 von 44");
  });

  it("offers exactly the given sizes and returns to page 1 when the size changes", async () => {
    const onChange = vi.fn();
    renderWithTheme(Pager, { total: 44, page: 3, pageSize: 5, sizes: WIDGET_SIZES, onChange });
    const select = screen.getByLabelText("Zeilen pro Seite") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["5", "10", "20"]);
    expect(select.value).toBe("5");

    await fireEvent.change(select, { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
    expect(range()).toBe("1–10 von 44");
  });

  it("ignores a size that is not offered", async () => {
    const onChange = vi.fn();
    renderWithTheme(Pager, { total: 44, page: 1, pageSize: 5, sizes: WIDGET_SIZES, onChange });
    const select = screen.getByLabelText("Zeilen pro Seite") as HTMLSelectElement;
    const odd = document.createElement("option");
    odd.value = "7";
    odd.textContent = "7";
    select.append(odd);
    await fireEvent.change(select, { target: { value: "7" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps a page past the end (the rows shrank)", () => {
    renderWithTheme(Pager, { total: 12, page: 9, pageSize: 5, sizes: WIDGET_SIZES });
    expect(range()).toBe("11–12 von 12");
  });

  it("can append the noun of the legacy Pagination", () => {
    renderWithTheme(Pager, {
      total: 14,
      page: 1,
      pageSize: 10,
      sizes: [10, 25, 50],
      noun: { one: "Eintrag", many: "Einträge" },
    });
    expect(range()).toBe("1–10 von 14 Einträge");
  });

  it("can be forced visible for a single page", () => {
    renderWithTheme(Pager, {
      total: 3,
      page: 1,
      pageSize: 25,
      sizes: [25, 50, 100],
      showWhenSinglePage: true,
    });
    expect(range()).toBe("1–3 von 3");
  });
});
