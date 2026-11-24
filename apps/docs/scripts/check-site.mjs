// Post-build gate of the docs site (Issue #1064): `node scripts/check-site.mjs [--complete]`.
//
// Reads apps/docs/.vitepress/dist, the repository's docs/ directory and publication.mjs, prints
// one line per finding and a summary, and exits 0 (clean) or 1 (findings).
//
//   1. the build output exists and holds HTML
//   2. the page set equals the set of published Markdown files (proves the exclusions work and no
//      page was silently dropped)
//   3. no file of the output contains a DENYLIST literal (case-insensitive)
//   4. every internal href/src of every page resolves, anchors included
//   5. three probes prove the redaction, the repo-link rewrite and the pseudo-tag escape ran
//
//   6. every page except the home page sits in a sidebar group, every sidebar link has a page
//   7. with `--complete`: every planned Handbuch page and every explicit Entwickler page exists

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENTWICKLER_GROUPS, HANDBUCH_PAGES, sidebarLinks } from "../navigation.mjs";
import { DENYLIST, SITE_BASE, isExcluded } from "../publication.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DOCS_DIR = path.resolve(here, "../../../docs");
export const DIST_DIR = path.resolve(here, "../.vitepress/dist");

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".json",
  ".css",
  ".svg",
  ".xml",
  ".txt",
  ".map",
  ".md",
  ".webmanifest",
]);

/** @param {string} dir @returns {string[]} absolute paths of every file below `dir` */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** @param {string} file @param {string} root @returns {string} forward-slash path relative to root */
const rel = (file, root) => path.relative(root, file).split(path.sep).join("/");

/** The HTML file a published Markdown file becomes (relative to dist). */
export const htmlFor = (/** @type {string} */ mdPath) => mdPath.replace(/\.md$/, ".html");

/** @param {string} link a sidebar link (`/a/b`, `/a/`) @returns {string} the built page, relative to dist */
const htmlForLink = (link) =>
  link.endsWith("/") ? `${link.slice(1)}index.html` : `${link.slice(1)}.html`;

/** @returns {string[]} published Markdown files of docs/, relative to docs/ */
export function publishedMarkdown() {
  return walk(DOCS_DIR)
    .map((file) => rel(file, DOCS_DIR))
    .filter((p) => p.endsWith(".md") && !isExcluded(p))
    .sort();
}

/** @param {string} value */
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** @type {Map<string, Set<string>>} */
const idCache = new Map();

/** @param {string} htmlFile absolute @returns {Set<string>} every id="…" of the page */
function idsOf(htmlFile) {
  let ids = idCache.get(htmlFile);
  if (!ids) {
    const html = fs.readFileSync(htmlFile, "utf8");
    ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => decodeEntities(m[1])));
    idCache.set(htmlFile, ids);
  }
  return ids;
}

/**
 * Resolve an internal URL path (base already stripped, query removed) to a file of dist.
 *
 * @param {string} urlPath path below the site root, starting without a slash
 * @returns {string} absolute path the URL must resolve to
 */
function fileForUrlPath(urlPath) {
  if (urlPath === "" || urlPath.endsWith("/")) return path.join(DIST_DIR, urlPath, "index.html");
  // cleanUrls: `/page` is served from page.html. A dot in the last segment (a version such as
  // release-notes/v2.0.3) is not a file extension, so a file of that exact name wins and
  // `.html` is the fallback.
  const exact = path.join(DIST_DIR, urlPath);
  if (path.extname(urlPath) !== "" && fs.existsSync(exact) && fs.statSync(exact).isFile()) {
    return exact;
  }
  return path.join(DIST_DIR, `${urlPath}.html`);
}

/**
 * Check one page's internal references.
 *
 * @param {string} htmlFile absolute path of the page
 * @param {string[]} findings
 */
