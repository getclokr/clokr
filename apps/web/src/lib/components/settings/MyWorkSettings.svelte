<script lang="ts">
  // Issue #602 (Phase 851, prototype „Meine Arbeit“): the own working conditions, read-only - the
  // Stammsalon from the own salon context (#82), the contract valid today from the own employee row
  // (GET /employees/:id, own data) with the one model wording of contract-history.ts (#574), and the
  // yearly vacation entitlement from GET /leave/entitlements (the facade of #451). Nothing is
  // editable here; the Salonleitung changes it.
  import { onMount } from "svelte";
  import { api } from "$api/client";
  import { authStore } from "$stores/auth";
  import { salonContext } from "$stores/salon-context";
  import { tenantFeatures } from "$stores/tenant-features";
  import { tenantDay, tenantYear } from "$lib/utils/tenant-day";
  import Section from "$lib/components/admin/Section.svelte";
  import Skeleton from "$components/ui/Skeleton.svelte";
  import { contractHistoryRows, MODEL_LABELS } from "$lib/employees/contract-history";
  import { mapVacationBalance, type VacationEntitlementRow } from "$lib/leave/vacation-balance";
  import { formatDays } from "$lib/leave/review-facts";

  interface OwnSchedule {
    id: string;
    type: string;
    validFrom: string;
    weeklyHours?: string | number | null;
    monthlyHours?: string | number | null;
    contractWorkDaysPerWeek?: number | null;
    workDays?: number[];
  }

  interface OwnEmployee {
    hireDate?: string;
    exitDate?: string | null;
    /** The contract valid today (GET /employees/:id answers the newest row as `workSchedule`). */
    workSchedule?: OwnSchedule | null;
  }

  const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  let loading = $state(true);
  let schedule = $state<OwnSchedule | null>(null);
  let annualDays = $state<number | null>(null);
  let year = $state<number | null>(null);
  /** Issue #991 (N-25): the calendar day of a join / exit that falls inside the shown year. */
  let joinDay = $state<string | null>(null);
  let exitDay = $state<string | null>(null);

  const homeSalon = $derived.by(() => {
    const id = $salonContext.homeSalonId;
    if (!id) return null;
    return $salonContext.salons.find((s) => s.id === id)?.name ?? null;
  });

  const contract = $derived(schedule ? contractHistoryRows([schedule])[0] : null);

  /** „1.10.“ from a `YYYY-MM-DD` day (Ich area: no leading zeros, Issue #991). */
  function shortDay(iso: string): string {
    const [, m, d] = iso.split("-");
    return `${Number(d)}.${Number(m)}.`;
  }

  /** „1.10.2026“ from a `YYYY-MM-DD` day. */
  function longDay(iso: string): string {
    return `${shortDay(iso)}${iso.slice(0, 4)}`;
  }

  /**
   * Issue #991 (N-25): the figure is the pro-rated entitlement of the year, so it is labelled with the
   * year and says when it is pro rata: „6 Tage (anteilig ab 1.10.)“, „20 Tage (anteilig bis 30.9.)“.
   */
  const annualLabel = $derived.by(() => {
    if (annualDays === null) return "–";
    const count = `${formatDays(annualDays)} ${annualDays === 1 ? "Tag" : "Tage"}`;
    if (joinDay && exitDay)
      return `${count} (anteilig ab ${shortDay(joinDay)} bis ${shortDay(exitDay)})`;
    if (joinDay) return `${count} (anteilig ab ${shortDay(joinDay)})`;
    if (exitDay) return `${count} (anteilig bis ${shortDay(exitDay)})`;
    return count;
  });

  /** „Di – Fr“ for a contiguous set, else „Mo, Mi, Fr“; for a shift contract the roster decides. */
  const workDaysLabel = $derived.by(() => {
    if (!schedule) return "–";
    if (schedule.type === "SHIFT_BASED") return "nach Dienstplan";
    const days = [...(schedule.workDays ?? [])].map((d) => (d + 6) % 7).sort((a, b) => a - b);
    if (days.length === 0) return "–";
    const names = days.map((d) => DAY_SHORT[(d + 1) % 7]);
    const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    return contiguous && days.length > 2
      ? `${names[0]} – ${names[names.length - 1]}`
      : names.join(", ");
  });

  onMount(async () => {
    const id = $authStore.user?.employeeId;
    if (!id) {
      loading = false;
      return;
    }
    try {
      // The entitlement year is the tenant's (Issue #1072): wait for the zone first.
      const zone = await tenantFeatures.loadTimezone();
      const thisYear = tenantYear(new Date(), zone);
      const [me, ent] = await Promise.all([
        api.get<OwnEmployee>(`/employees/${id}`).catch(() => null),
        api
          .get<VacationEntitlementRow[]>(`/leave/entitlements/${id}?year=${thisYear}`)
          .catch(() => [] as VacationEntitlementRow[]),
      ]);
      schedule = me?.workSchedule ?? null;
      year = thisYear;
      const hired = me?.hireDate ? tenantDay(new Date(me.hireDate), zone) : null;
      const left = me?.exitDate ? tenantDay(new Date(me.exitDate), zone) : null;
      joinDay =
        hired && hired.startsWith(`${thisYear}-`) && hired > `${thisYear}-01-01` ? hired : null;
      exitDay = left && left.startsWith(`${thisYear}-`) && left < `${thisYear}-12-31` ? left : null;
      annualDays = mapVacationBalance(ent.find((e) => e.typeCode === "VACATION"))?.total ?? null;
    } finally {
      loading = false;
    }
  });
</script>

<Section title="Meine Arbeit" hint="Ändern kann das deine Salonleitung.">
  {#if loading}
    <Skeleton shape="block" height="96px" />
  {:else}
    <dl class="kv" data-testid="my-work">
      <div>
        <dt>Stammsalon</dt>
        <dd>{homeSalon ?? "–"}</dd>
      </div>
      <div>
        <dt>Arbeitszeitmodell</dt>
        <dd>{schedule ? (MODEL_LABELS[schedule.type] ?? "–") : "–"}</dd>
      </div>
      <div>
        <dt>Umfang</dt>
        <dd>{contract?.extent ?? "–"}</dd>
      </div>
      <div>
        <dt>Arbeitstage</dt>
        <dd>{workDaysLabel}</dd>
      </div>
      <div>
        <dt>Urlaubsanspruch{year ? ` ${year}` : ""}</dt>
        <dd>{annualLabel}</dd>
      </div>
      <div>
        <dt>Gilt</dt>
        <dd>{contract ? `seit ${longDay(contract.startDay)}` : "–"}</dd>
      </div>
    </dl>
  {/if}
</Section>

<style>
  .kv {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--s-4);
  }
  .kv dt {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .kv dd {
    margin: var(--s-1) 0 0;
    font-weight: 500;
    color: var(--text);
  }
</style>
