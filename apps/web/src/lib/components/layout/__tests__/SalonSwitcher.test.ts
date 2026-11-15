// Issue #82 (D-12, #64 rule) — the Topbar salon selector, mounted against the REAL singleton store
// driven through `salonContext.load()`; only `$api/client` (the server answer) and the logger are
// mocked. The store is a module singleton, so every test resets it in `afterEach`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

const apiGet = vi.fn();

vi.mock("$api/client", () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
  ApiError: class extends Error {
    constructor(
      public status: number,
      message = "err",
    ) {
      super(message);
    }
  },
}));
vi.mock("$lib/utils/logger", () => ({ clientLogger: { warn: vi.fn(), error: vi.fn() } }));

import { salonContext, selectedSalonId } from "$stores/salon-context";
import SalonSwitcher from "../SalonSwitcher.svelte";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

const S1 = { id: "s1", name: "Salon Nord" };
const S2 = { id: "s2", name: "Salon Ost" };
const KEY = "clokr.salonContext.t1.u1";

function answer(salons = [S1, S2], isMultiSalon = true) {
  return { tenant: { id: "t1", name: "Kette" }, isMultiSalon, homeSalonId: "s1", salons };
}

async function loadWith(body: ReturnType<typeof answer>) {
  apiGet.mockResolvedValueOnce(body);
  await salonContext.load("u1", { force: true });
  await tick();
}

beforeEach(() => {
  apiGet.mockReset();
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  salonContext.reset();
  vi.unstubAllGlobals();
});

describe("SalonSwitcher (Issue #82)", () => {
  it("tracer: two salons → „Alle Salons“ plus both, a choice applies instantly", async () => {
    render(SalonSwitcher);
    await loadWith(answer());
    const select = screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.textContent)).toEqual(["Alle Salons", "Salon Nord", "Salon Ost"]);
    expect(options.map((o) => o.value)).toEqual(["ALL", "s1", "s2"]);
    expect(select.value).toBe("ALL");

    await fireEvent.change(select, { target: { value: "s2" } });
    await tick();
    expect(salonContext.peek().selection).toBe("s2");
    expect(selectedSalonId(salonContext.peek())).toBe("s2");
    expect(localStorage.getItem(KEY)).toBe("s2");
    expect(select.value).toBe("s2");
  });

  it("Issue #951: is disabled with a hint on a page that never reads the salon, active on one that does", async () => {
    const view = render(SalonSwitcher, { pathname: "/verwalten/regeln/arbeitszeit" });
    await loadWith(answer());
    const select = screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.closest("label")?.getAttribute("title")).toBe("Wirkt auf dieser Seite nicht");
    view.unmount();

    render(SalonSwitcher, { pathname: "/team/zeiten" });
    await tick();
    const active = screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement;
    expect(active.disabled).toBe(false);
    expect(active.closest("label")?.getAttribute("title")).toBeNull();
  });

  it("renders nothing before any load", () => {
    render(SalonSwitcher);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Salon")).toBeNull();
  });

  it.each([
    ["a single-salon tenant", answer([S1], false)],
    ["a multi-salon tenant with one reachable salon", answer([S1], true)],
    ["zero reachable salons", answer([], true)],
  ])("renders nothing for %s", async (_label, body) => {
    render(SalonSwitcher);
    await loadWith(body);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Salon")).toBeNull();
  });

  it("renders nothing after a rejected first load", async () => {
    render(SalonSwitcher);
    apiGet.mockRejectedValueOnce(new TypeError("offline"));
    await salonContext.load("u1", { force: true });
    await tick();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("follows 1 → 2 → 1 → 2 salons live, without a remount, and keeps a still-listed choice", async () => {
    render(SalonSwitcher);
    await loadWith(answer([S1], false));
    expect(screen.queryByRole("combobox")).toBeNull();

    await loadWith(answer());
    const select = screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement;
    expect(select.value).toBe("ALL");
    await fireEvent.change(select, { target: { value: "s1" } });

    await loadWith(answer([S1], false));
    expect(screen.queryByRole("combobox")).toBeNull();

    await loadWith(answer());
    expect((screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement).value).toBe("s1");
  });

  it("a manipulated stored value shows „Alle Salons“ after the load", async () => {
    localStorage.setItem(KEY, crypto.randomUUID()); // a uuid that is not in the list
    render(SalonSwitcher);
    await loadWith(answer());
    expect((screen.getByRole("combobox", { name: "Salon" }) as HTMLSelectElement).value).toBe(
      "ALL",
    );
  });

  it("the select takes focus and keeps the accessible name „Salon“", async () => {
    render(SalonSwitcher);
    await loadWith(answer());
    const select = screen.getByRole("combobox", { name: "Salon" });
    select.focus();
    expect(document.activeElement).toBe(select);
    expect(screen.getByText("Salon")).toBeInTheDocument();
  });
});

// Issue #945 — on a phone the pill shrinks to its icon so the page title beside it is never cut; the
// global `.filter-select` minimum (130 px) must not hold it open.
describe("SalonSwitcher on a phone (Issue #945)", () => {
  it("is a 44 px icon button below 640 px, overriding the filter-select minimum", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/components/layout/SalonSwitcher.svelte"),
      "utf8",
    );
    const phone = src.slice(src.indexOf("@media (max-width: 640px)"));
    const rule = phone.match(/\.salon-switcher-select\s*\{[^}]*\}/)?.[0] ?? "";
    for (const decl of [
      "width: 44px",
      "min-width: 44px",
      "max-width: 44px",
      "color: transparent",
    ]) {
      expect(rule, decl).toContain(decl);
    }
  });
});
