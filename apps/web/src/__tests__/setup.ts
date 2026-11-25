// Vitest globalSetup file — registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveClass, toHaveTextContent, etc.) and applies a
// cleanup() between tests so each test starts with a fresh DOM.
//
// Wired in apps/web/vitest.config.ts via test.setupFiles.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";

// Issue #1028: `DataTable` now reaches the auth store through the list-preference store, and the auth
// store reads `localStorage` when it is imported. Newer Node versions (25+) define a `localStorage`
// global that is unusable without `--localstorage-file` and hides the one of jsdom, so every test that
// renders a table would fail on import. Stub an in-memory one ONLY when none is usable; where jsdom's
// own exists (CI, Node 24) nothing changes, and a test that stubs its own still wins (it runs later).
if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.removeItem !== "function"
) {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

afterEach(() => {
  cleanup();
});
