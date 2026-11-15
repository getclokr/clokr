<!--
  SmtpPanel - the „E-Mail-Versand“ tab of Verwalten › System › Integrationen (Issue #951; the mail server used to
  sit on Regeln › Benachrichtigungen & E-Mail, but it is technical setup, not a rule). Registry section
  `benachrichtigungen-smtp`; it keeps the permission alternatives of the System page it came from (D-854-05).

  Loads `GET /settings/smtp` the first time the tab is shown and hands it to `SmtpSection`, which keeps its own
  snapshot and sends only its seven keys. The warning „E-Mail aktiv, SMTP nicht eingerichtet“ (Issue #847) is
  decided by the one rule `mailWithoutDelivery()` from the server's `deliveryReady` and the STORED master
  switch; a source that could not be read never warns. The unsaved count is registered once, gated on the
  baseline having been taken.

  Props:
    active - true while the tab is the selected one
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$api/client";
  import { markUnsaved } from "$stores/unsaved";
  import { mailWithoutDelivery } from "$lib/admin/setup-checks";
  import type { SecurityEmailConfig, SmtpConfig } from "$lib/settings/benachrichtigungen";
  import SmtpSection from "$lib/components/admin/integrationen/SmtpSection.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  let smtp = $state<SmtpConfig | null>(null);
  let loading = $state(false);
  let loadError = $state("");
  let deliveryReady = $state<boolean | null>(null);
  let emailEnabled = $state<boolean | undefined>(undefined);
  let changes = $state(0);

  const mailWarning = $derived(
    mailWithoutDelivery(
      { emailNotificationsEnabled: emailEnabled },
      deliveryReady === null ? null : { deliveryReady },
    ),
  );

  async function load() {
    loading = true;
    try {
      const config = await api.get<SmtpConfig>("/settings/smtp");
      deliveryReady = config.deliveryReady ?? null;
      smtp = config;
    } catch (err) {
      loadError =
        err instanceof Error ? err.message : "Diese Einstellungen konnten nicht geladen werden.";
    } finally {
      loading = false;
    }
    // The master switch only decides the warning; a refused read just means no warning.
    emailEnabled = (await api.get<SecurityEmailConfig>("/settings/security").catch(() => null))
      ?.emailNotificationsEnabled;
  }

  /** Re-read after a save: the warning follows the server's answer, not the typed form. */
  async function refreshDelivery() {
    deliveryReady =
      (await api.get<SmtpConfig>("/settings/smtp").catch(() => null))?.deliveryReady ??
      deliveryReady;
  }

  // Lazy load on the first visit of the tab.
  let started = false;
  $effect(() => {
    if (!active || started) return;
    started = true;
    untrack(() => void load());
  });

  // Gated on "a baseline has been taken": a load that failed must not arm the navigation guard.
  const snapshotsReady = $derived(smtp !== null);
  $effect(() => {
    markUnsaved("integrationen-email", snapshotsReady && changes > 0);
    return () => markUnsaved("integrationen-email", false);
  });
</script>

{#if loadError}
  <div role="alert"><Note tone="bad">{loadError}</Note></div>
{:else if loading || smtp === null}
  <Skeleton shape="card" lines={4} />
{:else}
  <SmtpSection config={smtp} bind:changes {mailWarning} onSaved={refreshDelivery} />
{/if}
