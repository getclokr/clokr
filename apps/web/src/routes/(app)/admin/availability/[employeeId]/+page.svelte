<script lang="ts">
  import { pageLabel } from "$lib/nav/page-labels";
  // Phase 260523-0qf, Task 3 — per-employee availability detail page.
  // Accessed via /admin/availability/[employeeId].
  //
  // ADMIN + MANAGER only (server enforces 403).
  //
  // F-21 fix: 410 + AVAILABILITY_FEATURE_DISABLED is detected and shown as
  // an actionable empty state instead of silently swallowed. The backend 410
  // is CORRECT (Phase 47.3 feature toggle) — this is a UX bug on the web side.
  //
  // Issue #992 (N-13, D-992-22): the markup is the shape of the own page (Ich › Dienstplan ›
  // Verfügbarkeit) — page head with the person's name, a Note, the two blocks, the SaveBar; the
  // person is named in the top-bar crumb. The script logic (snapshot, registry, save) is unchanged.

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api, ApiError } from "$api/client";
  import { tenantFeatures } from "$stores/tenant-features";
  import { tenantDay } from "$lib/utils/tenant-day";
  import { authStore } from "$stores/auth";
  import { toasts } from "$stores/toast";
  import { markUnsaved } from "$stores/unsaved";
  import { showDetailCrumb } from "$lib/nav/detail-crumb";
  import PageHead from "$lib/components/layout/PageHead.svelte";
  import EmptyState from "$components/ui/EmptyState.svelte";
  import ErrorState from "$components/ui/ErrorState.svelte";
  import Note from "$components/ui/Note.svelte";
  import SaveBar from "$components/ui/SaveBar.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import { hasPermission } from "$lib/permissions";
  import AvailabilityWeekGrid, {
    type RecurringEntry,
  } from "$lib/components/availability/AvailabilityWeekGrid.svelte";
  import AvailabilityOneOffList, {
    type OneOffEntry,
  } from "$lib/components/availability/AvailabilityOneOffList.svelte";

  type Status = "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";

  interface Employee {
    id: string;
    firstName: string;
    lastName: string;
  }

  interface ApiAvailabilityEntry {
    id: string;
    employeeId: string;
    dayOfWeek: number | null;
    date: string | null;
    status: Status;
    note: string | null;
    validFrom: string;
    validUntil: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  }

  interface AvailabilityListResponse {
    entries: ApiAvailabilityEntry[];
  }

  // The tenant's calendar day (Issue #1072), the day the server files a stamp under.
  function todayISO(): string {
    return tenantDay(new Date(), $tenantFeatures.timezone);
  }

  const employeeId = $derived(page.params.employeeId);

  let employee = $state<Employee | null>(null);
  let recurringEntries = $state<RecurringEntry[]>([]);
  let oneOffEntries = $state<OneOffEntry[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let loadError = $state("");
  let featureDisabled = $state(false);
  let lastSnapshot = $state("");

  // WR-01 (109-REVIEW-FIX.md): `lastSnapshot` is assigned in exactly one place — the last
  // statement of applyEntries() — and onMount has paths that never reach it (a rejected employee
  // request returns early; a rejected availability request that is not a 410 falls through).
  // Without this flag `lastSnapshot` stays "" while `currentSnapshot` is `{"r":[],"o":[]}`, so
  // `dirty` reads true on a page that shows nothing but an error: the Speichern button is enabled
  // and would PUT an empty entries array. Setting the flag AT the single baseline site rather
  // than "at the end of onMount's try" is deliberate — this onMount has several exits, and a
  // trailing assignment would have to be duplicated into each of them correctly.
  let snapshotsReady = $state(false);

  const currentSnapshot = $derived(JSON.stringify({ r: recurringEntries, o: oneOffEntries }));

  const dirty = $derived(
    snapshotsReady && !loading && !featureDisabled && currentSnapshot !== lastSnapshot,
  );

  // Phase 109 (D-12) — one registry entry per PAGE. `dirty` already carries the WR-01 gate, so the
  // registration reads it directly rather than repeating `snapshotsReady &&` here.
  $effect(() => {
    markUnsaved("admin-availability-detail", dirty);
    return () => markUnsaved("admin-availability-detail", false);
  });

  // Issue #992 (D-992-22): the SaveBar shows one change while the page is dirty; the registry above
  // reads the same `dirty`, so the bar and the unsaved-changes guard never disagree.
  const changes = $derived(dirty ? 1 : 0);

  // The top bar names the person (the trail itself comes from the route table); cleared on leaving.
  $effect(() => showDetailCrumb(employee ? `${employee.firstName} ${employee.lastName}` : null));

  /** Verwerfen: back to the last saved state. */
  function discard(): void {
    const saved = JSON.parse(lastSnapshot) as { r: RecurringEntry[]; o: OneOffEntry[] };
    recurringEntries = saved.r;
    oneOffEntries = saved.o;
  }

  // The switch lives in Verwalten › Regeln › Dienstplan (section Verfügbarkeiten); offered only to
  // whoever may change it.
  const mayChangeSettings = $derived(hasPermission($authStore.user, "tenant-settings:update"));

  function applyEntries(entries: ApiAvailabilityEntry[]): void {
    const recurring: RecurringEntry[] = [];
    const oneoff: OneOffEntry[] = [];
    for (const e of entries) {
      if (e.dayOfWeek != null) {
        recurring.push({
          id: e.id,
          dayOfWeek: e.dayOfWeek,
          status: e.status,
          note: e.note,
          validFrom: e.validFrom?.slice(0, 10) ?? todayISO(),
          validUntil: e.validUntil ? e.validUntil.slice(0, 10) : null,
        });
      } else if (e.date != null) {
        oneoff.push({
          id: e.id,
          date: e.date.slice(0, 10),
          status: e.status,
          note: e.note,
          validFrom: e.validFrom?.slice(0, 10) ?? todayISO(),
          validUntil: e.validUntil ? e.validUntil.slice(0, 10) : null,
        });
      }
    }
    recurringEntries = recurring;
    oneOffEntries = oneoff;
    lastSnapshot = JSON.stringify({ r: recurringEntries, o: oneOffEntries });
    snapshotsReady = true;
  }

  function buildPayload() {
    const recurring = recurringEntries.map((e) => ({
      dayOfWeek: e.dayOfWeek,
      date: null,
      status: e.status,
      note: e.note ?? null,
      validFrom: e.validFrom ?? todayISO(),
      validUntil: e.validUntil ?? null,
    }));
    const oneoff = oneOffEntries.map((e) => ({
      dayOfWeek: null,
      date: e.date,
      status: e.status,
      note: e.note ?? null,
      validFrom: e.validFrom ?? todayISO(),
      validUntil: e.validUntil ?? null,
    }));
    return { entries: [...recurring, ...oneoff] };
  }

  async function save(): Promise<void> {
    if (saving || featureDisabled) return;
    saving = true;
    try {
      const res = await api.put<AvailabilityListResponse>(
        `/employees/${employeeId}/availability`,
        buildPayload(),
      );
      applyEntries(res.entries ?? []);
      toasts.success("Verfügbarkeit gespeichert.");
    } catch (err) {
      const fallback = "Die Verfügbarkeit konnte nicht gespeichert werden. Bitte erneut versuchen.";
      const msg = err instanceof ApiError && err.status < 500 ? err.message : fallback;
      toasts.error(msg);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    // Issue #83 (D-13): access is decided by the admin layout guard; the API answers 403 regardless.
    void loadPerson();
  });

  async function loadPerson(): Promise<void> {
    loading = true;
    loadError = "";
    const [empRes, avRes] = await Promise.allSettled([
      api.get<Employee>(`/employees/${employeeId}`),
      api.get<AvailabilityListResponse>(`/employees/${employeeId}/availability`),
    ]);
    // An entry without a start day falls back to the tenant's today (Issue #1072): the zone is
    // known before the entries are mapped.
    await tenantFeatures.loadTimezone();

    if (empRes.status === "fulfilled") {
      employee = empRes.value;
    } else {
      const err = empRes.reason as ApiError;
      loadError = err instanceof ApiError ? err.message : "Die Person konnte nicht geladen werden.";
      loading = false;
      return;
    }

    if (avRes.status === "rejected") {
      const err = avRes.reason as { status?: number; data?: { code?: string } };
      if (err?.status === 410 && err?.data?.code === "AVAILABILITY_FEATURE_DISABLED") {
        featureDisabled = true;
        tenantFeatures.applyLocal(false);
      }
      // For any other rejection: availabilityData stays empty — show generic error
      // only if employee itself failed to load (handled above via loadError).
    } else {
      applyEntries(avRes.value.entries ?? []);
    }

    loading = false;
  }
</script>

<PageHead
  title={employee ? `${employee.firstName} ${employee.lastName}` : pageLabel("/admin/availability")}
  hint="Wann kann die Person arbeiten? Urlaub und Abwesenheiten werden automatisch berücksichtigt."
/>

{#if loading}
  <Skeleton shape="card" lines={3} />
{:else if loadError}
  <ErrorState message={loadError} hint="" onRetry={() => void loadPerson()} />
{:else if featureDisabled}
  <EmptyState
    icon="calendar"
    title="Die Verfügbarkeit ist für dein Unternehmen ausgeschaltet."
    description="Solange sie aus ist, können Personen keine Verfügbarkeit angeben und der Dienstplan wertet keine aus."
    actionLabel={mayChangeSettings ? "Zu den Einstellungen" : undefined}
    onaction={mayChangeSettings ? () => void goto("/verwalten/regeln/dienstplan") : undefined}
  />
{:else}
  <div class="page">
    <Note tone="info">
      Urlaub und Abwesenheiten erscheinen automatisch als „nicht verfügbar“. Du änderst sie an ihrer
      Quelle.
    </Note>

    <section class="settings-group">
      <h2 class="settings-group-title">Wochenraster</h2>
      <AvailabilityWeekGrid bind:entries={recurringEntries} disabled={loading} />
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">Einmaltermine</h2>
      <AvailabilityOneOffList bind:entries={oneOffEntries} disabled={loading} />
    </section>
  </div>
{/if}

<SaveBar
  {changes}
  errors={0}
  {saving}
  saveLabel="Verfügbarkeit speichern"
  onSave={save}
  onDiscard={discard}
/>
