<script lang="ts">
  // Issue #606: „Warum stempeln?“ on Mein Tag - a non-modal card below the Kennzahlen, shown from the
  // person's first sign-in until they press „Verstanden“ or „Überspringen“. The seen state lives on the
  // server (`$stores/why-clock-intro`, never browser storage), so a second device never shows it again.
  // It stays out of the way: it needs the known seen state (never before hydration), a person who can
  // clock for themself and is not § 18 ArbZG exempt, and the page's own data (`ready`).
  import { authStore } from "$stores/auth";
  import { toasts } from "$stores/toast";
  import { hasPermission } from "$lib/permissions";
  import { dismissWhyClockIntro, whyClockIntroSeen } from "$stores/why-clock-intro";
  import { whyClockIntroHidden } from "$lib/feedback/action-messages";
  import { WHY_CLOCK_TEXT } from "$lib/transparency/time-transparency";
  import Card from "$components/ui/Card.svelte";
  import WhyClockIntroContent from "./WhyClockIntroContent.svelte";

  interface Props {
    /** § 18 ArbZG exempt persons have no clock, so the intro does not apply. */
    exempt: boolean;
    /** The page's own employee load has answered (the exemption is known). */
    ready: boolean;
    /** Called after the intro was closed (the page moves focus on). */
    onDismissed?: () => void;
  }

  let { exempt, ready, onDismissed }: Props = $props();

  let busy = $state(false);

  const visible = $derived(
    ready &&
      !exempt &&
      $whyClockIntroSeen === false &&
      hasPermission($authStore.user, "time-entry:create:EIGENE"),
  );

  async function close() {
    if (busy) return;
    busy = true;
    try {
      await dismissWhyClockIntro();
      toasts.success(whyClockIntroHidden());
    } catch {
      // Nothing was stored: the card stays hidden for this visit and comes back at the next sign-in.
      toasts.error(WHY_CLOCK_TEXT.dismissFailed);
    } finally {
      busy = false;
      onDismissed?.();
    }
  }
</script>

{#if visible}
  <Card animate style="--card-idx: 1;">
    <div class="why-wrap" data-testid="why-clock-intro">
      <h2 class="why-title">{WHY_CLOCK_TEXT.title}</h2>
      <WhyClockIntroContent />
      <div class="why-actions">
        <button type="button" class="btn btn-primary btn-sm" disabled={busy} onclick={close}
          >{WHY_CLOCK_TEXT.understood}</button
        >
        <button type="button" class="btn btn-secondary btn-sm" disabled={busy} onclick={close}
          >{WHY_CLOCK_TEXT.skip}</button
        >
      </div>
    </div>
  </Card>
{/if}

<style>
  .why-wrap {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .why-title {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
    color: var(--text);
  }
  .why-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  /* Under 760 px of card width (the block breakpoint) the two buttons stack, never overflow. */
  @container (max-width: 759.98px) {
    .why-actions {
      flex-direction: column;
    }
    .why-actions :global(.btn) {
      width: 100%;
    }
  }
</style>
