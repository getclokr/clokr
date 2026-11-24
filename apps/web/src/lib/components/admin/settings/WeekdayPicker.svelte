<!--
  WeekdayPicker - Mo…So as a checkbox group (Issue #854): the company's standard workdays and the
  core-time days. The value is the index array the API stores (0 = Sonntag … 6 = Samstag), kept
  ascending. It never saves on its own; the section's SaveBar commits it.
-->
<script lang="ts">
  import { WEEKDAYS, toggleDay } from "$lib/settings/arbeitszeit";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";

  interface Props {
    /** Selected weekday indices (bindable). */
    value: number[];
    /** Accessible name of the group. */
    legend: string;
    help?: string;
    /** Issue #1058: an explanation as an info symbol after the legend; `help` stays visible. */
    hint?: string;
    error?: string;
    disabled?: boolean;
    /** Prefix of the per-day test ids, e.g. "arbeitstage" -> "arbeitstage-1". */
    testidPrefix?: string;
  }

  let {
    value = $bindable(),
    legend,
    help,
    hint,
    error,
    disabled = false,
    testidPrefix,
  }: Props = $props();

  const uid = $props.id();
  const helpId = `${uid}-help`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const describedBy = $derived(
    [hint ? hintId : "", help ? helpId : "", error ? errorId : ""].filter(Boolean).join(" ") ||
      undefined,
  );
</script>

<fieldset
  class="weekday-picker"
  class:weekday-picker--hinted={Boolean(hint)}
  aria-describedby={describedBy}
>
  <legend class="wp-legend">{legend}</legend>
  {#if hint}
    <!-- Beside the legend, never inside it, so the group's name stays the legend text. -->
    <div class="wp-hint"><InfoHint text={hint} label={hintLabel(legend)} textId={hintId} /></div>
  {/if}
  <div class="wp-days">
    {#each WEEKDAYS as day (day.value)}
      <label class="wp-day" class:wp-day--on={value.includes(day.value)}>
        <input
          type="checkbox"
          checked={value.includes(day.value)}
          {disabled}
          aria-label={day.full}
          data-testid={testidPrefix ? `${testidPrefix}-${day.value}` : undefined}
          onchange={() => (value = toggleDay(value, day.value))}
        />
        <span aria-hidden="true">{day.short}</span>
      </label>
    {/each}
  </div>
  {#if help}
    <p class="wp-help" id={helpId}>{help}</p>
  {/if}
  {#if error}
    <p class="wp-error" id={errorId}>{error}</p>
  {/if}
</fieldset>

<style>
  .weekday-picker {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  /* With a hint the fieldset is plain block flow: the legend floats (so it is an ordinary box, not
     the rendered legend on the border) and the info symbol floats after it on the same line. */
  .weekday-picker--hinted {
    display: block;
  }

  .weekday-picker--hinted .wp-legend {
    float: left;
    margin-right: var(--s-1);
  }

  .wp-hint {
    float: left;
    display: flex;
    align-items: center;
  }

  .weekday-picker--hinted .wp-days {
    clear: both;
    padding-top: var(--s-1);
  }

  .weekday-picker--hinted .wp-help,
  .weekday-picker--hinted .wp-error {
    margin-top: var(--s-1);
  }

  .wp-legend {
    padding: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  .wp-days {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }

  .wp-day {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--h-control);
    padding: 0 var(--s-3);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    background: var(--card);
    font-size: var(--fs-base);
    color: var(--text);
    cursor: pointer;
  }

  .wp-day--on {
    border-color: var(--brand);
    background: var(--brand-soft);
  }

  .wp-day input {
    width: 1rem;
    height: 1rem;
    margin: 0;
    accent-color: var(--brand);
  }

  .wp-help {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text-2);
  }

  .wp-error {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--bad);
  }
</style>
