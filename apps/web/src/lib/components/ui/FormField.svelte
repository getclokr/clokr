<script lang="ts">
  // Issue #843 (D-843-01 block 7) - label, field, help line and error line with the ARIA wiring.
  // The field is a snippet so the page keeps its own control (input, select, textarea); it
  // receives the id, the describedby list and the invalid flag and puts them on the control.
  import type { Snippet } from "svelte";
  import InfoHint, { hintLabel } from "./InfoHint.svelte";

  interface FieldContext {
    /** The id the control must carry; the label points at it. */
    id: string;
    /** Space-separated ids of the help and error lines, undefined when neither is rendered. */
    describedBy: string | undefined;
    /** True while an error is shown; set aria-invalid="true" on the control. */
    invalid: boolean;
  }

  interface Props {
    label: string;
    help?: string;
    /**
     * Additive (#992): the id of the help line, for a control OUTSIDE this field that is described by
     * it (the reject button of the review dialog). Default: a generated id.
     */
    helpId?: string;
    /**
     * Issue #1058: an explanation as an info symbol next to the label. `help` stays the visible
     * line for text that must stay visible (a deadline, a lock, a warning, a consequence).
     */
    hint?: string;
    error?: string;
    required?: boolean;
    field: Snippet<[FieldContext]>;
  }

  let { label, help, helpId: helpIdProp, hint, error, required = false, field }: Props = $props();

  const uid = $props.id();
  const fieldId = `${uid}-field`;
  const helpId = $derived(helpIdProp ?? `${uid}-help`);
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;

  const describedBy = $derived.by(() => {
    const ids: string[] = [];
    if (hint) ids.push(hintId);
    if (help) ids.push(helpId);
    if (error) ids.push(errorId);
    return ids.length > 0 ? ids.join(" ") : undefined;
  });
</script>

<div class="form-field">
  {#if hint}
    <div class="ff-label-row">
      <label class="ff-label" for={fieldId}>
        {label}{#if required}<span class="ff-required" aria-hidden="true"> *</span>{/if}
      </label>
      <InfoHint text={hint} label={hintLabel(label)} textId={hintId} />
    </div>
  {:else}
    <label class="ff-label" for={fieldId}>
      {label}{#if required}<span class="ff-required" aria-hidden="true"> *</span>{/if}
    </label>
  {/if}
  <div class="ff-control">
    {@render field({ id: fieldId, describedBy, invalid: Boolean(error) })}
  </div>
  {#if help}
    <p class="ff-help" id={helpId}>{help}</p>
  {/if}
  {#if error}
    <p class="ff-error" id={errorId}>
      <span class="ff-error-dot" aria-hidden="true"></span>{error}
    </p>
  {/if}
</div>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }

  /* The label and its info symbol on one row (Issue #1058); the symbol never sits inside the label. */
  .ff-label-row {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
  }

  .ff-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  .ff-required {
    color: var(--text-2);
  }

  /* The control is the page's own element; only its height and density are set here, scoped to
     this block, so the global input recipes stay untouched. */
  .ff-control :global(input),
  .ff-control :global(select) {
    min-height: var(--h-control);
    padding-top: 0;
    padding-bottom: 0;
    font-size: var(--fs-base);
  }

  .ff-control :global([aria-invalid="true"]) {
    border-color: var(--bad);
  }

  .ff-help,
  .ff-error {
    margin: 0;
    font-size: var(--fs-sm);
  }

  .ff-help {
    color: var(--text-3);
  }

  .ff-error {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--bad);
  }

  .ff-error-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--bad);
  }
</style>
