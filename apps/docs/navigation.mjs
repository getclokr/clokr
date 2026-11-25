// Navigation of the docs site (Issue #1064): the two sidebars, built from what exists in docs/.
//
// HANDBUCH_PAGES is the planned order of the customer-facing manual; ENTWICKLER_GROUPS the
// developer groups. A planned page that is not written yet is skipped by buildSidebar() — the
// completeness gate (`check:complete`) is what fails on it. A published page that sits in no group
// fails the gate too, which forces a publication decision for every new doc: add it here or to
// EXCLUDED in publication.mjs.
//
// Node-side only, like publication.mjs: the sidebar it returns is serialized into the site on
// purpose, but nothing from publication.mjs may travel with it.

import fs from "node:fs";
import path from "node:path";

import { isExcluded } from "./publication.mjs";

/**
 * The planned Handbuch pages, grouped (paths relative to docs/).
 *
 * @type {ReadonlyArray<{ text: string, files: ReadonlyArray<string> }>}
 */
export const HANDBUCH_PAGES = [
  { text: "Einstieg", files: ["handbuch/index.md", "handbuch/erste-schritte.md"] },
  {
    text: "Ich",
    files: [
      "handbuch/ich/index.md",
      "handbuch/ich/mein-tag-und-zeiten.md",
      "handbuch/ich/abwesenheiten.md",
      "handbuch/ich/dienstplan.md",
    ],
  },
  {
    text: "Team",
    files: [
      "handbuch/team/index.md",
      "handbuch/team/aufgaben.md",
      "handbuch/team/zeiten.md",
      "handbuch/team/dienstplan.md",
      "handbuch/team/berichte.md",
    ],
  },
  {
    text: "Verwalten",
    files: [
      "handbuch/verwalten/index.md",
      "handbuch/verwalten/personen.md",
      "handbuch/verwalten/arbeitszeitmodelle.md",
      "handbuch/verwalten/abwesenheiten-und-urlaub.md",
      "handbuch/verwalten/rollen-und-rechte.md",
      "handbuch/verwalten/salons-und-feiertage.md",
      "handbuch/verwalten/monatsabschluss.md",
      "handbuch/verwalten/system-und-daten.md",
      "handbuch/verwalten/phorest.md",
    ],
  },
  {
    text: "Hintergrund",
    files: ["handbuch/hintergrund/compliance.md", "handbuch/hintergrund/faq.md"],
  },
];

/**
 * The developer groups. `files` are explicit members; `generated` names a group whose members come
 * from the directory (see buildEntwicklerGroups).
 *
 * @type {ReadonlyArray<{ text: string, files: ReadonlyArray<string>, generated?: "adr" | "release-notes" }>}
 */
export const ENTWICKLER_GROUPS = [
  {
    text: "Einstieg",
    files: [
      "entwickler/index.md",
      "getting-started.md",
      "entwickler/architecture.md",
      "entwickler/configuration.md",
      "deployment.md",
    ],
  },
  { text: "Architektur", files: ["context-cut-map.md", "permissions.md"], generated: "adr" },
  {
    text: "Fachregeln",
    files: ["compliance.md", "burlg-carryover.md", "saldo-anzeige.md", "glossar.md"],
  },
  {
    text: "Entwicklung & Tests",
    files: ["testing.md", "visual-regression-workflow.md", "migrations.md", "ADMIN_STRUCTURE.md"],
  },
  {
    text: "Prozess & Release",
    files: [
      "PROCESS.md",
      "release-process.md",
      "RELEASE_NOTES_TEMPLATE.md",
      "ci-branch-protection.md",
      "cve-handling.md",
    ],
  },
  {
    text: "Betrieb",
    files: [
      "runbooks/operator-accounts.md",
      "runbooks/saldo-chain-integrity.md",
      "runbooks/web-push.md",
      "runbooks/wlan-qr-kopplung.md",
    ],
  },
  { text: "Release-Notes", files: [], generated: "release-notes" },
];

