<!--
  SettingsGroup - one settings section (Issue #854, D-854-04/D-854-15): a `.settings-group` with a
  sentence-case h2, an optional description, the section's fields and its own SaveBar.

  The group owns no state and no request. The section component that renders it keeps the snapshot
  and the values (`$lib/settings/section-state`), counts `changes`/`errors` and passes the save and
  discard handlers; the SaveBar exists only while the section has unsaved changes.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import SaveBar from "$components/ui/SaveBar.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";

  interface Props {
    /** Optional anchor id of the section (`/verwalten/...#pausen`), for links from other pages. */
    id?: string;
    /** Section heading, German, sentence case. */
    title: string;
    /** One muted line below the heading. */
    description?: string;
    /** Issue #1058: an explanation as an info symbol next to the heading; `description` stays visible. */
    hint?: string | string[];
    /** Number of unsaved changes; the SaveBar is hidden at 0. */
    changes: number;
    /** Number of invalid fields; saving is blocked while above 0. */
    errors: number;
    saving?: boolean;
    /** What the save does ("Pausen speichern"), never a bare "Speichern". */
    saveLabel: string;
    onSave: () => void;
    onDiscard: () => void;
    children: Snippet;
  }

  let {
    id,
    title,
    description,
    hint,
    changes,
    errors,
    saving = false,
    saveLabel,
    onSave,
    onDiscard,
    children,
  }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const hintId = `${uid}-hint`;
</script>

<section
  class="settings-group"
  {id}
  aria-labelledby={titleId}
  aria-describedby={hint ? hintId : undefined}
>
  {#if hint}
    <div class="hint-row">
      <h2 class="settings-group-title" id={titleId}>{title}</h2>
      <InfoHint text={hint} label={hintLabel(title)} textId={hintId} />
    </div>
  {:else}
    <h2 class="settings-group-title" id={titleId}>{title}</h2>
  {/if}
  {#if description}
    <p class="settings-group-desc">{description}</p>
  {/if}
  <div class="sg-fields">
    {@render children()}
  </div>
  <SaveBar {changes} {errors} {saving} {saveLabel} {onSave} {onDiscard} />
</section>

<style>
  .sg-fields {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    /* 48 rem like the detail form column (#854): the DayGrid's row of seven (from 760 px, D-843-03)
       fits, so the weekday hours read the same on Regeln and in a person's contract. */
    max-width: 48rem;
    min-width: 0;
  }
</style>
