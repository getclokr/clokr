// Issue #1026 - after a Zeitnachtrag decision in Aufgaben the open tasks are read again, so a task
// the decision resolved (an approval corrects the entry since #1021, so its „Ausstempeln fehlt“ is
// gone) disappears at once. The page imports `$app/*` and cannot be mounted; this pins the wiring.
import { describe, expect, it } from "vitest";
import inboxSource from "../routes/(app)/inbox/+page.svelte?raw";

const flat = inboxSource.replace(/\s+/g, " ");

function fnBody(name: string, endMarker: string): string {
  const start = flat.indexOf(name);
  expect(start).toBeGreaterThan(-1);
  const rest = flat.slice(start);
  const end = rest.indexOf(endMarker);
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

describe("Issue #1026 - Aufgaben reloads the open tasks after a Zeitnachtrag decision", () => {
  it("[vacuity] the page has the open-task read and both decision paths", () => {
    expect(flat).toContain("async function loadOpenTasks()");
    expect(flat).toContain("async function decideRetroRow(");
    expect(flat).toContain('async function submitRetroReview(status: "APPROVED" | "REJECTED")');
  });

  it("the reload helper reads the open tasks only for a caller who has them", () => {
    const helper = fnBody(
      "function reloadTasksAfterRetroDecision(): Promise<void>",
      "async function loadOpenTasks()",
    );
    expect(helper).toContain("canOpenTasks ? loadOpenTasks() : Promise.resolve()");
  });

  it("the row decision (approve and reject) reloads the open tasks with the Zeitnachträge", () => {
    const body = fnBody("async function decideRetroRow(", "function isOwnRow(");
    expect(body).toContain("reloadTasksAfterRetroDecision()");
    expect(body).toContain("await loadRetroRequests()");
    expect(body).toContain("await tasksReloaded");
    // One path for both outcomes: no branch on the status before the reload.
    expect(body).not.toMatch(/if \(status === "APPROVED"\)[^}]*reloadTasksAfterRetroDecision/);
  });

  it("the dialog decision (approve and reject) reloads the open tasks after a successful PATCH", () => {
    const body = fnBody(
      'async function submitRetroReview(status: "APPROVED" | "REJECTED")',
      "} catch (e: unknown)",
    );
    const patchAt = body.indexOf("api.patch(`/retro-entry-requests/${retroDetail.id}/review`");
    const reloadAt = body.indexOf("reloadTasksAfterRetroDecision()");
    expect(patchAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(patchAt);
    expect(body).toContain("await tasksReloaded");
  });
});
