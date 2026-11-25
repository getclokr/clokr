<!--
  Issue #604 (O-5, D-10): the Art. 13 DSGVO notice of Ich › Profil. While the tenant switch of the
  appointment comparison is on, every employee is told that appointments and recorded working time are
  compared, who sees the hint and that nothing is entered automatically. It is a legal notice, so the
  text stays visible (an info symbol would hide it). Renders nothing while the switch is off.
-->
<script lang="ts">
  import { tenantFeatures } from "$stores/tenant-features";
  import Section from "$lib/components/admin/Section.svelte";
</script>

{#if $tenantFeatures.appointmentTimeHintsEnabled}
  <Section title="Abgleich mit deinen Terminen">
    <p data-testid="settings-appointment-match-notice">
      Dein Unternehmen gleicht die Termine aus dem Terminkalender deines Salons mit deiner erfassten
      Arbeitszeit ab. Endet dein letzter Termin eines Tages mehr als 15 Minuten nach dem Ausstempeln
      oder hattest du Termine an einem Tag ohne erfasste Zeit, siehst du unter Mein Tag und Zeiten
      einen Hinweis. Den Hinweis sehen auch die Manager, die deine Zeiten sehen dürfen. Clokr trägt
      nie selbst Zeit ein und ändert dein Stundenkonto nicht. Mit „Stimmt so“ blendest du einen
      Hinweis aus; das wird mit Datum und Uhrzeit festgehalten.
    </p>
  </Section>
{/if}
