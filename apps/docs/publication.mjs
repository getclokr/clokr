// The one place where the publication of a docs/ file is decided (Issue #1064).
//
// Exclusion and redaction never delete or edit a doc: the Markdown stays in docs/ exactly as it
// is, and only what the SITE presents changes. The repository is public, so this governs what the
// site shows (page set, search index, rendering), not what is secret — the internal names listed
// below are already visible in the repository and its history (owner decision OD-4); scrubbing
// them is a separate decision.
//
// Never pass anything from this module into `themeConfig` or any other client-serialized site
// data: VitePress writes those into the page bundle, which would publish the very literals the
// DENYLIST exists to keep out. Only the node side (config, markdown plugins, the post-build gate)
// imports this file.

/** URL base of the GitHub Pages project site https://getclokr.github.io/clokr/ */
export const SITE_BASE = "/clokr/";

/** Public repository the site links to for everything it does not render. */
export const REPO_URL = "https://github.com/getclokr/clokr";

/** Branch the repository links point at. */
export const REPO_BRANCH = "main";

/**
 * Files that produce no page. `path` is relative to docs/ and is either an exact file or a
 * `dir/**` prefix. The files stay readable on GitHub.
 *
 * @type {ReadonlyArray<{ path: string, reason: string }>}
 */
export const EXCLUDED = [
  {
    path: "admin-guide.md",
    reason: "Superseded by docs/handbuch (pre-v2 UI, Sie-form); deletion is a follow-up (OD-6)",
  },
  {
    path: "user-guide.md",
    reason: "Superseded by docs/handbuch (pre-v2 UI, Sie-form); deletion is a follow-up (OD-6)",
  },
  {
    path: "characterization-baseline.md",
    reason: "Internal measurement ledger tied to gitignored planning artifacts",
  },
  {
    path: "context-coverage-baseline.md",
    reason: "Internal measurement ledger tied to gitignored planning artifacts",
  },
  {
    path: "image-footprint.md",
    reason: "Internal measurement ledger tied to gitignored planning artifacts",
  },
  {
    path: "data-refresh-process.md",
    reason: "Internal int/homelab topology (kubectl, ssh, internal git host)",
  },
  {
    path: "int-environment.md",
    reason: "Internal int/homelab topology (kubectl, ssh, internal git host)",
  },
  { path: "prod-deploy.md", reason: "Prod host topology and operator runbook" },
  {
    path: "half-day-absence-backfill.md",
    reason: "One-off, owner-gated prod data runbook",
  },
  {
    path: "runbooks/backfill-month-snapshots.md",
    reason: "One-off, owner-gated prod data runbook",
  },
  {
    path: "runbooks/opening-balance-migration.md",
    reason: "One-off, owner-gated prod data runbook",
  },
  { path: "simulation.md", reason: "Describes the non-public simulation server" },
  {
    path: "design/**",
    reason: "Local-only, gitignored designer handoff (exists in working copies, never in CI)",
  },
];

/**
 * Ordered literal find/replace pairs applied at render time to every published page (text, code
 * and HTML tokens, so the local search index sees the redacted text as well). Order matters: the
 * longer, more specific literals come before the bare ones they contain.
 *
 * @type {ReadonlyArray<{ find: string, replace: string, reason: string }>}
 */
export const REDACTIONS = [
  { find: "/opt/awh-infra/.env", replace: "<prod-env-file>", reason: "Prod env file path" },
  { find: "/opt/clokr/backups", replace: "<backup-dir>", reason: "Prod backup path" },
  { find: "dmz-proxy", replace: "<prod-host>", reason: "Prod host name" },
  { find: "clokr-demo", replace: "<demo-host>", reason: "Demo host name" },
  { find: "~/git/homelab", replace: "<gitops-repo>", reason: "Homelab GitOps checkout" },
  { find: "k8s-homelab", replace: "<gitops-repo>", reason: "Homelab GitOps repository" },
  { find: "homelab", replace: "GitOps", reason: "Remaining homelab wording" },
];

/**
 * Lower-case literals that must appear in NO file of the build output (checked case-insensitively
 * by scripts/check-site.mjs after the build). A new doc naming an internal host fails the gate
 * instead of shipping.
 *
 * @type {ReadonlyArray<string>}
 */
export const DENYLIST = [
  "dmz-proxy",
  "awh-infra",
  "/opt/awh",
  "/opt/clokr",
  "homelab",
  "git.internal",
  "clokr-demo",
  "opnsense",
];

/**
 * Whether `relPath` (relative to docs/, forward slashes) matches an EXCLUDED entry.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isExcluded(relPath) {
  return EXCLUDED.some(({ path }) =>
    path.endsWith("/**") ? relPath.startsWith(path.slice(0, -2)) : relPath === path,
  );
}
