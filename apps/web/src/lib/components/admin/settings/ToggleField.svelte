<!--
  ToggleField - a yes/no setting of a settings section (Issue #854): a checkbox with its label and a
  help line. It never saves on its own; the section's SaveBar commits it together with the other
  fields (docs/ADMIN_STRUCTURE.md §3.2.1).
-->
<script lang="ts">
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";

  interface Props {
    checked: boolean;
    label: string;
    help?: string;
    /** Issue #1058: an explanation as an info symbol next to the label; `help` stays visible. */
    hint?: string | string[];
    disabled?: boolean;
    /** Stable hook for the e2e specs. */
    testid?: string;
    /** Only for an instant-save switch; runs after `checked` holds the new value. */
    onchange?: () => void;
  }

  let {
    checked = $bindable(),
    label,
    help,
    hint,
    disabled = false,
    testid,
    onchange,
  }: Props = $props();

  const uid = $props.id();
  const inputId = `${uid}-input`;
  const helpId = `${uid}-help`;
  const hintId = `${uid}-hint`;
  const describedBy = $derived(
    [hint ? hintId : "", help ? helpId : ""].filter(Boolean).join(" ") || undefined,
  );
</script>

<div class="toggle-field">
  <input
    id={inputId}
    type="checkbox"
    bind:checked
    {onchange}
    {disabled}
    data-testid={testid}
    aria-describedby={describedBy}
  />
  <div class="tf-text">
    {#if hint}
      <div class="tf-label-row">
        <label class="tf-label" for={inputId}>{label}</label>
        <InfoHint text={hint} label={hintLabel(label)} textId={hintId} />
      </div>
    {:else}
      <label class="tf-label" for={inputId}>{label}</label>
    {/if}
    {#if help}
      <p class="tf-help" id={helpId}>{help}</p>
    {/if}
  </div>
</div>

<style>
  .toggle-field {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    min-width: 0;
  }

  .toggle-field input {
    flex-shrink: 0;
    width: 1.125rem;
    height: 1.125rem;
    margin-top: 0.125rem;
    accent-color: var(--brand);
  }

  .tf-text {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }

  .tf-label-row {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
  }

  .tf-label {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
  }

  .tf-help {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text-2);
  }
</style>
