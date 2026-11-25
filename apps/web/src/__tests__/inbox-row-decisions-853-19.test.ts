// Issue #853-19 - source pins of the Aufgaben rows' in-row decision (prototype „Aufgaben“): the page
// imports `$app/*`, so it cannot be mounted; what can be mounted is pinned elsewhere
// (`LeaveReviewDialog.decide-853.test.ts`: the decision path, `TaskRowActions.test.ts`: the buttons,
// `task-row-facts.test.ts`: the context line). This file pins how the page wires them, and that the
// pre-existing rules survive: the reason of a rejection is required, the manager-correction fields of
// the Zeitnachtrag dialog are not sent by a plain approval, the permission gates stay hints.
import { describe, expect, it } from "vitest";
import inboxSource from "../routes/(app)/inbox/+page.svelte?raw";
import { pageSlice } from "../lib/lists/list-page";
import dialogSource from "../lib/components/leave/LeaveReviewDialog.svelte?raw";

const flat = inboxSource.replace(/\s+/g, " ");

describe("Issue #853-19 - the in-row decision on /inbox", () => {
  it("[vacuity] the page source is the inbox with its task list", () => {
    expect(inboxSource.length).toBeGreaterThan(30_000);
    expect(flat).toContain("<TaskRow");
  });

  it("an open leave or Zeitnachtrag row decides in the row: TaskRowActions, no Prüfen button", () => {
    expect(flat).toContain("<TaskRowActions");
    expect(flat).toContain("onApprove={() => approveRow(row)}");
    expect(flat).toContain("onReject={() => askRejectReason(row)}");
    expect(flat).toContain("own={isOwnRow(row)}");
    // The old single „Prüfen“ button that only opened the dialog is gone; the title still opens it.
    expect(flat).not.toMatch(/<button[^>]*> *Prüfen *<\/button>/);
    expect(flat).toContain("openDetail(request)");
    expect(flat).toContain("openRetroDetail(retro)");
  });

  it("Genehmigen acts through the dialog's own decision path for leave and the review PATCH for a Zeitnachtrag", () => {
    expect(flat).toContain('await reviewDialog?.decide("APPROVED")');
    expect(flat).toContain('await decideRetroRow(target.retro, "APPROVED")');
    expect(flat).toContain("`/retro-entry-requests/${retro.id}/review`");
    // A plain approval is byte-identical to the dialog's untouched approval: no corrected times.
    const body = flat.slice(flat.indexOf("async function decideRetroRow"));
    const patch = body.slice(0, body.indexOf("await loadRetroRequests()"));
    expect(patch).not.toContain("retroCorrectedFields");
    expect(patch).not.toContain("startTime");
    expect(patch).not.toContain("breakMinutes");
  });

  it("Issue #941: the row's Genehmigen only asks; the write happens in the confirmation's Genehmigen", () => {
    const ask = flat.slice(flat.indexOf("function approveRow(row: TaskRowModel)"));
    const askBody = ask.slice(0, ask.indexOf("async function confirmRowApprove"));
    expect(askBody).toContain("rowApproveOpen = true;");
    expect(askBody).not.toContain("decide(");
    expect(askBody).not.toContain("decideRetroRow(");
    expect(askBody).not.toContain("api.");
    // Both approve calls sit in `confirmRowApprove`, which only the two confirmations call.
    const confirm = flat.slice(flat.indexOf("async function confirmRowApprove"));
    const fn = confirm.slice(0, confirm.indexOf("/** The fact line of a Zeitnachtrag"));
    expect(fn).toContain('reviewDialog?.decide("APPROVED")');
    expect(fn).toContain('decideRetroRow(target.retro, "APPROVED")');
    expect(flat.split("onConfirm={confirmRowApprove}").length - 1).toBe(2);
    expect(flat).toContain("<LeaveApproveConfirm");
    expect(flat).toContain('title="Zeitnachtrag genehmigen?"');
    // The leave confirmation reads its facts within the caller's permissions (shift:read reach),
    // with the same flags as the review dialog.
    const leaveConfirm = flat.slice(flat.indexOf("<LeaveApproveConfirm"));
    const tag = leaveConfirm.slice(0, leaveConfirm.indexOf("/>"));
    expect(tag).toContain("{...reviewFactFlags}");
    expect(flat).toContain(
      'canReadShifts: hasPermission($authStore.user, "shift:read:ZUGEWIESEN")',
    );
    // No delayed write and no undo: a decision is written when it is confirmed.
    expect(flat).not.toMatch(/setTimeout\([^)]*(decide|decideRetroRow)/);
    expect(flat).not.toContain("Rückgängig");
  });

  it("Ablehnen always asks for the reason first: the ReasonDialog is the only way to a row rejection", () => {
    expect(flat).toContain("onConfirm={confirmRowReject}");
    expect(flat).toContain('confirmLabel="Ablehnen"');
    // The two rejection calls sit inside `confirmRowReject`, which only the ReasonDialog calls (it
    // passes a non-empty trimmed reason and keeps itself open when this throws).
    const confirm = flat.slice(flat.indexOf("async function confirmRowReject"));
    const end = confirm.indexOf("/** The Zeitnachtrag decision of a row");
    const fn = confirm.slice(0, end);
    expect(fn).toContain('reviewDialog?.decide("REJECTED", reason, { toastErrors: false })');
    expect(fn).toContain('decideRetroRow(target.retro, "REJECTED", reason)');
    expect(flat.split('"REJECTED"').length - 1).toBeGreaterThanOrEqual(3);
    // The row buttons never reject by themselves.
    expect(flat).not.toMatch(/onReject=\{\(\) => (decideRetroRow|reviewDialog)/);
    // The Zeitnachtrag review PATCH sends the reason as the review note.
    expect(flat).toContain("reviewNote: reason?.trim() ? reason : null");
  });

  it("the toast after a row decision is the shared one, and a refusal shows the server text", () => {
    expect(flat).toContain("reviewResultToast(status,");
    expect(flat).toContain('apiErr?.data?.error ?? apiErr?.message ?? "Fehler"');
    expect(flat).toContain("toasts.error(errorText(e))");
  });

  it("the caller's own request has no decision buttons (four eyes), decided in one place", () => {
    expect(flat).toContain("function isOwnRow(row: TaskRowModel)");
    expect(flat).toContain("$authStore.user?.employeeId");
  });

  it("the context line of a leave row is read within the caller's permissions, from the cached loader", () => {
    expect(flat).toContain("createLeaveContextLoader(");
    expect(flat).toContain('hasPermission($authStore.user, "leave-entitlement:read:ZUGEWIESEN")');
    expect(flat).toContain("{ canReadEntitlement: canReadEntitlementFact }");
    // Issue #1028 re-target, with reason: the context lines are read for the rows of the SHOWN PAGE, not
    // for the first 40 rows (`CONTEXT_ROWS` is gone, no row of a later page is left without its line).
    expect(flat).not.toContain("CONTEXT_ROWS");
    expect(flat).toContain('pagedTaskRows.filter((r) => r.kind === "urlaub" && !r.decided)');
    expect(flat).toContain("context={request ? (rowContext[request.id] ?? null) : null}");
    // Only open leave rows of the open view are read, and a decision makes the figures stale.
    expect(flat).toContain('r.kind === "urlaub" && !r.decided');
    expect(flat).toContain('taskView.ansicht !== "offen"');
    expect(flat).toContain("resetRowContext();");
    // No direct entitlement/overlap/shift request outside the loader readers (the dialog keeps its own).
    expect(flat.split("/leave/entitlements/").length - 1).toBe(1);
    expect(flat.split("/leave/overlap?").length - 1).toBe(1);
    expect(flat).not.toContain("/shifts/range");
  });

  it("the dialog exports the decision for the row and keeps one decision path", () => {
    expect(dialogSource).toContain("export async function decide(");
    // decide() reaches the server only through submitReview -> runReview, like the buttons.
    const decide = dialogSource.slice(dialogSource.indexOf("export async function decide("));
    const body = decide.slice(0, decide.indexOf("async function submitReview("));
    expect(body).toContain("await submitReview(status,");
    expect(body).not.toContain("api.patch");
    expect(dialogSource.split("api.patch(`/leave/requests/${ctx.id}/review`").length - 1).toBe(1);
  });
});

describe("Issue #1028 - the Aufgaben list pages and reads context lines per page", () => {
  it("the page pages with the register id of the full task list and the shared Pager", () => {
    expect(flat).toContain('const TASK_LIST_ID = "team.aufgaben.liste";');
    expect(flat).toContain("<Pager");
    expect(flat).toContain("{#each pagedTaskRows as row (row.key)}");
    expect(flat).not.toContain("{#each visibleTaskRows");
  });

  it("30 open rows at size 25 read 25 context lines, page 2 reads the other 5", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ key: `r${i}` }));
    expect(pageSlice(rows, 1, 25)).toHaveLength(25);
    expect(pageSlice(rows, 2, 25)).toHaveLength(5);
    // The reads iterate the shown page only (one read per row, cached per request in `requested`).
    expect(flat).toContain("for (const row of rows) {");
    expect(flat).toContain("reads.requested.has(req.id)");
  });

  it("a § 9 deep link pages to its row", () => {
    expect(flat).toContain(
      'visibleTaskRows.findIndex((r) => r.kind === "paragraf9" && r.sourceId === id)',
    );
    expect(flat).toContain("taskPage = pageOfIndex(at, taskPageSize);");
  });
});
