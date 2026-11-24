<script lang="ts">
  // Issue #1029: ONE slim line above the Team › Zeiten calendar naming the days with a day-check
  // result - „2 Tage mit Pausenbefund: Mi 04.11. · Mi 11.11.“ and, for every other day the break
  // panel has something to show for, „N Tage mit Hinweis: …“. Each named day is a button that opens
  // that day's day view, where the details and the acknowledgement live. The text carries dates and
  // counts only; a redacted day (#85 D-07) is a „Hinweis“ day like any other and never a finding.
  import Note from "$components/ui/Note.svelte";
  import { dayCheckLine, lineDayLabel, type DayCheckGroup } from "$lib/breaks/day-check-line";
  import type { DayCheck } from "$lib/breaks/day-break-violation";
  import { countWord } from "$lib/utils/count-word";

  interface Props {
    checks: DayCheck[];
    onOpenDay: (day: string) => void;
    /** Opens the full list when more days exist than the line names. */
    onMore?: () => void;
  }

  let { checks, onOpenDay, onMore }: Props = $props();

  const SEP = " · ";
  const model = $derived(dayCheckLine(checks));
  const groups = $derived.by(() => {
    if (!model) return [];
    const list: { key: string; label: string; group: DayCheckGroup }[] = [];
    if (model.findings.total > 0)
      list.push({ key: "findings", label: "mit Pausenbefund:", group: model.findings });
    if (model.others.total > 0)
      list.push({ key: "others", label: "mit Hinweis:", group: model.others });
    return list;
  });
</script>

{#if model}
  <div class="dcl" data-testid="day-check-line">
    <Note tone={model.findings.total > 0 ? "warn" : "info"}>
      {#each groups as g, gi (g.key)}
        {#if gi > 0}
          {SEP}
        {/if}
        {countWord(g.group.total, "Tag", "Tage")}
        {g.label}
        {#each g.group.days as day, di (day)}
          {#if di > 0}
            {SEP}
          {/if}
          <button
            type="button"
            class="dcl-day"
            data-testid="day-check-line-day"
            data-date={day}
            onclick={() => onOpenDay(day)}>{lineDayLabel(day)}</button
          >
        {/each}
        {#if g.group.more > 0 && onMore}
          {SEP}
          <button
            type="button"
            class="dcl-day"
            data-testid="day-check-line-more"
            aria-label="Alle Tage in der Liste zeigen"
            onclick={() => onMore?.()}>{g.group.more} weitere</button
          >
        {/if}
      {/each}
    </Note>
  </div>
{/if}

<style>
  .dcl {
    margin-bottom: var(--s-3);
  }
  /* The inline-link look of app.css: a button that reads as underlined text. */
  .dcl-day {
    appearance: none;
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: var(--brand);
    text-underline-offset: 2px;
  }
  .dcl-day:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: var(--r-control);
  }
  @media (max-width: 640px) {
    /* WCAG 2.5.8: an inline target of at least 24 px. */
    .dcl-day {
      display: inline-block;
      min-height: 24px;
    }
  }
</style>
