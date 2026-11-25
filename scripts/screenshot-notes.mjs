// Capture notes of the Handbuch pages (Issue #1064).
//
// A Handbuch page that wants a screenshot carries one HTML comment on its own lines:
//
//   <!-- SCREENSHOT file=bilder/<page-slug>-NN.png role=emp|manager|admin url=<app path> show="<German description>" -->
//
// `file` is relative to docs/handbuch/, `url` is the path of the page in the web app (a query string
// is allowed), `show` is the German description that becomes the image's alt text. The note is the
// recapture recipe: scripts/capture-screenshots.mjs --set handbuch reads these notes and writes the
// images; nothing here touches a browser or the network, so the module is plain-node testable.

import fs from "node:fs";
import path from "node:path";

/** The three personas of the demo seed a note may ask for. */
export const ROLES = ["emp", "manager", "admin"];

const NOTE_PATTERN = /<!--\s*SCREENSHOT\b([\s\S]*?)-->/g;
const ATTRIBUTE_PATTERN = /(\w+)=(?:"([^"]*)"|(\S+))/g;

/**
 * Every capture note of one Markdown page, in order.
 * An incomplete note is returned as parsed (missing attributes are undefined) so `validateNotes`
 * can name it; text outside notes and ordinary comments are ignored.
 *
 * @param {string} markdown
 * @param {string} pagePath page path relative to docs/, forward slashes
 * @returns {{ page: string, line: number, file?: string, role?: string, url?: string, show?: string }[]}
 */
export function parseScreenshotNotes(markdown, pagePath) {
  const notes = [];
  for (const match of markdown.matchAll(NOTE_PATTERN)) {
    const line = markdown.slice(0, match.index).split("\n").length;
    /** @type {Record<string, string>} */
    const attributes = {};
    for (const attribute of match[1].matchAll(ATTRIBUTE_PATTERN)) {
      attributes[attribute[1]] = attribute[2] ?? attribute[3];
    }
    const { file, role, url, show } = attributes;
    notes.push({ page: pagePath, line, file, role, url, show });
  }
  return notes;
}

/**
 * Problems of a note list (all pages together, so a duplicate `file` is found across pages).
 * One entry per problem: `{ page, line, message }`.
 *
 * @param {ReturnType<typeof parseScreenshotNotes>} notes
 * @returns {{ page: string, line: number, message: string }[]}
 */
export function validateNotes(notes) {
  const errors = [];
  const seen = new Map();
  for (const note of notes) {
    const problem = (message) => errors.push({ page: note.page, line: note.line, message });
    if (!note.file) problem("capture note without file");
    else if (!/^bilder\/[^/\\]+\.png$/.test(note.file) || note.file.includes(".."))
      problem(`file "${note.file}" must be a .png directly in bilder/`);
    else if (seen.has(note.file))
      problem(`duplicate file "${note.file}" (first used in ${seen.get(note.file)})`);
    else seen.set(note.file, `${note.page}:${note.line}`);

    if (!note.url) problem("capture note without url");
    else if (!/^\/(?!\/)/.test(note.url))
      problem(`url "${note.url}" must be an app path starting with /`);

    if (!ROLES.includes(note.role ?? ""))
      problem(`role "${note.role ?? ""}" must be one of ${ROLES.join(", ")}`);
    if (!note.show) problem("capture note without show");
  }
  return errors;
}

/**
 * The notes of every Markdown page below docs/handbuch, pages sorted for a stable capture order.
 *
 * @param {string} docsDir absolute path of the repo's docs/ directory
 */
export function collectHandbuchNotes(docsDir) {
  const root = path.join(docsDir, "handbuch");
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".md") ? [full] : [];
      })
      .sort();
  return walk(root).flatMap((full) => {
    const page = path.relative(docsDir, full).split(path.sep).join("/");
    return parseScreenshotNotes(fs.readFileSync(full, "utf8"), page);
  });
}
