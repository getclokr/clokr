#!/usr/bin/env node
/**
 * lint:docs-terms — Issue #1064. Fails on a forbidden term, the Sie/ihr-form, an app URL or an
 * invalid menu path in the Handbuch (docs/index.md and docs/handbuch/**).
 *
 * The binding vocabulary and the address form ("du") live in `docs/glossar.md`. This gate is the
 * Handbuch half of what `lint:ui-terms` (web app) and `lint:api-terms` (API) are for their texts:
 *
 *   - the FORBIDDEN_TERMS of apps/web/scripts/lint-ui-terms.mjs are IMPORTED, never copied (the
 *     API gate's pattern, #861). Only the area scoping differs: "Phorest" is allowed in
 *     docs/handbuch/verwalten/ and docs/handbuch/team/dienstplan.md; "Mandant" is forbidden
 *     everywhere except DATEV's "Mandantennummer"; "Flag", "Generator" and "Audit-Spur" are
 *     forbidden in the whole Handbuch (the web gate checks them only in the shift planning area).
 *     Inline code is checked like text, because the Handbuch shows it.
 *   - docs-only terms: `url-path` (an app URL in text), `old-menu-path` ("Admin → Salons"),
 *     `menu-path` (a "Bereich › Seite › …" chain that apps/web/src/lib/nav/routes.ts does not
 *     define — a renamed page fails here until the Handbuch follows, owner decision OD-7).
 *
 * What counts as text: prose, headings, list items, table cells, link text, image alt text, inline
 * code and the scalar values of the YAML frontmatter. Never checked: fenced code blocks, HTML
 * comments (screenshot notes are comments), link and image URLs, HTML tags.
 *
 * CLI: `node scripts/lint-docs-terms.mjs` — walks the whole scope. Exit codes: 0 — no finding ·
 * 1 — findings, nothing walked, or fewer than 30 routes parsed from routes.ts.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import { FORBIDDEN_TERMS as WEB_TERMS } from "../apps/web/scripts/lint-ui-terms.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_FILE = join(REPO_ROOT, "apps/web/src/lib/nav/routes.ts");
const MIN_ROUTES = 30;

/** Files where "Phorest" may be named in the Handbuch. */
const PHOREST_ALLOWED_PREFIXES = ["docs/handbuch/verwalten/"];
const PHOREST_ALLOWED_FILES = ["docs/handbuch/team/dienstplan.md"];

/**
 * The web gate's terms, re-scoped for the Handbuch. A web term that carries its own `where` and is
 * not handled here throws: a newly scoped web term needs an explicit decision for the docs.
 */
const TERMS = WEB_TERMS.map((term) => {
  switch (term.id) {
    case "phorest":
      return {
        ...term,
        where: (/** @type {string} */ file) =>
          !PHOREST_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
          !PHOREST_ALLOWED_FILES.includes(file),
      };
    case "mandant":
      return { ...term, re: /mandant(?!ennummer)/i, where: undefined };
    case "flag":
    case "generator":
    case "audit-spur":
      return { ...term, where: undefined };
    default:
      if (term.where) {
        throw new Error(
          `lint-docs-terms: the web term "${term.id}" is scoped to the app; decide its docs scope in scripts/lint-docs-terms.mjs`,
        );
      }
      return term;
  }
});

