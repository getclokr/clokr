// Issue #975 - the pre-paint script of app.html. It runs before the first paint, so a dark device
// never shows a light flash. The script text is read out of app.html by its id and executed against
// a recording <html> stand-in with stubbed storage and matchMedia: no browser, no app JS.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

vi.mock("$api/preferences", () => ({
  savePreferences: vi.fn(() => Promise.resolve({})),
}));

const html = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app.html"),
  "utf8",
);

const SCRIPT = /<script id="clokr-look">([\s\S]*?)<\/script>/.exec(html);

interface Run {
  attrs: Record<string, string>;
  threw: boolean;
}

function run(opts: {
  storage?: Record<string, string>;
  dark?: boolean;
  noMatchMedia?: boolean;
  throwingStorage?: boolean;
}): Run {
  const attrs: Record<string, string> = {};
  const root = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
  const doc = { documentElement: root };
  const storage = opts.throwingStorage
    ? {
        getItem: () => {
          throw new Error("storage blocked");
        },
      }
    : { getItem: (k: string) => opts.storage?.[k] ?? null };
  const win = opts.noMatchMedia ? {} : { matchMedia: () => ({ matches: opts.dark === true }) };
  let threw = false;
  try {
    new Function("document", "localStorage", "window", SCRIPT![1])(doc, storage, win);
  } catch {
    threw = true;
  }
  return { attrs, threw };
}

describe("#975 app.html pre-paint script", () => {
  it("exists, sits in <head> before %sveltekit.head%, has no src and no network call", () => {
    expect(SCRIPT, "script#clokr-look").not.toBeNull();
    const tag = html.slice(html.indexOf('<script id="clokr-look"'));
    expect(tag.startsWith('<script id="clokr-look">')).toBe(true);
    expect(html.indexOf('<script id="clokr-look"')).toBeGreaterThan(html.indexOf("<head>"));
    expect(html.indexOf('<script id="clokr-look"')).toBeLessThan(html.indexOf("%sveltekit.head%"));
    expect(html.indexOf("</head>")).toBeGreaterThan(html.indexOf("%sveltekit.head%"));
    expect(SCRIPT![1]).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|innerHTML|document\.write/);
    // exactly one inline script in app.html, so the nonce rewrite has one tag to carry
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });

  it("an empty storage and a dark device give data-mode dark and no data-theme", () => {
    const { attrs, threw } = run({ dark: true });
    expect(threw).toBe(false);
    expect(attrs["data-mode"]).toBe("dark");
    expect(attrs["data-theme"]).toBeUndefined();
  });

  it("an empty storage and a light device give data-mode light", () => {
    expect(run({ dark: false }).attrs["data-mode"]).toBe("light");
  });

  it("stored mode light with a dark device gives light, stored dark with a light device gives dark", () => {
    expect(run({ storage: { mode: "light" }, dark: true }).attrs["data-mode"]).toBe("light");
    expect(run({ storage: { mode: "dark" }, dark: false }).attrs["data-mode"]).toBe("dark");
  });

  it("stored system or a garbage mode gives the device mode", () => {
    for (const mode of ["system", "auto", "", "<img>"]) {
      expect(run({ storage: { mode }, dark: true }).attrs["data-mode"], mode).toBe("dark");
      expect(run({ storage: { mode }, dark: false }).attrs["data-mode"], mode).toBe("light");
    }
  });

  it("every theme id of the theme store, stored as theme, sets data-theme to that id", async () => {
    // theme.ts reads localStorage at import time; this workspace's jsdom exposes none.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const { themes } = await import("$stores/theme");
    vi.unstubAllGlobals();
    expect(themes.length).toBe(3);
    for (const { id } of themes) {
      expect(run({ storage: { theme: id } }).attrs["data-theme"], id).toBe(id);
    }
  });

  it("an unknown or hostile theme sets no data-theme", () => {
    for (const theme of ["lila", "wald", "<img src=x onerror=alert(1)>", "PETROL", ""]) {
      expect(run({ storage: { theme } }).attrs["data-theme"], theme).toBeUndefined();
    }
  });

  it("without matchMedia the mode is light and nothing throws", () => {
    const { attrs, threw } = run({ noMatchMedia: true });
    expect(threw).toBe(false);
    expect(attrs["data-mode"]).toBe("light");
  });

  it("a throwing storage still sets data-mode from the device and throws nothing", () => {
    const dark = run({ throwingStorage: true, dark: true });
    expect(dark.threw).toBe(false);
    expect(dark.attrs["data-mode"]).toBe("dark");
    expect(run({ throwingStorage: true, dark: false }).attrs["data-mode"]).toBe("light");
  });
});
