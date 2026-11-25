<script lang="ts">
  /**
   * AppointmentHintsCallout - Issue #604 (Ich › Zeiten).
   *
   * Lists the person's own hints on probably unrecorded time: a past day whose last appointment ends
   * more than 15 minutes after the clock-out, or a day with appointments and no recorded time. The
   * server decides every hint (`GET /appointment-hints`); this component only words and offers them.
   * „Nachtragen“ hands the day to the page, which opens its own entry dialog - never prefilled with
   * the appointment times (D-13). „Stimmt so“ hides the hint permanently for that day and kind.
   * Renders nothing while the tenant switch is off or nothing is open.
   */
  import { onMount } from "svelte";
  import { format } from "date-fns";
  import { de } from "date-fns/locale";
  import { api, ApiError } from "$api/client";
  import { toasts } from "$stores/toast";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte";
  import {
    APPOINTMENT_HINT_DISMISSED_TOAST,
    APPOINTMENT_HINT_PATHS,
    APPOINTMENT_HINT_TOOLTIP,
    appointmentHintTexts,
    dismissAppointmentHint,
    type OwnAppointmentHint,
    type OwnAppointmentHintsAnswer,
  } from "$lib/time-entries/appointment-hints";

  interface Props {
    /** Opens the entry dialog of that day (the page's own `openAdd`). */
    onRecord: (date: string) => void;
  }

  let { onRecord }: Props = $props();

  let hints = $state<OwnAppointmentHint[]>([]);
  let busyKey = $state<string | null>(null);

  const keyOf = (h: OwnAppointmentHint) => `${h.date}-${h.kind}`;
  const dayLabel = (iso: string) =>
    format(new Date(iso + "T12:00:00"), "EEEEEE d.M.", { locale: de });

  async function load() {
    try {
      const answer = await api.get<OwnAppointmentHintsAnswer>(APPOINTMENT_HINT_PATHS.own);
      hints = answer.enabled ? answer.hints : [];
    } catch {
      // A hint is a help, never a requirement: a failed read shows nothing.
      hints = [];
    }
  }

  onMount(load);

  async function dismiss(hint: OwnAppointmentHint) {
    busyKey = keyOf(hint);
    try {
      await dismissAppointmentHint(api, hint);
      hints = hints.filter((h) => keyOf(h) !== keyOf(hint));
      toasts.success(APPOINTMENT_HINT_DISMISSED_TOAST);
    } catch (err) {
      toasts.error(
        err instanceof ApiError ? err.message : "Der Hinweis konnte nicht ausgeblendet werden.",
      );
      await load();
    } finally {
      busyKey = null;
    }
  }
</script>

{#if hints.length > 0}
  <div class="callout warning ah-callout" role="status" data-testid="zeiten-appointment-hints">
    <span class="ico" aria-hidden="true">⚠</span>
    <div class="ah-body">
      <p class="ah-head">
        <b>Vermutlich nicht erfasste Zeit</b>
        <InfoHint
          text={APPOINTMENT_HINT_TOOLTIP}
          label={hintLabel("Vermutlich nicht erfasste Zeit")}
          testId="zeiten-appointment-hints-info"
        />
      </p>
      <ul class="ah-list">
        {#each hints as hint (keyOf(hint))}
          {@const texts = appointmentHintTexts(hint, dayLabel(hint.date))}
          <li class="ah-row" data-testid={`zeiten-appointment-hint-${hint.date}`}>
            <div class="ah-text">
              <span class="ah-title">{texts.title}</span>
              <span class="ah-sub">{texts.subtitle}</span>
            </div>
            <div class="ah-actions">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                data-testid={`zeiten-appointment-hint-record-${hint.date}`}
                onclick={() => onRecord(hint.date)}>Nachtragen</button
              >
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={busyKey === keyOf(hint)}
                aria-label={`Stimmt so: Hinweis für ${dayLabel(hint.date)} ausblenden`}
                data-testid={`zeiten-appointment-hint-dismiss-${hint.date}`}
                onclick={() => dismiss(hint)}>Stimmt so</button
              >
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* Colour comes from the global .callout recipe (app.css) - only layout here. */
  .ah-callout {
    margin-bottom: 1rem;
  }
  .ah-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }
  .ah-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
  }
  .ah-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .ah-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }
  .ah-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    flex: 1 1 18rem;
  }
  .ah-title {
    font-weight: 600;
  }
  .ah-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