/** @param {string} value */
const stripMarkdown = (value) => value.replace(/[`*_]/g, "").trim();

/**
 * Text of a sidebar item: the first `# ` heading of the file; for a release note (which has no H1)
 * its first `## ` line.
 *
 * @param {string} srcDir absolute path of docs/
 * @param {string} file path relative to docs/
 * @returns {string}
 */
function titleOf(srcDir, file) {
  const source = fs.readFileSync(path.join(srcDir, file), "utf8");
  const isReleaseNote = /^release-notes\/v\d/.test(file);
  const match = (isReleaseNote ? /^## (.+)$/m : /^# (.+)$/m).exec(source);
  return match ? stripMarkdown(match[1]) : path.basename(file, ".md");
}

/** @param {string} file path relative to docs/ @returns {string} the VitePress link */
function linkOf(file) {
  const withoutExt = file.replace(/\.md$/, "");
  if (withoutExt === "index") return "/";
  return withoutExt.endsWith("/index")
    ? `/${withoutExt.slice(0, -"index".length)}`
    : `/${withoutExt}`;
}

/** @param {string} srcDir @param {string} file */
const exists = (srcDir, file) => fs.existsSync(path.join(srcDir, file));

/**
 * `v1.9.10` → [1, 9, 10], for ordering by semantic version.
 *
 * @param {string} file
 * @returns {number[]}
 */
function versionOf(file) {
  const match = /v(\d+)\.(\d+)\.(\d+)/.exec(path.basename(file));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

/** @param {number[]} a @param {number[]} b */
function compareVersionsDescending(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

/**
 * `release-notes/v*.md` of docs/, newest version first.
 *
 * @param {string} srcDir
 * @returns {string[]} paths relative to docs/
 */
function releaseNoteFiles(srcDir) {
  const dir = path.join(srcDir, "release-notes");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^v\d+\.\d+\.\d+\.md$/.test(name))
    .map((name) => `release-notes/${name}`)
    .filter((file) => !isExcluded(file))
    .sort((a, b) => compareVersionsDescending(versionOf(a), versionOf(b)));
}

/**
 * The files of every Entwickler group, in order, with the generated groups filled in.
 *
 * @param {string} srcDir
 * @returns {Array<{ text: string, files: string[], explicit: string[] }>}
 */
export function entwicklerGroupFiles(srcDir) {
  return ENTWICKLER_GROUPS.map((group) => {
    /** @type {string[]} */
    let files = [...group.files];
    if (group.generated === "adr") {
      const dir = path.join(srcDir, "adr");
      const adrs = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((name) => name.endsWith(".md"))
            .sort()
            .map((name) => `adr/${name}`)
            .filter((file) => !isExcluded(file))
        : [];
      files = [...adrs, ...files];
    }
    if (group.generated === "release-notes") {
      files = ["release-notes/README.md", ...releaseNoteFiles(srcDir)];
    }
    return {
      text: group.text,
      files: files.filter((file) => !isExcluded(file)),
      explicit: group.generated === "release-notes" ? [] : [...group.files],
    };
  });
}

/**
 * Both sidebars, listing only files that exist.
 *
 * @param {string} srcDir absolute path of docs/
 */
export function buildSidebar(srcDir) {
  const toItems = (/** @type {string[]} */ files) =>
    files
      .filter((file) => exists(srcDir, file))
      .map((file) => ({ text: titleOf(srcDir, file), link: linkOf(file) }));

  const handbuch = HANDBUCH_PAGES.map((group) => ({
    text: group.text,
    items: toItems([...group.files]),
  })).filter((group) => group.items.length > 0);

  const entwickler = entwicklerGroupFiles(srcDir)
    .map((group) => ({
      text: group.text,
      collapsed: group.text === "Release-Notes",
      items: toItems(group.files),
    }))
    .filter((group) => group.items.length > 0);

  return { "/handbuch/": handbuch, "/": entwickler };
}

/**
 * Every link of both sidebars, flat.
 *
 * @param {string} srcDir
 * @returns {string[]}
 */
export function sidebarLinks(srcDir) {
  const sidebar = buildSidebar(srcDir);
  return [...sidebar["/handbuch/"], ...sidebar["/"]].flatMap((group) =>
    group.items.map((item) => item.link),
  );
}

/**
 * The newest release note (what the "Neuigkeiten" nav item opens).
 *
 * @param {string} srcDir
 * @returns {string} VitePress link, or the release-notes index when there is none
 */
export function latestReleaseNote(srcDir) {
  const newest = releaseNoteFiles(srcDir)[0];
  return newest ? linkOf(newest) : "/release-notes/README";
}
