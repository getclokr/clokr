// Issue #991 (acceptance) - the one-off list and its dialog: the list is a DataTable block (cards
// with a printed label below 760 px, so „Notiz“ and „Aktion“ stay reachable on a phone), a NEW
// one-off dialog says „anlegen“ and an existing one „bearbeiten“, and the three status options are
// equal-width segments.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/svelte";

// The tenant zone comes through the tenant-features store, which imports the API client.
vi.mock("$api/client", () => ({ api: { get: vi.fn(async () => ({})) } }));

import { renderWithTheme } from "$tests/test-utils";
import AvailabilityOneOffList from "../AvailabilityOneOffList.svelte";
import AvailabilityEditModal from "../AvailabilityEditModal.svelte";
import listSource from "../AvailabilityOneOffList.svelte?raw";
import segmentedSource from "../../ui/SegmentedControl.svelte?raw";

afterEach(() => {
  cleanup();
});

const ENTRY = {
  date: "2027-03-02",
  status: "UNAVAILABLE" as const,
  note: "Arzttermin",
  validFrom: "2027-03-01",
};

function renderList() {
  return renderWithTheme(AvailabilityOneOffList, { entries: [ENTRY], disabled: false } as never);
}

describe("one-off list as a table block (#991)", () => {
  it("prints every column as a labelled cell, Notiz and Aktion included", () => {
    const { container } = renderList();
    const labels = Array.from(container.querySelectorAll("tbody td")).map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual(expect.arrayContaining(["Status", "Gültig bis", "Notiz", "Aktion"]));
    expect(container.querySelector('td[data-label="Notiz"]')?.textContent).toContain("Arzttermin");
  });

  it("keeps both row actions as buttons", () => {
    renderList();
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeTruthy();
  });

  it("owns no table markup and no fixed-width scroll box", () => {
    expect(listSource).not.toMatch(/<table[\s>]/);
    expect(listSource).not.toContain("table-scroll");
  });
});

describe("dialog title (#991)", () => {
  it("a new one-off is „anlegen“, an existing one „bearbeiten“", async () => {
    renderList();
    await fireEvent.click(screen.getByRole("button", { name: /Einmaltermin hinzufügen/ }));
    expect(await screen.findByRole("heading", { name: "Einmaltermin anlegen" })).toBeTruthy();
    cleanup();

    renderList();
    await fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(await screen.findByRole("heading", { name: "Einmaltermin bearbeiten" })).toBeTruthy();
  });

  it("the modal defaults to „bearbeiten“ without isNew", async () => {
    renderWithTheme(AvailabilityEditModal, {
      open: true,
      mode: "oneoff",
      onsave: () => {},
      oncancel: () => {},
    } as never);
    expect(await screen.findByRole("heading", { name: "Einmaltermin bearbeiten" })).toBeTruthy();
  });
});

describe("status segments (#991)", () => {
  it("the dialog asks the control for equal-width segments", async () => {
    renderWithTheme(AvailabilityEditModal, {
      open: true,
      mode: "oneoff",
      isNew: true,
      onsave: () => {},
      oncancel: () => {},
    } as never);
    const group = await screen.findByRole("radiogroup", { name: "Status" });
    expect(group.classList.contains("seg-control--fill")).toBe(true);
    expect(group.getAttribute("style")).toContain("--seg-count: 3");
  });

  it("fill is a one-row grid whose labels wrap inside their segment", () => {
    const css = segmentedSource.slice(segmentedSource.indexOf("<style"));
    const rule = /\.seg-control--fill\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("display: grid");
    expect(rule![1]).toContain("repeat(var(--seg-cols, var(--seg-count, 1))");
    const btn = /\.seg-control--fill \.seg-btn\s*\{([^}]*)\}/.exec(css);
    expect(btn![1]).toContain("white-space: normal");
  });
});