/** Docs-only terms. */
const DOCS_TERMS = [
  {
    id: "url-path",
    re: /(?:^|[\s(`"'„“])\/(?:admin|settings|dashboard|time-entries|leave|shifts|inbox|reports|availability|employees|team|ich|verwalten)(?:\/|\b)/,
    reason: "name the page by its menu path („Ich › Zeiten“), never by an app URL",
  },
  {
    id: "old-menu-path",
    // docs/glossar.md § 3: a menu path is written „Verwalten › Salons“, never „Admin → Salons“. The
    // same case-sensitive regex as OLD_MENU_PATH in apps/api/src/utils/__tests__/release-notes.test.ts
    // (restated because that test does not export it): a capitalised name, „→“, a capitalised name;
    // „alt → neu“ and „30 → 36 Tage“ are no menu path.
    re: /[A-ZÄÖÜ][A-Za-zÄÖÜäöüß&.-]*_?\s*→\s*[_„"“]?[A-ZÄÖÜ]/,
    reason: "write a menu path with „›“ and the area first: „Verwalten › Salons“",
  },
];

// ── The menu tree of routes.ts ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, children: MenuNode[] }} MenuNode
 * @typedef {{ routeCount: number, roots: Record<string, MenuNode[]> }} MenuTree
 */

/** @param {ts.Node} node @returns {string | undefined} the value of a plain string literal */
function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

/** @param {ts.Node} node @returns {ts.Node} the node without `as` / `satisfies` / parentheses */
function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** @param {ts.ObjectLiteralExpression} object @returns {Map<string, ts.Expression>} */
function propertiesOf(object) {
  const map = new Map();
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name) {
      map.set(property.name.getText().replace(/^["']|["']$/g, ""), property.initializer);
    }
  }
  return map;
}

/**
 * Read AREA_LABELS and APP_ROUTES from the source of routes.ts with the TypeScript compiler API —
 * the module is never executed.
 *
 * @param {string} routesSource
 * @returns {MenuTree}
 */
export function parseMenuTree(routesSource) {
  const sourceFile = ts.createSourceFile("routes.ts", routesSource, ts.ScriptTarget.Latest, true);
  /** @type {Record<string, string>} */
  const areaLabels = {};
  /** @type {Array<{ href: string, area: string, label: string, tabLabel?: string, parent?: string }>} */
  const routes = [];

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === "AREA_LABELS") {
        /** @type {ts.ObjectLiteralExpression | undefined} */
        let object;
        /** @param {ts.Node} n */
        const find = (n) => {
          if (!object && ts.isObjectLiteralExpression(n)) object = n;
          else if (!object) ts.forEachChild(n, find);
        };
        find(node.initializer);
        if (object) {
          for (const [key, value] of propertiesOf(object)) {
            const text = literalText(value);
            if (text !== undefined) areaLabels[key] = text;
          }
        }
      }
      if (node.name.text === "APP_ROUTES") {
        const array = unwrap(node.initializer);
        if (ts.isArrayLiteralExpression(array)) {
          for (const element of array.elements) {
            if (!ts.isObjectLiteralExpression(element)) continue;
            const props = propertiesOf(element);
            if (props.get("internal")?.kind === ts.SyntaxKind.TrueKeyword) continue;
            const read = (/** @type {string} */ key) => {
              const value = props.get(key);
              return value === undefined ? undefined : literalText(value);
            };
            const href = read("href");
            const area = read("area");
            const label = read("label");
            if (href === undefined || area === undefined || label === undefined) {
              throw new Error(
                `lint-docs-terms: route without literal href/area/label: ${element.getText().slice(0, 80)}`,
              );
            }
            routes.push({ href, area, label, tabLabel: read("tabLabel"), parent: read("parent") });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  /** @type {Record<string, MenuNode[]>} */
  const roots = {};
  for (const label of Object.values(areaLabels)) roots[label] = [];

  /** @param {MenuNode[]} siblings @param {string} name @returns {MenuNode} */
  const nodeIn = (siblings, name) => {
    let node = siblings.find((entry) => entry.name === name);
    if (!node) {
      node = { name, children: [] };
      siblings.push(node);
    }
    return node;
  };

  /** @type {Map<string, MenuNode>} */
  const byHref = new Map();
  // Parents first: a route's prefix parent is shorter, so sorting by href length places it earlier.
  const ordered = [...routes].sort((a, b) => a.href.length - b.href.length);
  for (const route of ordered) {
    const areaLabel = areaLabels[route.area];
    if (areaLabel === undefined) continue;
    const prefixParent = ordered
      .filter((other) => other.area === route.area && route.href.startsWith(`${other.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0];
    const parentHref = route.tabLabel ? (route.parent ?? prefixParent?.href) : prefixParent?.href;

    // Children of the area hub (`/verwalten`) are the top-level pages of the area.
    const hubParent = parentHref === `/${route.area}` ? undefined : parentHref;
    const parentNode = hubParent ? byHref.get(hubParent) : undefined;
    const siblings = parentNode ? parentNode.children : roots[areaLabel];

    if (route.tabLabel && parentHref) {
      // A tab of its parent page: named by its tab label, not by its own label.
      nodeIn(siblings, route.tabLabel);
      continue;
    }
    const node = nodeIn(siblings, route.label);
    byHref.set(route.href, node);
    // A page that owns tabs without a parent lists its own first tab too.
    if (route.tabLabel) nodeIn(node.children, route.tabLabel);
  }

  return { routeCount: routes.length, roots };
}

/** @param {string} char @returns {boolean} true when the char cannot continue a name */
const isBoundary = (char) => char === undefined || char === "" || !/[\p{L}\p{N}]/u.test(char);

/**
 * Every "Bereich › Seite › …" chain of a text that the menu tree does not define.
 *
 * Follows the chain segment by segment, matching the LONGEST child name at each " › ". Segment two
 * must be a page of the area. At deeper levels a node that has children requires one of them; a
 * leaf accepts one free trailing segment (an in-page tab such as „Verwalten › Personen › Vertrag“).
 *
 * @param {string} text
 * @param {MenuTree} tree
 * @returns {Array<{ path: string, reason: string }>}
 */
export function menuPathProblems(text, tree) {
  /** @type {Array<{ path: string, reason: string }>} */
  const problems = [];
  const start = /(?<![\p{L}\p{N}-])(Ich|Team|Verwalten) › /gu;
  for (const match of text.matchAll(start)) {
    const area = match[1];
    let siblings = tree.roots[area] ?? [];
    let position = (match.index ?? 0) + match[0].length;
    const chain = [area];
    let first = true;
    for (;;) {
      const rest = text.slice(position);
      const candidates = siblings
        .filter((child) => rest.startsWith(child.name) && isBoundary(rest[child.name.length]))
        .sort((a, b) => b.name.length - a.name.length);
      const found = candidates[0];
      if (!found) {
        if (first || siblings.length > 0) {
          const shown = rest
            .split(/ › |[.,;:!?)“”]|\s{2,}/)[0]
            .trim()
            .slice(0, 40);
          problems.push({
            path: `${chain.join(" › ")} › ${shown}`,
            reason: `„${shown}“ is no page or tab under „${chain.join(" › ")}“ in apps/web/src/lib/nav/routes.ts`,
          });
        }
        break;
      }
      chain.push(found.name);
      first = false;
      position += found.name.length;
      if (!text.startsWith(" › ", position)) break;
      position += 3;
      siblings = found.children;
    }
  }
  return problems;
}

// ── Text extraction ─────────────────────────────────────────────────────────────────────────────

/** Frontmatter keys whose values are control values, not prose. */
const FRONTMATTER_SKIP_KEYS = new Set(["layout", "link", "theme", "icon", "src", "target", "rel"]);

/** @param {string} value @returns {string} */
const stripQuotes = (value) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The checkable texts of a Markdown source with their 1-based line numbers.
 *
 * @param {string} file path relative to the repo root (kept for symmetry with scanSource)
 * @param {string} source
 * @returns {Array<{ line: number, text: string }>}
 */
export function extractTexts(file, source) {
  void file;
  const lines = source.split(/\r?\n/);
  /** @type {Array<{ line: number, text: string }>} */
  const out = [];
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) {
      for (let n = 1; n < end; n++) {
        const entry = /^\s*(?:-\s+)?([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[n]);
        let value;
        if (entry) {
          if (FRONTMATTER_SKIP_KEYS.has(entry[1])) continue;
          value = stripQuotes(entry[2]);
        } else {
          const item = /^\s*-\s+(.+)$/.exec(lines[n]);
          value = item ? stripQuotes(item[1]) : "";
        }
        if (/\p{L}/u.test(value)) out.push({ line: n + 1, text: value });
      }
      bodyStart = end + 1;
    }
  }

  // Blank out fenced code (backtick and tilde fences) and keep every line number.
  /** @type {string[]} */
  const body = [];
  /** @type {{ char: string, length: number } | null} */
  let fence = null;
  for (let n = 0; n < lines.length; n++) {
    if (n < bodyStart) {
      body.push("");
      continue;
    }
    const line = lines[n];
    if (fence) {
      const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length)
        fence = null;
      body.push("");
      continue;
    }
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      fence = { char: opening[1][0], length: opening[1].length };
      body.push("");
      continue;
    }
    body.push(line);
  }

  // HTML comments, multi-line ones included; newlines stay so line numbers survive.
  const withoutComments = body
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""))
    .split("\n");

  for (let n = 0; n < withoutComments.length; n++) {
    const text = withoutComments[n]
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/<(?:https?|mailto):[^>]*>/g, "")
      .replace(/https?:\/\/[^\s)>\]]+/g, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .replace(/`/g, "")
      .replace(/\*\*|__|~~|\*/g, "")
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+]\s+|\d+[.)]\s+)+/, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/\p{L}/u.test(text)) out.push({ line: n + 1, text });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** @typedef {{ file: string, line: number, term: string, text: string, reason: string }} Finding */

/**
 * The findings of one source. `file` is the path relative to the repo root with forward slashes
 * (it decides the Phorest scoping).
 *
 * @param {string} file
 * @param {string} source
 * @param {MenuTree} tree
 * @returns {Finding[]}
 */
export function scanSource(file, source, tree) {
  /** @type {Finding[]} */
  const findings = [];
  for (const { line, text } of extractTexts(file, source)) {
    for (const term of [...TERMS, ...DOCS_TERMS]) {
      if (term.where && !term.where(file)) continue;
      if (term.re.test(text)) {
        findings.push({ file, line, term: term.id, text, reason: term.reason });
      }
    }
    for (const problem of menuPathProblems(text, tree)) {
      findings.push({ file, line, term: "menu-path", text: problem.path, reason: problem.reason });
    }
  }
  return findings;
}

// ── The scanned tree ────────────────────────────────────────────────────────────────────────────

/** @param {string} dir @param {string[]} out @returns {string[]} */
function walkMarkdown(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "bilder" || entry === "node_modules") continue;
      walkMarkdown(full, out);
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/** Every file the gate reads (absolute paths): docs/index.md and docs/handbuch/**. */
export function listScannedFiles() {
  /** @type {string[]} */
  const files = [];
  const home = join(REPO_ROOT, "docs/index.md");
  if (existsSync(home)) files.push(home);
  const handbuch = join(REPO_ROOT, "docs/handbuch");
  if (existsSync(handbuch)) walkMarkdown(handbuch, files);
  return files.sort();
}

/**
 * @param {string[]} [files] absolute paths; defaults to the whole scope
 * @param {{ routesSource?: string }} [options]
 * @returns {Finding[]}
 */
export function scan(files = listScannedFiles(), options = {}) {
  const tree = parseMenuTree(options.routesSource ?? readFileSync(ROUTES_FILE, "utf8"));
  return files.flatMap((full) =>
    scanSource(relative(REPO_ROOT, full).split("\\").join("/"), readFileSync(full, "utf8"), tree),
  );
}

/**
 * Run the gate.
 *
 * @param {string[]} [files]
 * @param {{ routesSource?: string }} [options]
 * @returns {{ exitCode: number, findings: Finding[], messages: string[] }}
 */
export function run(files = listScannedFiles(), options = {}) {
  /** @type {string[]} */
  const messages = [];
  if (files.length === 0) {
    messages.push(
      "[lint:docs-terms] scanned 0 file(s) — the scope moved (docs/index.md, docs/handbuch). This is a failure, not a clean result.",
    );
    return { exitCode: 1, findings: [], messages };
  }
  const routesSource = options.routesSource ?? readFileSync(ROUTES_FILE, "utf8");
  const tree = parseMenuTree(routesSource);
  if (tree.routeCount < MIN_ROUTES) {
    messages.push(
      `[lint:docs-terms] parsed only ${tree.routeCount} route(s) from apps/web/src/lib/nav/routes.ts (expected at least ${MIN_ROUTES}) — the menu paths cannot be checked. This is a failure, not a clean result.`,
    );
    return { exitCode: 1, findings: [], messages };
  }
  const findings = scan(files, { routesSource });
  if (findings.length === 0) {
    messages.push(
      `[lint:docs-terms] OK — ${files.length} file(s) walked, ${tree.routeCount} route(s) parsed, no forbidden term, URL path or invalid menu path (docs/glossar.md).`,
    );
    return { exitCode: 0, findings, messages };
  }
  for (const f of findings) {
    messages.push(`${f.file}:${f.line} [${f.term}] "${f.text.slice(0, 140)}" → ${f.reason}`);
  }
  messages.push(
    `\n[lint:docs-terms] ${findings.length} finding(s) across ${files.length} walked file(s). Vocabulary: docs/glossar.md`,
  );
  return { exitCode: 1, findings, messages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = listScannedFiles();
  // Explicit empty-abort (lint:guard-vacuity): a moved scope must fail, never report a clean tree.
  if (files.length === 0) {
    console.error(
      "[lint:docs-terms] scanned 0 file(s) — the scope moved (docs/index.md, docs/handbuch). This is a failure, not a clean result.",
    );
    process.exit(1);
  }
  const { exitCode, messages } = run(files);
  for (const message of messages) (exitCode === 0 ? console.warn : console.error)(message);
  process.exit(exitCode);
}
