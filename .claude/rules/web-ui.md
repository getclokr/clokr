---
paths:
  - "apps/web/**"
  - "apps/e2e/**"
  - "docs/glossar.md"
  - "docs/ADMIN_STRUCTURE.md"
  - "packages/types/audit-labels.json"
---

Moved verbatim from CLAUDE.md (§ UI Consistency Rules; § Svelte 5 Gotchas; § Svelte 5 Patterns).

## UI Consistency Rules

Read these before modifying any page in `apps/web` — they are checked in, unlike anything under
`.planning/`, which is gitignored and therefore unreadable for anyone else:

| Source                                  | What it governs                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/tokens.css`               | The one token source — the D-05 colour roles and the non-colour tokens for pflaume\|salz\|petrol × light\|dark (`data-theme` × `data-mode` on any element), the Figtree and JetBrains Mono `@font-face`, the leave-type aliases |
| `apps/web/.lintrc-tokens.txt`           | The deny list `scripts/lint-tokens.mjs` parses (retired names, old fonts, the retired axes) plus the old → new cheat sheet                        |
| `apps/web/scripts/lint-tokens.mjs`      | `lint:tokens`: fails on a retired name (referenced or declared) and on any `var(--x)` nothing in `src` declares; aborts on zero files or an empty deny list (Issue #842) |
| `apps/web/src/__tests__/token-contrast-842.test.ts` + `token-cascade.ts` | Every role pair ≥ 4.5:1 in all six combinations, parsed from the real `tokens.css`; `token-cascade.ts` is the one cascade resolver of the CSS proofs |
| `apps/web/src/app.css`                  | The shared class recipes — card surfaces, `.badge`, `.callout`, calendar cells, page wrapper, section stacking, summary bars, entrance animations |
| `apps/web/scripts/lint-ui-classes.mjs`  | Which class names are allowed in the scoped primitive directories, and where that scope ends                                                      |
| `docs/ADMIN_STRUCTURE.md §3.2.1`        | When a control saves instantly and when it waits for the section button (Phase 109, D-01/D-02)                                                    |
| `apps/web/src/lib/utils/chart-theme.ts` | The one chart style source — colours from tokens, tension 0, unit axis titles, zero line, chart kinds and their aria-labels (Issue #591)          |
| `docs/glossar.md` | The binding vocabulary and the address form „du“ for every web-app text (Issue #574) |
| `apps/web/src/lib/nav/routes.ts` | The one route table (Issue #844): every page's URL, area Ich · Team · Verwalten, name (= menu = H1 = crumb), width, permissions and route file; `src/hooks.ts` reroutes new URLs to the files, old URLs redirect; read through `page-labels.ts` (Issue #574) |
| `apps/web/src/lib/components/ui/README.md` | The twelve building blocks of Issue #843 — one entry component each, their sub-parts, legacy delegates (`PageHead`, `MonthBar`, `PeriodSwitcher`, `KPIStat`, `Modal`, `ConfirmDialog`, `ReasonDialog`) and the block rules |
| `apps/web/src/tailwind-theme.css` | Tailwind 4 as token pipeline only — the roles of `tokens.css` mapped as `var(--<role>)`; the ONE named `lint:tokens` carve-out for the `--color-` / `--radius-` prefixes (D-843-13) |
| `apps/web/scripts/lint-ui-classes-route-ratchet.json` | Page-own patterns (filter bar, period control, KPI card, data table) in routes and area components: falling-only, every entry with its page ticket (#845–#854), null only with a written reason (Issue #843) |
| `apps/web/scripts/lint-no-alert.mjs` | `lint:no-alert`: no `alert(` / `confirm(` / `prompt(` in `apps/web/src` outside tests (Issue #843) |
| `apps/web/src/lib/settings/settings-pages.ts` | The one place a tenant setting is assigned to a Verwalten page and section — keys, endpoint, rendering file and permission alternatives per section (Issue #854); proof `settings-pages-854.test.ts`, which also carries the #878 own-fields rule |
| `packages/types/audit-labels.json` | The one audit vocabulary (German action and entity labels) shared by the web list and the API CSV export (Issue #854); proof `labels-854.test.ts` |

Reuse an existing recipe from `app.css` before inventing a class or a token.

Design system v2 (Issue #842), as built: `tokens.css` is the only file that declares a colour role
(`design-guards-842.test.ts` fails on a second declaration site). Type is Figtree (UI, tabular numerals
global) and JetBrains Mono for code and raw data only, both self-hosted; there are no italics, and the
shared `app.css` label recipes carry no uppercase or letter-spacing. `--accent` is a fill, never a text
colour (guarded). Text on a solid status fill uses `--card`, on a brand fill `--brand-ink` (guarded). The
retired v1.5/v1.2 names, the old font families and the former skin and density axes are denied by
`lint:tokens`, `fonts-842` and `no-skin-density-842`. No per-route old/new token flag exists.

Design system v2 building blocks (Issue #843), as built: the twelve blocks live once in
`apps/web/src/lib/components/ui` on bits-ui (the only primitive library, exact pin), documented in
`ui/README.md`. Tailwind 4 is wired as a token pipeline only (`@tailwindcss/vite`, `tailwind-theme.css`,
no preflight): utilities are allowed inside `lib/components/ui`, a route with a utility class fails a guard,
and the blocks themselves are scoped CSS on the `tokens.css` roles. The example page `/admin/bausteine`
renders every block in the six theme × mode frames. `Skeleton` is the only loading state (no visible
„Laden…“ text anywhere, guarded by a source scan) and `Spinner` lives only inside buttons; every write of a
start page acknowledges its result through `toasts`. Dialogs portal to `body` above the topbar and make the
rest of the page `inert`. The blocks are responsive only through container queries at 760 / 1100 px
(`ui/breakpoints.ts`); the one named exception is `PeriodPicker`, which keeps the viewport rules of the old
`MonthBar` (D-843-21). A page-own pattern that a block replaces is registered in the ratchet above until its
page ticket migrates it; a new one fails `lint:ui-classes`.

`ConfirmDialog` swallows a refused `onConfirm` (Phase 89): the dialog stays open, the button is
re-enabled and nothing is rethrown, so a refusal is no unhandled rejection and needs no
`process.on("unhandledRejection")` allow-list in a test. `ReasonDialog` still throws to its
`ConfirmDialog` to keep its inline error.

Verify with `pnpm --filter @clokr/web lint:tokens` + `lint:ui-classes` + `lint:save-pattern` +
`lint:ui-terms` (forbidden terms in shown text, `docs/glossar.md`, Issue #574) + `lint:no-alert` (Issue #843);
`lint:ui-classes`, `lint:tokens`, `lint:ui-terms` and `lint:no-alert` also run in the pre-commit hook. `lint:ui-classes` checks the
class names of `lib/components/ui/` and `lib/components/layout/` and, since #843, scans every `.svelte` file under
`src/routes` and the area components under `lib/components` for page-own filter bars, period controls, KPI cards and
data tables against the ratchet register (raw `.scrim` / `.modal` markup has no register and always fails).

- **Charts are built in one way (Issue #591).** Every chart.js chart is created as `new Chart(<canvas>,
<builder>(…))` with a builder of `apps/web/src/lib/dashboard/team-charts.ts`. A builder draws from a
  descriptor (kind, unit, subject) that also yields the canvas aria-label through `chartAriaLabel()`, so
  the label names the drawn type and unit. Counts are columns, a signed series is a line with tension 0
  and an emphasised zero line, Soll/Ist are grouped columns. Every value axis carries `CHART_UNIT_TITLE`
  and colours come only from tokens. A month click and the header link „Bericht →“ open `/reports` only
  through `periodSearch` (#612) and only when `reportRights().periodTabs` holds the tab.
  `apps/web/src/__tests__/chart-style-591.test.ts` fails on a chart file without the theme import, any
  tension other than 0, an inline config, a value axis without a unit title, a literal canvas
  aria-label, a colour literal in the style or builder module, or a hand-built report query.

## Svelte 5 Gotchas

- `{@const}` can only be used inside `{#if}`, `{#each}`, `{#snippet}` — NOT inside `<div>`
- Use `$derived` for computed values instead of `{@const}` in templates
- Use `preventDefault` from `svelte/legacy` for form handlers

<!-- Svelte MCP server (list-sections / get-documentation / svelte-autofixer) is self-documenting via system-reminder at session start. -->

## Svelte 5 Patterns

- Use `$state()` for component-local reactive state: `let loading = $state(false)`
- Use `$derived()` for computed values: `let visible = $derived(items.slice(-5))`
- Use `$effect()` sparingly — prefer `onMount` for initialization
- Stores use `svelte/store` writable pattern (not Svelte 5 runes) for cross-component state: `apps/web/src/lib/stores/auth.ts`
- Define `interface Props` then destructure: `let { children }: Props = $props()`
- Use default values in destructuring: `let { icon = "inbox", title, description }: Props = $props()`
- Snippet-based children: `children?: import("svelte").Snippet`
- Direct `api.get()` / `api.post()` calls inside `onMount` or event handlers
- `@tanstack/svelte-query` is listed as a dependency but not currently used in routes (direct fetch pattern prevalent)
- Loading/error state managed locally per page
- Scoped `<style>` blocks in each component — no Tailwind utility classes in route markup (Tailwind v4 is wired as a token pipeline only, #843; utilities are permitted only inside `lib/components/ui`)
- CSS custom properties for theming (v2): `var(--brand)`, `var(--text)`, `var(--card)` — defined only in `apps/web/src/tokens.css`. Retired v1.5/v1.2 names are denied by `lint:tokens` (see UI Consistency Rules).
- Global styles in `apps/web/src/app.css` (~2800 lines) over the token layer (`data-theme` × `data-mode` attributes)
- Three themes: `pflaume` (default), `salz`, `petrol`, each in `data-mode` light|dark. A personal preference (`/admin/themes`, saved through `PUT /me/preferences`); no skin axis, no density axis, no tenant default
- BEM-like class naming: `.admin-tab`, `.admin-tab--active`, `.toast-container`, `.empty-state-title`
- Responsive via `@media` queries in component styles