function checkReferences(htmlFile, findings) {
  const page = rel(htmlFile, DIST_DIR);
  const pageUrlDir = path.posix.dirname(`${SITE_BASE}${page}`);
  const html = fs.readFileSync(htmlFile, "utf8");
  for (const match of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const raw = decodeEntities(match[1]);
    if (raw === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;

    const hashAt = raw.indexOf("#");
    const fragment = hashAt === -1 ? "" : raw.slice(hashAt + 1);
    const withoutHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
    const urlPath = withoutHash.split("?")[0];

    let target;
    if (urlPath === "") {
      target = htmlFile;
    } else {
      let absolute = urlPath.startsWith("/") ? urlPath : path.posix.join(pageUrlDir, urlPath);
      if (!absolute.startsWith(SITE_BASE) && absolute !== SITE_BASE.slice(0, -1)) {
        findings.push(`${page}: link "${raw}" leaves the site base ${SITE_BASE}`);
        continue;
      }
      absolute = absolute.slice(SITE_BASE.length);
      try {
        absolute = decodeURI(absolute);
      } catch {
        // keep the raw value
      }
      target = fileForUrlPath(absolute);
    }

    if (!fs.existsSync(target)) {
      findings.push(`${page}: link "${raw}" has no target (${rel(target, DIST_DIR)} is missing)`);
      continue;
    }
    if (fragment !== "" && target.endsWith(".html")) {
      let id = fragment;
      try {
        id = decodeURIComponent(fragment);
      } catch {
        // keep the raw value
      }
      if (!idsOf(target).has(id)) {
        findings.push(`${page}: anchor "#${id}" does not exist in ${rel(target, DIST_DIR)}`);
      }
    }
  }
}

/**
 * Run every check and return the findings.
 *
 * @param {{ complete?: boolean }} [options]
 * @returns {{ findings: string[], pages: number, files: number }}
 */
export function checkSite(options = {}) {
  /** @type {string[]} */
  const findings = [];

  // (1) the build output exists
  if (!fs.existsSync(DIST_DIR)) {
    return {
      findings: [`${rel(DIST_DIR, path.resolve(here, ".."))} is missing — run the build first`],
      pages: 0,
      files: 0,
    };
  }
  const files = walk(DIST_DIR);
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    return { findings: ["the build output holds no HTML"], pages: 0, files: files.length };
  }

  // (2) page set == published Markdown set
  const expected = new Set(publishedMarkdown().map(htmlFor));
  const built = new Set(htmlFiles.map((f) => rel(f, DIST_DIR)).filter((p) => p !== "404.html"));
  for (const page of [...expected].sort()) {
    if (!built.has(page)) findings.push(`${page}: published Markdown has no built page`);
  }
  for (const page of [...built].sort()) {
    if (!expected.has(page)) {
      findings.push(`${page}: built page has no published Markdown file in docs/`);
    }
  }

  // (3) denylist over every text file of the output
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const content = fs.readFileSync(file, "utf8").toLowerCase();
    for (const literal of DENYLIST) {
      if (content.includes(literal)) {
        findings.push(`${rel(file, DIST_DIR)}: contains the denylisted literal "${literal}"`);
      }
    }
  }

  // (4) internal links, anchors and assets
  for (const htmlFile of htmlFiles) checkReferences(htmlFile, findings);

  // (5) probes: non-vacuity controls for the redaction, the repo-link rewrite and the escape
  /** @type {Array<[string, string]>} */
  const probes = [
    ["release-process.html", "&lt;prod-host&gt;"],
    [
      "compliance.html",
      "https://github.com/getclokr/clokr/blob/main/apps/api/src/contexts/time-tracking/arbzg.ts",
    ],
    ["PROCESS.html", "(&lt;date&gt;)"],
  ];
  for (const [page, needle] of probes) {
    const file = path.join(DIST_DIR, page);
    if (!fs.existsSync(file)) {
      findings.push(`probe ${page}: page is missing`);
    } else if (!fs.readFileSync(file, "utf8").includes(needle)) {
      findings.push(`probe ${page}: expected "${needle}" is not in the page`);
    }
  }

  // (6) completeness: every page sits in a sidebar group, every sidebar link has a page
  const linked = new Set(sidebarLinks(DOCS_DIR).map(htmlForLink));
  for (const page of [...built].sort()) {
    if (page === "index.html") continue; // the home page uses the home layout, no sidebar
    if (!linked.has(page)) {
      findings.push(
        `docs/${page.replace(/\.html$/, ".md")} is published but in no sidebar group — add it to apps/docs/navigation.mjs or to EXCLUDED in apps/docs/publication.mjs`,
      );
    }
  }
  for (const page of [...linked].sort()) {
    if (!built.has(page)) findings.push(`sidebar link to ${page} has no built page`);
  }

  // (7) with --complete: every planned page exists
  if (options.complete) {
    const planned = [
      ...HANDBUCH_PAGES.flatMap((group) => group.files),
      ...ENTWICKLER_GROUPS.flatMap((group) => group.files),
    ];
    for (const file of planned) {
      if (!fs.existsSync(path.join(DOCS_DIR, file))) {
        findings.push(`docs/${file} is planned in apps/docs/navigation.mjs but does not exist`);
      }
    }
  }

  return { findings, pages: built.size, files: files.length };
}

function main() {
  const complete = process.argv.includes("--complete");
  const { findings, pages, files } = checkSite({ complete });
  for (const finding of findings) console.error(`[check-site] ${finding}`);
  if (findings.length > 0) {
    console.error(`[check-site] FAILED — ${findings.length} finding(s)`);
    process.exit(1);
  }
  console.log(
    `[check-site] OK — ${pages} page(s), ${files} output file(s), denylist and links clean, probes found`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
