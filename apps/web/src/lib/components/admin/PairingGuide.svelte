<!--
  PairingGuide - the admin's setup help for coupling staff phones to the salon WLAN by QR code
  (Issue #610, D-13 revised, AC-1, AC-6, P-610-22).

  The admin types the LAN address and the pairing port of the FRITZ!Box adapter; the page builds
  http://<ip>:<port>/koppeln from it and draws a printable QR code. Everything happens in the
  browser: the address is local component state, it is neither stored nor sent anywhere, and this
  component imports no API client and no router. The QR is ONE own <path> inside an <svg> (the
  matrix comes from $lib/presence/qr-svg.ts); no markup string is injected.
-->
<script lang="ts">
  import {
    DEFAULT_PAIRING_PORT,
    pairingUrlFor,
    pairingUrlMessage,
  } from "$lib/presence/pairing-url";
  import { qrPathFor } from "$lib/presence/qr-svg";
  import FormField from "$components/ui/FormField.svelte";
  import InfoHint, { hintLabel } from "$components/ui/InfoHint.svelte"; // Issue #1058

  // Issue #994 (N-16, D-994-07): the technical reasons behind the four plain conditions sit behind the
  // info symbol beside the checklist title.
  const WHY_TEXT = [
    "Offene Netze: Ein iPhone wechselt dort seine private WLAN-Adresse, die Kopplung hält nicht, und der Code ließe sich mitlesen. Nötig ist WPA2 oder WPA3.",
    "Ein Gast-WLAN mit Geräteisolation lässt das Handy den Adapter nicht erreichen.",
    "Am Adapter muss die Kopplung eingeschaltet, die https-Adresse deiner Clokr-Installation hinterlegt und der Kopplungs-Port unter seiner LAN-Adresse im Salon-WLAN freigegeben sein.",
  ];

  let address = $state("");
  let port = $state(DEFAULT_PAIRING_PORT);

  const result = $derived(pairingUrlFor(address, port));
  // No address typed yet: neither a QR nor an error.
  const touched = $derived(address.trim() !== "");
  const qr = $derived(result.ok ? qrPathFor(result.url) : null);
  const refusal = $derived(touched && !result.ok ? result.reason : null);
  const addressMessage = $derived(
    refusal && refusal !== "INVALID_PORT" ? pairingUrlMessage(refusal) : "",
  );
  const portMessage = $derived(refusal === "INVALID_PORT" ? pairingUrlMessage(refusal) : "");
</script>

<div class="pairing-guide">
  <div class="pairing-fields">
    <FormField label="Adresse des Adapters im Salon-WLAN" error={addressMessage || undefined}>
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          class="form-input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="z. B. 192.168.178.20"
          bind:value={address}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
        />
      {/snippet}
    </FormField>
    <FormField label="Port" error={portMessage || undefined}>
      {#snippet field({ id, describedBy, invalid })}
        <input
          {id}
          class="form-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          bind:value={port}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
        />
      {/snippet}
    </FormField>
  </div>
  <p class="pairing-hint">
    Die Adresse wird nicht gespeichert und nirgendwohin gesendet. Der Code entsteht nur in diesem
    Browser.
  </p>

  {#if result.ok && qr}
    <div class="pairing-sheet">
      <svg
        class="pairing-qr"
        viewBox="0 0 {qr.size} {qr.size}"
        shape-rendering="crispEdges"
        role="img"
        aria-label="QR-Code für {result.url}"
      >
        <rect width={qr.size} height={qr.size} fill="#ffffff" />
        <path d={qr.d} fill="#000000" />
      </svg>
      <p class="pairing-url">{result.url}</p>
      <p class="pairing-instruction">
        Scanne den Code mit der Handy-Kamera, während du mit dem Salon-WLAN verbunden bist, und
        tippe auf „Das ist mein Handy – koppeln“.
      </p>
    </div>
    <div class="pairing-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick={() => window.print()}>
        QR-Code drucken
      </button>
    </div>
  {/if}

  <div class="pairing-checklist">
    <div class="hint-row">
      <div class="pairing-checklist-title">Das muss stimmen, bevor du den Code aushängst</div>
      <InfoHint
        text={WHY_TEXT}
        label={hintLabel("Das muss stimmen, bevor du den Code aushängst")}
        testId="pairing-checklist-why"
      />
    </div>
    <ul>
      <li>Das Salon-WLAN ist mit einem Passwort geschützt.</li>
      <li>Du hängst den Code im WLAN deines Teams aus, nicht im Gast-WLAN.</li>
      <li>
        Der Adapter ist für die Kopplung eingerichtet – das erledigt, wer ihn eingerichtet hat
        (Anleitung „WLAN-Kopplung per QR-Code“).
      </li>
      <li>Das Handy ist beim Scannen mit dem Salon-WLAN verbunden, nicht über Mobilfunk.</li>
    </ul>
  </div>
</div>

<style>
  .pairing-guide {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }

  .pairing-fields {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
    gap: var(--s-3);
  }

  @media (max-width: 640px) {
    .pairing-fields {
      grid-template-columns: 1fr;
    }
  }

  .pairing-hint {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .pairing-sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    /* A QR code must be dark on light in every theme, so the sheet does not follow the tokens. */
    background: #ffffff;
    color: #000000;
    max-width: 22rem;
  }

  .pairing-qr {
    width: 100%;
    height: auto;
    max-width: 18rem;
  }

  .pairing-url {
    margin: 0;
    font-family: var(--font-code);
    font-size: 0.875rem;
    word-break: break-all;
    text-align: center;
  }

  .pairing-instruction {
    margin: 0;
    font-size: 0.875rem;
    text-align: center;
  }

  .pairing-actions {
    display: flex;
    gap: var(--s-2);
  }

  .pairing-checklist .hint-row {
    margin-bottom: var(--s-2);
  }

  .pairing-checklist-title {
    font-weight: 600;
    color: var(--text);
  }

  .pairing-checklist ul {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    color: var(--text);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  /* Print: only the sheet (QR, URL, instruction) ends up on paper. */
  @media print {
    :global(body *) {
      visibility: hidden;
    }
    .pairing-sheet,
    .pairing-sheet :global(*) {
      visibility: visible;
    }
    .pairing-sheet {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      max-width: none;
      margin: 0 auto;
      border: none;
    }
    .pairing-qr {
      max-width: 14cm;
    }
    .pairing-url {
      font-size: 14pt;
    }
    .pairing-instruction {
      font-size: 14pt;
    }
  }
</style>
