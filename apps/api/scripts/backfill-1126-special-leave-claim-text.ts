/**
 * Bestandskorrektur — Issue #1126.
 *
 * Until Issue #1126 Clokr seeded its eleven suggested special-leave occasions with a stored
 * description that claims a statutory entitlement under § 616 BGB. § 616 BGB names no occasion and
 * no number of days and can be excluded by contract, so no text may claim an entitlement. New
 * suggestions are now created without a description; this script empties the description of the
 * suggestions that still carry the unchanged legacy seed text.
 *
 * Match (exact, per rule): `isStatutory: true` AND `reason` byte-identical to
 * `LEGACY_SEED_REASON`. A tenant-edited description (any other text, an extended text), a custom
 * rule (`isStatutory: false`) with the same text and a suggestion without a description are never
 * touched. Only the `reason` column is written; name, days, proof, status and `isStatutory` stay.
 * "Empty" means SQL NULL (the column is nullable and the web shows nothing for a null reason).
 *
 * DRY RUN is the default: it lists the rules a `--confirm` run would change and writes ZERO rows.
 * `--confirm` writes one transaction per rule: a guarded `updateMany` that re-checks id, tenant,
 * `isStatutory` and the exact legacy text, plus one audit row (user null = SYSTEM, old value
 * `{reason: <legacy text>}`, new value `{reason: null, trigger: "BACKFILL_1126",
 * auditReason: "Bestandskorrektur #1126"}`). A rule edited between read and write is reported as
 * `unchanged` and writes nothing. Idempotent: a second run finds nothing. A failure for one rule is
 * reported and does not stop the others. `--tenant <id>` narrows the run; without it all tenants,
 * deactivated ones included, are processed. Output: ids and counts only, never a text.
 *
 * Usage:
 *   pnpm --filter @clokr/api exec tsx scripts/backfill-1126-special-leave-claim-text.ts [--tenant <id>] [--confirm] [--help]
 *
 * Exit codes: 0 — done; 1 — usage error, DATABASE_URL missing, or at least one rule failed.
 */
import type { FastifyInstance } from "fastify";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;

/**
 * The legacy seed text, kept here only to FIND the rows. It is the only text the seed ever wrote
 * and must never be written again.
 */
export const LEGACY_SEED_REASON = "Gesetzlicher Anspruch gemäß § 616 BGB";

/** The machine marker and the German display reason written to every audit row of this run. */
export const BACKFILL_MARKER = {
  auditReason: "Bestandskorrektur #1126",
  trigger: "BACKFILL_1126",
} as const;

export type RuleResult = {
  tenantId: string;
  ruleId: string;
  /** `planned` = dry run would write; `written`; `unchanged` = edited meanwhile; `failed:<CODE>`. */
  outcome: string;
};

export type BackfillOptions = { confirm: boolean; tenantId?: string };

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Runs the backfill. Exported for the test, which injects the test app. */
export async function runBackfill(
  app: FastifyInstance,
  options: BackfillOptions,
): Promise<RuleResult[]> {
  const candidates = await app.prisma.specialLeaveRule.findMany({
    where: {
      isStatutory: true,
      reason: LEGACY_SEED_REASON,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    },
    select: { id: true, tenantId: true },
  });
  candidates.sort((a, b) => compareStrings(a.tenantId, b.tenantId) || compareStrings(a.id, b.id));

  const results: RuleResult[] = [];
  for (const candidate of candidates) {
    const base = { tenantId: candidate.tenantId, ruleId: candidate.id };
    if (!options.confirm) {
      results.push({ ...base, outcome: "planned" });
      continue;
    }
    try {
      const written = await app.prisma.$transaction(async (tx) => {
        const { count } = await tx.specialLeaveRule.updateMany({
          where: {
            id: candidate.id,
            tenantId: candidate.tenantId,
            isStatutory: true,
            reason: LEGACY_SEED_REASON,
          },
          data: { reason: null },
        });
        if (count !== 1) return false;
        await app.audit({
          tx,
          action: "UPDATE",
          entity: "SpecialLeaveRule",
          entityId: candidate.id,
          oldValue: { reason: LEGACY_SEED_REASON },
          newValue: { reason: null, ...BACKFILL_MARKER },
        });
        return true;
      });
      results.push({ ...base, outcome: written ? "written" : "unchanged" });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      results.push({
        ...base,
        outcome: `failed:${typeof code === "string" ? code : ((err as Error).name ?? "ERROR")}`,
      });
    }
  }
  return results;
}

export function formatResult(r: RuleResult): string {
  return `tenant=${r.tenantId} rule=${r.ruleId} result=${r.outcome}`;
}

export function formatTotals(results: RuleResult[]): string {
  const count = (outcome: string) => results.filter((r) => r.outcome === outcome).length;
  return (
    `Totals: rules=${results.length} planned=${count("planned")} written=${count("written")} ` +
    `unchanged=${count("unchanged")} failed=${results.filter((r) => r.outcome.startsWith("failed")).length}`
  );
}

export type CliArgs = { help: boolean; confirm: boolean; tenant: string | undefined };

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false },
      confirm: { type: "boolean", default: false },
      tenant: { type: "string" },
    },
    strict: true,
  });
  return { help: Boolean(values.help), confirm: Boolean(values.confirm), tenant: values.tenant };
}

export const USAGE = `
Usage:
  pnpm --filter @clokr/api exec tsx scripts/backfill-1126-special-leave-claim-text.ts [--tenant <id>] [--confirm] [--help]

Empties (sets to NULL) the description of the suggested special-leave occasions that still carry the
unchanged legacy seed text which claims an entitlement under § 616 BGB (Issue #1126). Only the
description column is written; edited texts and custom rules stay.

  (none)     Dry run: lists the rules that would change, writes ZERO rows.
  --confirm  Writes, one transaction per rule; one audit row per rule (BACKFILL_1126, user SYSTEM).
  --tenant   Restrict to one tenant id (default: all tenants).

Ids and counts only - never a text.
Exit codes: 0 done, 1 usage error / DATABASE_URL missing / a rule failed.
`;

/**
 * Exported for the test: pass the app to inject a test app (worker test DB only); without one the
 * entrypoint below builds the real app from DATABASE_URL.
 */
export async function main(argv: string[], injectedApp?: FastifyInstance): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return EXIT_ERROR;
  }
  if (args.help) {
    console.info(USAGE);
    return EXIT_OK;
  }
  if (!injectedApp && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    return EXIT_ERROR;
  }

  // Lazy import: importing this module for a test must not load the whole app.
  const app = injectedApp ?? (await (await import("../src/app")).buildApp());
  try {
    if (!injectedApp) await app.ready();
    const results = await runBackfill(app, { confirm: args.confirm, tenantId: args.tenant });
    for (const result of results) console.info(formatResult(result));
    console.info(formatTotals(results));
    console.info(args.confirm ? "Written (--confirm)." : "Dry run: this run wrote nothing.");
    return results.some((r) => r.outcome.startsWith("failed")) ? EXIT_ERROR : EXIT_OK;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_ERROR;
  } finally {
    if (!injectedApp) await app.close();
  }
}

// Run-guard: bootstrap only when invoked as a script, so importing the module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = EXIT_ERROR;
    });
}
