<!--
  Verwalten › Regeln › Benachrichtigungen & E-Mail (Issue #854, D-854-03): the e-mail notification switches
  and the reminder settings of the company. The sections were moved here from the System page (Kommunikation)
  and the Urlaub page (Erinnerungen) - every setting lives exactly once (lib/settings/settings-pages.ts). The
  shift reminders are not here, they belong to the roster settings. The mail server is technical setup and
  lives under System › Integrationen › E-Mail-Versand (Issue #951); this page only reads whether mail can be
  delivered, to show the one warning of Issue #847 with a link there, and sends the old anchor
  `#mailserver` on to the new place.

  The sections read different endpoints, so the page loads each one only when the person may open the section
  that needs it (D-854-05: a section keeps the permission alternatives of the page it came from). A section whose data could not be loaded shows that instead of an editable form with made-up
  defaults: saving those would overwrite the stored values. Each section keeps its own snapshot and sends
  only its own fields (#878).
-->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { markUnsaved } from "$stores/unsaved";
  import { mailWithoutDelivery } from "$lib/admin/setup-checks"; // Issue #847
  import { pageLabel } from "$lib/nav/page-labels";
  import { mayOpenSection, settingsSection } from "$lib/settings/settings-pages";
  import type {
    ReminderConfig,
    SecurityEmailConfig,
    SmtpConfig,
  } from "$lib/settings/benachrichtigungen";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import Note from "$components/ui/Note.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import EmailSection from "$lib/components/admin/benachrichtigungen/EmailSection.svelte";
  import RemindersSection from "$lib/components/admin/benachrichtigungen/RemindersSection.svelte";

  const LOAD_ERROR = "Diese Einstellungen konnten nicht geladen werden.";

  /** One endpoint of the page: not asked yet, loading, loaded or failed. */
  type Loaded<T> =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: T }
    | { status: "failed"; message: string };

  let security = $state<Loaded<SecurityEmailConfig>>({ status: "idle" });
  let work = $state<Loaded<ReminderConfig>>({ status: "idle" });

  // Issue #847: whether mail can be sent (the server's `deliveryReady`) and the STORED master switch decide
  // the one warning „E-Mail aktiv, SMTP nicht eingerichtet“ - both sections show it, the rule is the shared
  // `mailWithoutDelivery()`. A source that was not read (no permission, load failed) never warns.
  let deliveryReady = $state<boolean | null>(null);
  let emailEnabled = $state<boolean | undefined>(undefined);
  const mailWarning = $derived(
    mailWithoutDelivery(
      { emailNotificationsEnabled: emailEnabled },
      deliveryReady === null ? null : { deliveryReady },
    ),
  );

  const user = $derived($authStore.user);
  const show = $derived({
    // The mail server itself lives under System › Integrationen; only its delivery answer is read here.
    smtp: mayOpenSection(user, settingsSection("benachrichtigungen-smtp")),
    email: mayOpenSection(user, settingsSection("benachrichtigungen-email")),
    erinnerungen: mayOpenSection(user, settingsSection("benachrichtigungen-erinnerungen")),
  });

  async function load<T>(path: string, set: (next: Loaded<T>) => void) {
    set({ status: "loading" });
    try {
      set({ status: "ready", data: await api.get<T>(path) });
    } catch (err) {
      set({ status: "failed", message: err instanceof Error ? err.message : LOAD_ERROR });
    }
  }

  // Each endpoint is asked once, as soon as the person is known to be allowed to open its section.
  let smtpAsked = false;
  $effect(() => {
    if (show.smtp && !smtpAsked) {
      smtpAsked = true;
      void api
        .get<SmtpConfig>("/settings/smtp")
        .then((config) => (deliveryReady = config.deliveryReady ?? null))
        .catch(() => undefined);
    }
  });

  // Issue #951: the mail server moved to System › Integrationen; an old link to its anchor follows it (only for
  // a person who may open it there - everyone else stays on this page).
  onMount(() => {
    if (page.url.hash === "#mailserver" && untrack(() => show.smtp)) {
      void goto("/verwalten/system/integrationen#email", { replace: true });
    }
  });
  $effect(() => {
    if (show.email && untrack(() => security.status) === "idle") {
      void load<SecurityEmailConfig>("/settings/security", (next) => {
        security = next;
        if (next.status === "ready") emailEnabled = next.data.emailNotificationsEnabled ?? false;
      });
    }
  });
  $effect(() => {
    if (show.erinnerungen && untrack(() => work.status) === "idle") {
      void load<ReminderConfig>("/settings/work", (next) => (work = next));
    }
  });

  // The unsaved counts of the sections, summed into ONE registration (a second registration under the
  // same id would let one section's cleanup disarm the others).
  const changes = $state({ email: 0, erinnerungen: 0 });
  const totalChanges = $derived(changes.email + changes.erinnerungen);

  // Gated on "a baseline has been taken": only a loaded section can have unsaved changes, and a page
  // that shows nothing but errors must not arm the navigation guard.
  const snapshotsReady = $derived(security.status === "ready" || work.status === "ready");

  $effect(() => {
    markUnsaved("regeln-benachrichtigungen", snapshotsReady && totalChanges > 0);
    return () => markUnsaved("regeln-benachrichtigungen", false);
  });

  const loading = $derived(
    (show.email && (security.status === "idle" || security.status === "loading")) ||
      (show.erinnerungen && (work.status === "idle" || work.status === "loading")),
  );
</script>

<svelte:head>
  <title>{pageLabel("/verwalten/regeln/benachrichtigungen")} – Clokr</title>
</svelte:head>

<PageHead
  title={pageLabel("/verwalten/regeln/benachrichtigungen")}
  sub="Hier legst du fest, worüber Clokr per E-Mail benachrichtigt und woran es erinnert. Den Mailserver richtest du unter System › Integrationen ein."
/>

{#if loading}
  <Skeleton shape="card" lines={4} />
{/if}

{#if show.email}
  {#if security.status === "ready"}
    <EmailSection
      config={security.data}
      bind:changes={changes.email}
      {mailWarning}
      onSaved={(enabled) => (emailEnabled = enabled)}
    />
  {:else if security.status === "failed"}
    <div role="alert"><Note tone="bad">{LOAD_ERROR} (E-Mail-Benachrichtigungen)</Note></div>
  {/if}
{/if}
{#if show.erinnerungen}
  {#if work.status === "ready"}
    <RemindersSection config={work.data} bind:changes={changes.erinnerungen} />
  {:else if work.status === "failed"}
    <div role="alert"><Note tone="bad">{LOAD_ERROR} (Erinnerungen)</Note></div>
  {/if}
{/if}
