/**
 * Files findings as GitHub issues (Issue #715). Label `simulation`, ids only, one open issue per
 * finding key. The default is a dry run; nothing is created without `create: true`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Finding } from "./types";

export interface Gh {
  (args: string[]): Promise<{ code: number; stdout: string }>;
}

/**
 * Sonar S4036 (Issue #1007): `gh` is never looked up through PATH. It is started by absolute path
 * from fixed system directories that only root can write; the simulation host installs it there
 * (`apt install gh` → /usr/bin/gh, docs/simulation.md).
 */
const GH_DIRS = ["/usr/bin", "/usr/local/bin", "/bin"] as const;

export function ghBinary(exists: (path: string) => boolean = existsSync): string {
  for (const dir of GH_DIRS) {
    const candidate = `${dir}/gh`;
    if (exists(candidate)) return candidate;
  }
  throw new Error(`gh not found in ${GH_DIRS.join(", ")}`);
}

/** A GitHub repository as `owner/name` — the only shape `fileIssues` passes on. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const ghCli: Gh = (args) =>
  new Promise((resolve) => {
    let bin: string;
    try {
      bin = ghBinary();
    } catch {
      resolve({ code: 127, stdout: "" });
      return;
    }
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.on("error", () => resolve({ code: 127, stdout: "" }));
  });

export interface IssueDraft {
  key: string;
  title: string;
  body: string;
}

/** A finding must never carry anything that looks like personal data. */
export function assertNoPersonData(text: string): void {
  if (/@/.test(text)) throw new Error("A finding text contains an address-like character");
  if (/Bot-[A-Z]\d{4}/i.test(text)) throw new Error("A finding text contains a person label");
}

const SAMPLE_SIZE = 5;

/** One draft per cause class: the group key, the count and a bounded sample of the messages. */
export function draftIssues(
  findings: readonly Finding[],
  run: { date: string; seed: string },
): IssueDraft[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = finding.group ?? finding.key;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.entries()].map(([group, members]) =>
    draftIssue(
      {
        ...members[0],
        key: group,
        message:
          members.length === 1
            ? members[0].message
            : `${members.length} occurrences, first ${SAMPLE_SIZE}:\n- ${members
                .slice(0, SAMPLE_SIZE)
                .map((m) => m.message)
                .join("\n- ")}`,
      },
      run,
    ),
  );
}

export function draftIssue(finding: Finding, run: { date: string; seed: string }): IssueDraft {
  assertNoPersonData(finding.message);
  assertNoPersonData(finding.key);
  const title = `Simulation: ${finding.invariant} (${finding.key.slice(0, 60)})`;
  const body = [
    `Found by the nightly invariant checker of the simulation instance (#715) on ${run.date}.`,
    "",
    `**Invariant:** \`${finding.invariant}\``,
    `**Finding:** ${finding.message}`,
    "",
    `Reproduce: provision with seed \`${run.seed}\`, replay the bot days up to ${run.date} and run \`sim check\`. See docs/simulation.md, "Reproduce a failure".`,
    "",
    "Ids and dates only; the simulation holds no real personal data.",
    "",
    `sim-key: ${finding.key}`,
  ].join("\n");
  return { key: finding.key, title, body };
}

export interface FileResult {
  key: string;
  action: "would-create" | "created" | "exists" | "failed";
  number?: number;
}

export async function fileIssues(
  drafts: readonly IssueDraft[],
  options: { repo: string; create: boolean; gh?: Gh },
): Promise<FileResult[]> {
  const gh = options.gh ?? ghCli;
  // Sonar S8705 (Issue #1007): every value that is not a literal of this file is passed as
  // `--flag=value`, so gh can never read a title, body, search or repo as an option of its own.
  if (!REPO_RE.test(options.repo)) throw new Error(`fileIssues: not a repository: ${options.repo}`);
  const results: FileResult[] = [];
  if (options.create) {
    await gh([
      "label",
      "create",
      "simulation",
      `--repo=${options.repo}`,
      "--color",
      "5319e7",
      "--description",
      "Found by the simulation instance",
    ]);
  }
  for (const draft of drafts) {
    const listed = await gh([
      "issue",
      "list",
      `--repo=${options.repo}`,
      "--label",
      "simulation",
      "--state",
      "open",
      `--search="sim-key: ${draft.key}" in:body`,
      "--json",
      "number,body",
      "--limit",
      "20",
    ]);
    let existing: { number: number; body: string }[] = [];
    if (listed.code === 0) {
      try {
        existing = JSON.parse(listed.stdout) as { number: number; body: string }[];
      } catch {
        existing = [];
      }
    }
    const match = existing.find((issue) => issue.body.includes(`sim-key: ${draft.key}`));
    if (match) {
      results.push({ key: draft.key, action: "exists", number: match.number });
      continue;
    }
    if (!options.create) {
      results.push({ key: draft.key, action: "would-create" });
      continue;
    }
    const created = await gh([
      "issue",
      "create",
      `--repo=${options.repo}`,
      "--label",
      "simulation",
      `--title=${draft.title}`,
      `--body=${draft.body}`,
    ]);
    results.push({ key: draft.key, action: created.code === 0 ? "created" : "failed" });
  }
  return results;
}
