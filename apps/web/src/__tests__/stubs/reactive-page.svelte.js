// Reactive stand-in for SvelteKit's `page` from `$app/state` in tests that drive a navigation.
//
// The default stub (`app-state.ts`) is a plain object: right for a reader that looks once. A test
// that proves "something happens when the path changes" (the error boundary reset, Issue #161)
// needs the same fine-grained reactivity the real `page` has, so this module holds the object as
// `$state` and `navigateReactivePage()` swaps its URL. Used only through a `vi.mock("$app/state")`
// factory of the one test that needs it. Plain JS with JSDoc: the root ESLint config has no
// TypeScript parser for `*.svelte.ts` modules.

// A whole new URL is assigned on navigation (like kit does), so SvelteURL is not needed.
/* eslint-disable svelte/prefer-svelte-reactivity */
export const reactivePage = $state({
  url: new URL("http://localhost/"),
  /** @type {Record<string, string>} */
  params: {},
  /** @type {Record<string, unknown>} */
  state: {},
});

/** @param {string} path */
export function navigateReactivePage(path) {
  reactivePage.url = new URL(`http://localhost${path}`);
}
/* eslint-enable svelte/prefer-svelte-reactivity */
