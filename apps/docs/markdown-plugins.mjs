// markdown-it additions that turn the docs/ files — written for GitHub — into site pages without
// touching them (Issue #1064). Registered through `markdown.config` in .vitepress/config.mts.
//
//   (a) redaction  — publication.mjs REDACTIONS rewrite internal names in the rendered text
//   (b) links      — links to repo files outside the site point to GitHub, not to a dead URL
//   (c) pseudo-tags — "<date>" / "<Name>" in prose are shown as text, Vue would compile them
//   (d) "{{"       — shown literally (text and inline code), Vue would read it as an interpolation
//
// Every renderer rule chains to the one VitePress installed before, so its own behaviour (code
// highlighting, link handling, containers) stays intact.

import fs from "node:fs";
import path from "node:path";

import { REDACTIONS, REPO_URL, REPO_BRANCH, isExcluded } from "./publication.mjs";

/** Token types whose `content` is plain text a reader (and the search index) sees. */
const BLOCK_CONTENT_TYPES = new Set(["fence", "code_block", "html_block"]);
const INLINE_CONTENT_TYPES = new Set(["text", "code_inline", "html_inline"]);

/** Tags that may stay real HTML in a docs page; every other tag is shown as text. */
const ALLOWED_TAGS = new Set(["a", "br", "code", "details", "img", "kbd", "sub", "summary", "sup"]);

/** @param {string} value */
export function redact(value) {
  let out = value;
  for (const { find, replace } of REDACTIONS) {
    if (out.includes(find)) out = out.split(find).join(replace);
  }
  return out;
}

/**
 * @param {string} href
 * @returns {boolean} true for a relative reference (no scheme, not `#`, `/`, `//`)
 */
function isRelativeHref(href) {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return !(href.startsWith("#") || href.startsWith("/"));
}

/**
 * Map a relative link of a docs page to its GitHub URL when the site cannot serve the target.
 *
 * @param {string} href the link as written
 * @param {string} pageDir absolute directory of the page that holds the link
 * @param {string} srcDir absolute path of docs/
 * @returns {string | null} the GitHub URL, or null to leave the link to VitePress
 */
export function repoLinkFor(href, pageDir, srcDir) {
  const hashAt = href.indexOf("#");
  const rawPath = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const cleanPath = rawPath.split("?")[0];
  if (cleanPath === "") return null;

  let decoded = cleanPath;
  try {
    decoded = decodeURI(cleanPath);
  } catch {
    // keep the raw value
  }
  const target = path.resolve(pageDir, decoded);
  const repoRoot = path.resolve(srcDir, "..");
  const relToDocs = path.relative(srcDir, target).split(path.sep).join("/");
  const insideDocs = !relToDocs.startsWith("..") && !path.isAbsolute(relToDocs);

  if (insideDocs && target.endsWith(".md") && !isExcluded(relToDocs)) return null;

  const relToRepo = path.relative(repoRoot, target).split(path.sep).join("/");
  let isDir = false;
  try {
    isDir = fs.statSync(target).isDirectory();
  } catch {
    isDir = decoded.endsWith("/");
  }
  const kind = isDir ? "tree" : "blob";
  return `${REPO_URL}/${kind}/${REPO_BRANCH}/${relToRepo.replace(/\/$/, "")}${hash}`;
}

/**
 * @param {import("markdown-it").default} md
 * @param {{ srcDir: string }} options
 */
export function clokrMarkdown(md, { srcDir }) {
  // (a) + (b) run after `text_join`, before the anchor plugin reads the heading text, so the
  // heading ids, the outline and the search index carry the redacted words too.
  md.core.ruler.after("text_join", "clokr_redact_and_links", (state) => {
    const pageFile = state.env?.realPath ?? state.env?.path ?? "";
    const pageDir = pageFile ? path.dirname(pageFile) : srcDir;

    for (const token of state.tokens) {
      if (BLOCK_CONTENT_TYPES.has(token.type)) token.content = redact(token.content);
      if (token.type !== "inline" || !token.children) continue;
      for (const child of token.children) {
        if (INLINE_CONTENT_TYPES.has(child.type)) child.content = redact(child.content);
        if (child.type === "link_open") {
          const href = child.attrGet("href") ?? "";
          if (!isRelativeHref(href)) continue;
          const repoHref = repoLinkFor(href, pageDir, srcDir);
          if (repoHref) child.attrSet("href", repoHref);
        }
      }
    }
    return true;
  });

  // (c) pseudo-tags
  for (const rule of /** @type {const} */ (["html_block", "html_inline"])) {
    const previous = md.renderer.rules[rule];
    const delegate = (tokens, idx, options, env, self) =>
      previous ? previous(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
      const content = tokens[idx].content;
      if (content.trimStart().startsWith("<!--")) return delegate(tokens, idx, options, env, self);
      const tag = /^\s*<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(content);
      if (tag && ALLOWED_TAGS.has(tag[1].toLowerCase())) {
        return delegate(tokens, idx, options, env, self);
      }
      const escaped = md.utils.escapeHtml(content);
      return rule === "html_block" ? `<p>${escaped.trim()}</p>\n` : escaped;
    };
  }

  // (d) "{{" in inline code: VitePress leaves `<code>` without v-pre, so Vue would evaluate the
  // braces (docs name GitHub-Actions expressions and `docker inspect --format` templates).
  const previousCode = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const html = previousCode
      ? previousCode(tokens, idx, options, env, self)
      : `<code>${md.utils.escapeHtml(tokens[idx].content)}</code>`;
    return tokens[idx].content.includes("{{") ? html.replace(/^<code/, "<code v-pre") : html;
  };

  // (d) "{{" in plain text
  const previousText = md.renderer.rules.text;
  md.renderer.rules.text = (tokens, idx, options, env, self) => {
    const content = tokens[idx].content;
    if (content.includes("{{")) return `<span v-pre>${md.utils.escapeHtml(content)}</span>`;
    return previousText
      ? previousText(tokens, idx, options, env, self)
      : md.utils.escapeHtml(content);
  };
}
