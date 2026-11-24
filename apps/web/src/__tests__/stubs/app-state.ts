// Minimal stand-in for SvelteKit's virtual `$app/state` module inside vitest (Issues #609, #843).
//
// vitest.config.ts declares no general `$app` alias, and several modules read `page` from
// `$app/state`: `lib/table/url-state.ts` takes its default reader from `page.url`, and the
// dashboard page reads the reminder parameter `?clock=1`, so a mounted dashboard test could not
// resolve the import. The default page is a plain URL without a query; tests that care inject
// their own reader into `urlState()` or replace the module with `vi.mock("$app/state", ...)`. Do
// NOT add other exports here without a concrete need (ADR 0002, Entscheidung 2).
export const page = {
  url: new URL("http://localhost/"),
  params: {} as Record<string, string>,
  state: {} as Record<string, unknown>,
};
