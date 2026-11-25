// Parity test for the docs site theme (Issue #1064).
//
// apps/docs/.vitepress/theme/clokr.css copies the Pflaume brand colours and the font stacks of
// apps/web/src/tokens.css instead of importing it (the app's [data-mode] attribute contract and
// root-absolute font URLs do not fit VitePress). A copy drifts silently, so this test pins it:
// when a brand colour of the app changes, the docs site has to follow or this test fails.
//
// Run via `pnpm test:scripts` at repo root (see vitest.config.mjs). Plain Node, no DB.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_CSS = path.join(repoRoot, "apps/web/src/tokens.css");
const CLOKR_CSS = path.join(repoRoot, "apps/docs/.vitepress/theme/clokr.css");

/** [docs variable, app token] — the mapping documented in clokr.css, per mode. */
const COLOUR_MAPPINGS = [
  ["--vp-c-brand-1", "--brand"],
  ["--vp-c-brand-2", "--brand-hover"],
  ["--vp-c-brand-3", "--brand"],
  ["--vp-c-brand-soft", "--brand-soft"],
  ["--vp-button-brand-text", "--brand-ink"],
  ["--vp-button-brand-hover-text", "--brand-ink"],
  ["--vp-button-brand-active-text", "--brand-ink"],
];

/** [docs variable, app token] — the font stacks, identical in every mode. */
const FONT_MAPPINGS = [
  ["--vp-font-family-base", "--font-ui"],
  ["--vp-font-family-mono", "--font-code"],
];

/** @param {string} css @returns {string} the stylesheet without comments */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The top-level rules of a stylesheet (no nesting, no at-rule bodies).
 *
 * @param {string} css
 * @returns {Array<{ selectors: string[], body: string }>}
 */
export function topLevelRules(css) {
  const source = stripComments(css);
  /** @type {Array<{ selectors: string[], body: string }>} */
  const rules = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && open !== -1) {
        const prelude = source.slice(start, open).trim();
        if (!prelude.startsWith("@")) {
          rules.push({
            selectors: prelude.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
            body: source.slice(open + 1, i),
          });
        }
        start = i + 1;
        open = -1;
      }
    }
  }
  return rules;
}

/** @param {string} body @returns {Map<string, string>} custom properties, values trimmed */
export function declarations(body) {
  const map = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim().replace(/\s+/g, " "));
  }
  return map;
}

/**
 * The declarations of the rule whose selector list contains `selector` exactly.
 *
 * @param {string} css
 * @param {string} selector
 * @returns {Map<string, string>}
 */
export function declarationsFor(css, selector) {
  const rule = topLevelRules(css).find((r) => r.selectors.includes(selector));
  if (!rule) throw new Error(`no rule with selector ${selector}`);
  return declarations(rule.body);
}

const norm = (/** @type {string | undefined} */ value) => value?.toLowerCase();

/**
 * Compare the docs theme with the app's tokens. Returns one message per mismatch.
 *
 * @param {string} tokensCss
 * @param {string} clokrCss
 * @returns {string[]}
 */
export function compareThemes(tokensCss, clokrCss) {
  /** @type {string[]} */
  const mismatches = [];
  const modes = /** @type {const} */ ([
    ["light", '[data-mode="light"]', ":root"],
    ["dark", '[data-mode="dark"]', ".dark"],
  ]);
  for (const [mode, tokensSelector, clokrSelector] of modes) {
    const tokens = declarationsFor(tokensCss, tokensSelector);
    const clokr = declarationsFor(clokrCss, clokrSelector);
    for (const [docsVar, appToken] of COLOUR_MAPPINGS) {
      if (norm(clokr.get(docsVar)) !== norm(tokens.get(appToken))) {
        mismatches.push(
          `${mode}: ${docsVar} is ${clokr.get(docsVar)} but tokens.css ${appToken} is ${tokens.get(appToken)}`,
        );
      }
    }
    for (const [docsVar, appToken] of FONT_MAPPINGS) {
      // Fonts are declared once; the light block (":root") carries them.
      if (mode !== "light") continue;
      if (clokr.get(docsVar) !== tokens.get(appToken)) {
        mismatches.push(
          `${docsVar} is ${clokr.get(docsVar)} but tokens.css ${appToken} is ${tokens.get(appToken)}`,
        );
      }
    }
  }
  return mismatches;
}

/** @param {string} css @returns {string[]} every url("…") target of the stylesheet */
const fontUrls = (css) => [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);

describe("docs theme tokens (Issue #1064)", () => {
  const tokensCss = fs.readFileSync(TOKENS_CSS, "utf8");
  const clokrCss = fs.readFileSync(CLOKR_CSS, "utf8");

  it("reads non-empty inputs (anti-vacuity)", () => {
    expect(declarationsFor(tokensCss, '[data-mode="light"]').get("--brand")).toBeDefined();
    expect(declarationsFor(tokensCss, '[data-mode="dark"]').get("--brand")).toBeDefined();
    expect(declarationsFor(clokrCss, ":root").size).toBeGreaterThanOrEqual(8);
    expect(declarationsFor(clokrCss, ".dark").size).toBeGreaterThanOrEqual(6);
  });

  it("keeps the Pflaume brand colours and the font stacks of tokens.css, light and dark", () => {
    expect(compareThemes(tokensCss, clokrCss)).toEqual([]);
  });

  it("uses the Pflaume values, not another theme (light brand #7a3f6c, dark brand #cf93c1)", () => {
    expect(declarationsFor(clokrCss, ":root").get("--vp-c-brand-1")).toBe("#7a3f6c");
    expect(declarationsFor(clokrCss, ".dark").get("--vp-c-brand-1")).toBe("#cf93c1");
  });

  it("loads exactly the font files the app ships, each resolving to an existing file", () => {
    const urls = fontUrls(clokrCss);
    expect(urls.length).toBe(4);
    for (const url of urls) {
      const file = path.resolve(path.dirname(CLOKR_CSS), url);
      expect(fs.existsSync(file), `${url} → ${file}`).toBe(true);
    }
    const appFonts = fontUrls(tokensCss).map((url) => path.basename(url));
    expect(urls.map((url) => path.basename(url)).sort()).toEqual([...appFonts].sort());
  });

  it("control: a copy with one changed brand hex is reported as a mismatch", () => {
    const tampered = clokrCss.replace("--vp-c-brand-1: #7a3f6c;", "--vp-c-brand-1: #7a3f6d;");
    expect(tampered).not.toBe(clokrCss);
    const mismatches = compareThemes(tokensCss, tampered);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toContain("--vp-c-brand-1");
  });

  it("control: a changed dark button text colour is reported too", () => {
    const tampered = clokrCss.replace(
      "--vp-button-brand-text: #1a1017;",
      "--vp-button-brand-text: #000000;",
    );
    expect(compareThemes(tokensCss, tampered).some((m) => m.startsWith("dark:"))).toBe(true);
  });
});
