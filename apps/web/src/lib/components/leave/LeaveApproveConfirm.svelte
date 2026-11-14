<script lang="ts" module>
  /** The sentence under the title: the decision is stored on confirm, and how it is taken back. */
  export const APPROVE_CONFIRM_TEXT =
    "Die Genehmigung wird beim Bestätigen gespeichert. Zurücknehmen kannst du sie danach nur über eine Stornierung.";
  export const CANCELLATION_CONFIRM_TEXT =
    "Mit der Genehmigung ist der Urlaub storniert. Die Entscheidung wird beim Bestätigen gespeichert.";
</script>

<script lang="ts">
  /**
   * LeaveApproveConfirm - Issue #941. The compact confirmation of „Genehmigen“ in a task row of
   * Team › Aufgaben. Before, the row button approved at once; one stray click wrote an
   * audit-relevant decision that only a cancellation (with a second approver) could take back.
   *
   * It shows the facts the decision is taken on (`LeaveDecisionFacts`, the same component as the
   * review dialog: Resturlaub before -> after, Stammsalon, shifts in the period, each within the
   * caller's permissions) and writes nothing itself: `onConfirm` runs the dialog's one decision path
   * (`LeaveReviewDialog.decide`). There is deliberately no delayed write and no "undo": a decision is
   * written when the person confirms it, and taking it back would be a second audited action.
   *
   * No auth store import (mountable in vitest); the permission flags come in as props.
   */
  import ConfirmDialog from "$components/ui/ConfirmDialog.svelte";
  import LeaveDecisionFacts from "./LeaveDecisionFacts.svelte";
  import type { LeaveReviewRequest } from "$lib/leave/leave-review";

  interface Props {
    open: boolean;
    request: LeaveReviewRequest;
    canReadEntitlement?: boolean;
    canReadShifts?: boolean;
    canReadEmployee?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(),
    request,
    canReadEntitlement = false,
    canReadShifts = false,
    canReadEmployee = false,
    onConfirm,
    onCancel,
  }: Props = $props();

  const cancellation = $derived(request.status === "CANCELLATION_REQUESTED");
</script>

<ConfirmDialog
  bind:open
  title={cancellation ? "Stornierung genehmigen?" : "Antrag genehmigen?"}
  description={cancellation ? CANCELLATION_CONFIRM_TEXT : APPROVE_CONFIRM_TEXT}
  confirmLabel={cancellation ? "Stornierung genehmigen" : "Genehmigen"}
  danger={cancellation}
  {onConfirm}
  {onCancel}
>
  {#snippet body()}
    <div class="approve-facts">
      <LeaveDecisionFacts
        {request}
        active={open}
        {canReadEntitlement}
        {canReadShifts}
        {canReadEmployee}
        testId="leave-approve-confirm-facts"
      />
    </div>
  {/snippet}
</ConfirmDialog>

<style>
  .approve-facts {
    margin-top: var(--s-4);
  }
</style>
