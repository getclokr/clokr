// Text assertions on .github/workflows/docs.yml (Issue #1064). No YAML parser is a dependency, so the
// workflow is read as text; the file keeps a flat, regular shape that these checks rely on.
//
// What this pins: the Pages workflow publishes only from main of the real repository, only the
// deploy job holds the Pages permissions, third-party actions are pinned by SHA, the path filters
// name files that exist, the build job runs the completeness gate — and the docs package never
// enters a runtime image.
//
// Run via `pnpm test:scripts` at repo root (see vitest.config.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(repoRoot, ".github/workflows/docs.yml");
// Full-line comments are removed: the header explains the permissions in prose and must not be read as config.
const workflow = fs
  .readFileSync(WORKFLOW, "utf8")
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** @param {string} text @returns {string[]} `owner/repo@ref` of every `uses:` that is not first-party `actions/*` */
export function thirdPartyUses(text) {
  return [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)]
    .map((m) => m[1])
    .filter((spec) => !spec.startsWith("actions/") && !spec.startsWith("./"));
}

/** @param {string} text @returns {string[]} third-party actions that are not pinned to a 40-hex commit SHA */
export function unpinned(text) {
  return thirdPartyUses(text).filter((spec) => !/@[0-9a-f]{40}$/.test(spec));
}

/** @param {string} text @returns {Record<string, string>} the text of every job, by job name */
export function jobBlocks(text) {
  const jobsAt = text.search(/^jobs:\s*$/m);
  if (jobsAt === -1) return {};
  const lines = text.slice(jobsAt).split("\n").slice(1);
  /** @type {Record<string, string[]>} */
  const blocks = {};
  let current = null;
  for (const line of lines) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks[current] = [];
    } else if (current) {
      blocks[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(blocks).map(([name, body]) => [name, body.join("\n")]));
}

/** @param {string} text @param {string} trigger `pull_request` or `push` @returns {string[]} its `paths` entries */
export function pathsOf(text, trigger) {
  const start = text.search(new RegExp(`^ {2}${trigger}:\\s*$`, "m"));
  if (start === -1) return [];
  const rest = text.slice(start).split("\n").slice(1);
  /** @type {string[]} */
  const paths = [];
  let inPaths = false;
  for (const line of rest) {
    if (/^ {2}\S/.test(line)) break; // next trigger
    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const entry = /^ {6}-\s+"?([^"\s]+)"?\s*$/.exec(line);
      if (entry) paths.push(entry[1]);
      else if (line.trim() !== "" && !line.trim().startsWith("#")) inPaths = false;
    }
  }
  return paths;
}

describe("docs.yml", () => {
  it("is a non-trivial workflow (anti-vacuity)", () => {
    expect(workflow.length).toBeGreaterThan(500);
    expect(Object.keys(jobBlocks(workflow)).sort()).toEqual(["build", "deploy"]);
  });

  it("never uses pull_request_target or a secret", () => {
    expect(workflow).not.toMatch(/^\s*pull_request_target:/m);
    expect(workflow).not.toMatch(/\bsecrets\./);
  });

  it("pins every third-party action to a 40-hex commit SHA", () => {
    expect(thirdPartyUses(workflow).length).toBeGreaterThanOrEqual(1); // pnpm/action-setup
    expect(unpinned(workflow)).toEqual([]);
  });

  it("control: the pin assertion flags pnpm/action-setup on a movable tag", () => {
    const tampered = workflow.replace(/pnpm\/action-setup@[0-9a-f]{40}/, "pnpm/action-setup@v6");
    expect(tampered).not.toBe(workflow);
    expect(unpinned(tampered)).toEqual(["pnpm/action-setup@v6"]);
  });

  it("confines pages: write and id-token: write to the deploy job", () => {
    const blocks = jobBlocks(workflow);
    expect(blocks.deploy).toMatch(/^\s+pages:\s*write\s*$/m);
    expect(blocks.deploy).toMatch(/^\s+id-token:\s*write\s*$/m);
    expect(blocks.build).not.toMatch(/pages:\s*write|id-token:\s*write/);
    const header = workflow.slice(0, workflow.search(/^jobs:\s*$/m));
    expect(header).not.toMatch(/pages:\s*write|id-token:\s*write/);
    expect(header).toMatch(/^permissions:\n\s+contents:\s*read\s*$/m);
    // exactly one occurrence each in the whole file
    expect(workflow.match(/pages:\s*write/g)).toHaveLength(1);
    expect(workflow.match(/id-token:\s*write/g)).toHaveLength(1);
  });

  it("deploys only from main of getclokr/clokr, never for a pull request", () => {
    const conditions = [...workflow.matchAll(/^\s*if:\s*(.+)$/gm)].map((m) => m[1]);
    // the artifact upload step and the deploy job
    expect(conditions).toHaveLength(2);
    for (const condition of conditions) {
      expect(condition).toContain("github.event_name != 'pull_request'");
      expect(condition).toContain("github.ref == 'refs/heads/main'");
      expect(condition).toContain("github.repository == 'getclokr/clokr'");
    }
    expect(jobBlocks(workflow).deploy).toMatch(/^\s+if:\s/m);
  });

  it("builds with the dead-link check and runs the completeness gate", () => {
    const build = jobBlocks(workflow).build;
    expect(build).toContain("pnpm --filter @clokr/docs build");
    expect(build).toContain("pnpm --filter @clokr/docs typecheck");
    expect(build).toContain("pnpm --filter @clokr/docs check:complete");
    expect(build).toContain("--frozen-lockfile");
  });

  it("filters pull_request and push by the same paths, and every path exists", () => {
    const pr = pathsOf(workflow, "pull_request");
    const push = pathsOf(workflow, "push");
    expect(pr.length).toBeGreaterThanOrEqual(8);
    expect(push).toEqual(pr);
    for (const entry of pr) {
      const target = entry.endsWith("/**") ? entry.slice(0, -3) : entry;
      expect(fs.existsSync(path.join(repoRoot, target)), entry).toBe(true);
    }
    expect(pr).toContain(".github/workflows/docs.yml");
  });
});

describe("the docs package stays out of every image", () => {
  const dockerfiles = [
    "apps/api/Dockerfile",
    "apps/web/Dockerfile",
    "apps/fritzbox-adapter/Dockerfile",
  ];

  it.each(dockerfiles)("%s copies no docs package and no whole workspace", (file) => {
    const copies = fs
      .readFileSync(path.join(repoRoot, file), "utf8")
      .split("\n")
      .filter((line) => /^\s*(COPY|ADD)\s/.test(line));
    expect(copies.length).toBeGreaterThan(0);
    for (const line of copies) {
      expect(line, line).not.toMatch(/apps\/docs/);
      // a wholesale copy of the workspace would carry apps/docs along
      expect(line, line).not.toMatch(
        /^\s*(?:COPY|ADD)\s+(?:--\S+\s+)*(?:\.|\.\/|apps\/?|\/app\/apps\/?)\s/,
      );
    }
  });

  it("is excluded from every build context through .dockerignore", () => {
    const ignore = fs.readFileSync(path.join(repoRoot, ".dockerignore"), "utf8").split("\n");
    expect(ignore.map((line) => line.trim())).toContain("apps/docs");
  });
});
