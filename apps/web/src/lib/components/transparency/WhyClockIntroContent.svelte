<script lang="ts">
  // Issue #606: the three points of „Warum stempeln?“ and the pointer to „Wer sieht meine Zeiten?“.
  // One component for the Mein Tag card and the Dialog of the profile; the wording lives only in
  // `$lib/transparency/time-transparency`. It carries no heading of its own (the card and the dialog
  // name themselves) and writes nothing.
  import { READERS_ANCHOR_HREF, WHY_CLOCK_TEXT } from "$lib/transparency/time-transparency";

  interface Props {
    /** Called when the footer link is followed (the profile dialog closes itself). */
    onLinkClick?: () => void;
  }

  let { onLinkClick }: Props = $props();
</script>

<div class="why-content" data-testid="why-clock-content">
  <ol class="points">
    {#each WHY_CLOCK_TEXT.points as point (point.title)}
      <li>
        <strong class="point-title">{point.title}</strong>
        <span class="point-text">{point.text}</span>
      </li>
    {/each}
  </ol>
  <p class="footer">
    {WHY_CLOCK_TEXT.footerLead}<a href={READERS_ANCHOR_HREF} onclick={() => onLinkClick?.()}
      >{WHY_CLOCK_TEXT.footerLinkLabel}</a
    >{WHY_CLOCK_TEXT.footerEnd}
  </p>
</div>

<style>
  .why-content {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .points {
    margin: 0;
    padding: 0 0 0 var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .points li::marker {
    color: var(--text-2);
    font-weight: 600;
  }
  .point-title {
    display: block;
    color: var(--text);
    font-weight: 600;
  }
  .point-text {
    display: block;
    margin-top: var(--s-1);
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .footer {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .footer a {
    color: var(--brand);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
