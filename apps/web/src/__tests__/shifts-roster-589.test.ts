// Issue #589 (OD-589-1, D-589-01/D-589-02/D-589-05/D-589-06, AC-589-3/-4/-7) — source pins on the
// /shifts page: it reads its rows, contract marks and hints only from `roster-rows.ts`, handles the
// refusal code `SHIFT_NO_CONTRACT` in all three write paths (template drop, shift move, dialog save),
// keeps no trace of the retired SHIFT_BASED-only gate and names every Arbeitszeitmodell through
// `MODEL_LABELS`. The page imports `$app/*` and cannot be mounted here, so the wiring is pinned in the
// source; the behaviour of the helpers is proven in `lib/shifts/__tests__/roster-rows-589.test.ts`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const PAGE = readFileSync(resolve(SRC, "routes/(app)/shifts/+page.svelte"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|ts)$/.test(name)) out.push(full);
  }
  return out;
}

describe("Issue #589 — /shifts roster wiring", () => {
  it("takes rows, marks and hints from roster-rows.ts and computes none itself", () => {
    expect(PAGE).toMatch(/import \{[^}]*rosterRows[^}]*\} from "\$lib\/shifts\/roster-rows"/);
    expect(PAGE).toMatch(
      /import \{[^}]*countedByContract[^}]*\} from "\$lib\/shifts\/roster-rows"/,
    );
    expect(PAGE).toMatch(
      /import \{[^}]*contractFreeDayHint[^}]*\} from "\$lib\/shifts\/roster-rows"/,
    );
    expect(PAGE).toMatch(/shiftEmployees = \$derived\(week \? rosterRows\(week\) : \[\]\)/);
    expect(PAGE).not.toMatch(/function shiftHours\(/);
    // The retired Phase 47.1 filter is gone.
    expect(PAGE).not.toMatch(/week\.employees\.filter\(/);
    expect(PAGE).not.toContain("Keine Mitarbeiter im Schichtsystem");
  });

  it("handles the refusal SHIFT_NO_CONTRACT in the template drop, the shift move and the dialog", () => {
    const uses = PAGE.match(/shiftNoContractMessage\(/g) ?? [];
    expect(uses.length).toBe(3);
    expect(PAGE).toMatch(/modalError = noContract/);
  });

  it("a day the server marks closed is closed for the staffing figure and the day picker", () => {
    expect(PAGE).toMatch(/coverageByDate\.get\(iso\.slice\(0, 10\)\)\?\.closed === true/);
  });

  it("names a row's model through MODEL_LABELS, never the enum", () => {
    expect(PAGE).toMatch(/import \{ MODEL_LABELS \} from "\$lib\/employees\/contract-history"/);
    expect(PAGE).toContain("MODEL_LABELS[u.workSchedules[0].type]");
  });

  it("no web file knows the retired type-gate code", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(200); // a moved or emptied tree must not pass vacuously
    const hits = files
      .filter((f) => !f.endsWith("shifts-roster-589.test.ts"))
      .filter((f) => !f.endsWith("roster-rows-589.test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("SHIFT_INVALID_EMPLOYEE_TYPE"));
    expect(hits).toEqual([]);
  });
});
