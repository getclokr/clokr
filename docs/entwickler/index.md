# Entwickler-Doku

This is the developer documentation of Clokr. It lives in the repository's `docs/` directory, is written in English and is aimed at people who build, run or release Clokr. The customer-facing user guide is the [Handbuch](../handbuch/index.md).

## Where to start

- [Getting started](../getting-started.md) — run the stack.
- [Architecture](architecture.md) — tiers, monorepo layout, contexts and scheduled jobs.
- [Configuration](configuration.md) — every environment variable of the API and the web container.
- [Deployment](../deployment.md) — run Clokr on your own infrastructure.
- [Database migrations](../migrations.md) — how schema changes are created and applied.
- [Testing](../testing.md) — the test databases and how to run the suites.
- [Release process](../release-process.md) — the order in which a release is cut and promoted.
- [Four contexts and the substrate](../adr/0002-vier-kontexte-und-unterbau.md) — the architecture decision that shapes the code layout.

## How this site is built

The site is rendered by the workspace package `apps/docs` (VitePress, exact version pinned). It reads the Markdown files of `docs/` where they live — nothing is copied, moved or given extra frontmatter — so the same file serves GitHub, the site and, for `docs/release-notes`, the API image.

- `apps/docs/publication.mjs` decides what the site publishes: which files are excluded, which internal names are redacted at render time and which literals must not appear anywhere in the build output (the denylist).
- The repository is public. Excluded files stay readable on GitHub; the exclusion only decides what the site presents.
- A new Markdown file under `docs/` needs a decision: add it to a sidebar group in `apps/docs/navigation.mjs` or to `EXCLUDED` in `publication.mjs`, otherwise the post-build gate fails.
- Commands: `pnpm --filter @clokr/docs dev` (local preview), `pnpm --filter @clokr/docs build` (build, fails on a dead internal link) and `pnpm --filter @clokr/docs check` (post-build gate).

## Known gaps between the UI and the behaviour

The Handbuch describes only what the app does. Where the UI promises more than the code delivers, the Handbuch says so neutrally and the gap is tracked here.

- **Betriebsurlaub does not deduct anything** ([#1069](https://github.com/getclokr/clokr/issues/1069)). `CompanyShutdown.deductsFromVacation` and `CompanyShutdownException` are stored and shown (`contexts/absence/api/company-shutdowns.ts`, read for display by `leave-plan/planner-read.ts`), but nothing books leave days or lowers the Soll, although the UI says „Zieht vom Urlaubskonto ab“. The Handbuch page [Abwesenheiten und Urlaub](../handbuch/verwalten/abwesenheiten-und-urlaub.md) states that the setting is recorded and the automatic deduction is being built. When #1069 ships, update that page and remove this entry.
