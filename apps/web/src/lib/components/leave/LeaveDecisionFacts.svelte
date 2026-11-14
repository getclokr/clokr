<script lang="ts">
  /**
   * LeaveDecisionFacts - the facts of a leave decision as one definition list (Issue #853 D-853-08,
   * moved out of LeaveReviewDialog for Issue #941). The review dialog and the compact approve
   * confirmation of a task row render this one component, so the figures a decision is taken on
   * (person, type, period, scope, Stammsalon, Resturlaub before -> after, shifts in the period) are
   * read and worded in exactly one place.
   *
   * Each optional fact is read only behind its own flag AND only when the API answers; a refusal or
   * a network error omits the line silently. No balance is computed here: the Resturlaub figure is
   * the vacation facade's (`GET /leave/entitlements`, `deriveVacationSummary`), and
   * `vacationBeforeAfter` only subtracts the request's own days for the display.
   *
   * Like LeaveReviewDialog this file imports no auth store (it must stay mountable in vitest); the
   * flags come in as props.
   */
  import { api } from "$api/client";
  import { salonContext, showSalonOptions } from "$stores/salon-context"; // salon names, one module (#82)
  import { LEAVE_TYPE_OPTIONS, type CalendarTypeCode } from "$lib/leave/team-calendar-visibility";
  import { leaveDaysLabel } from "$lib/leave/leave-days-label"; // Issue #595 (D-04)
  import type { LeaveReviewRequest } from "$lib/leave/leave-review";
  import {
    NO_SHIFTS_TEXT,
    shiftLines,
    vacationBeforeAfter,
    type RangeShift,
  } from "$lib/leave/review-facts";
  import { mapVacationBalance, type VacationEntitlementRow } from "$lib/leave/vacation-balance";
  import { deriveVacationSummary } from "$lib/leave/vacation-summary";
  import { homeSalonIdOn, type SalonAssignment } from "$lib/employees/salon-assignments";

  interface Props {
    /** The request the facts describe. */
    request: LeaveReviewRequest;
    /** Whether the facts are wanted now (the surrounding dialog is open). */
    active: boolean;
    canReadEntitlement?: boolean;
    canReadShifts?: boolean;
    canReadEmployee?: boolean;
    /** `data-testid` of the list. */
    testId?: string;
  }

  let {
    request,
    active,
    canReadEntitlement = false,
    canReadShifts = false,
    canReadEmployee = false,
    testId,
  }: Props = $props();

  // `null` = not shown (flag off, not loaded yet, or the read was refused).
  let homeSalonId = $state<string | null>(null);
  // The name comes from the salon context store (the only module that reads /me/context, #82),
  // gated by its one rule `showSalonOptions` (#64): a salon outside the caller's reach is not in
  // its list, so the line is omitted for it.
  let homeSalonName = $derived(
    showSalonOptions($salonContext)
      ? ($salonContext.salons.find((x) => x.id === homeSalonId)?.name ?? null)
      : null,
  );
  let vacationFact = $state<{ label: string; value: string } | null>(null);
  let shiftFactLines = $state<string[] | null>(null);
  // The request the facts belong to; a late answer for another request is discarded (T-853-15).
  let factsFor: string | null = null;

  $effect(() => {
    homeSalonId = null;
    vacationFact = null;
    shiftFactLines = null;
    if (!active) {
      factsFor = null;
      return;
    }
    const rid = request.id;
    const employeeId = request.employeeId;
    const startDate = request.startDate;
    const endDate = request.endDate;
    const status = request.status;
    const days = Number(request.days);
    const isVacation = request.typeCode === "VACATION";
    const wantEmployee = canReadEmployee;
    const wantEntitlement = canReadEntitlement && isVacation;
    const wantShifts = canReadShifts;
    factsFor = rid;
    const current = () => factsFor === rid;

    if (wantEmployee) {
      api
        .get<{ assignments: SalonAssignment[] }>(`/employees/${employeeId}/salon-assignments`)
        .then((assigned) => {
          if (current()) homeSalonId = homeSalonIdOn(assigned.assignments, startDate);
        })
        .catch(() => {});
    }

    if (wantEntitlement) {
      const year = startDate.slice(0, 4);
      api
        .get<VacationEntitlementRow[]>(`/leave/entitlements/${employeeId}?year=${year}`)
        .then((rows) => {
          if (!current()) return;
          const balance = mapVacationBalance(rows.find((r) => r.typeCode === "VACATION"));
          const fact = vacationBeforeAfter({
            remaining: deriveVacationSummary(balance, 0).remaining,
            days,
            status,
            startDate,
            endDate,
          });
          if (fact) vacationFact = { label: fact.label, value: fact.value };
        })
        .catch(() => {});
    }

    if (wantShifts) {
      api
        .get<RangeShift[]>(`/shifts/range?from=${startDate}&to=${endDate}&employeeId=${employeeId}`)
        .then((rows) => {
          if (current()) shiftFactLines = shiftLines(rows);
        })
        .catch(() => {});
    }
  });

  function typeName(code: CalendarTypeCode): string {
    return LEAVE_TYPE_OPTIONS.find((t) => t.code === code)?.label ?? code;
  }

  function fmtDate(iso: string): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }

  let personName = $derived(`${request.employee.firstName} ${request.employee.lastName}`);
</script>

<dl class="facts" data-testid={testId}>
  <div class="fact">
    <dt>Person</dt>
    <dd>{personName}</dd>
  </div>
  <div class="fact">
    <dt>Art</dt>
    <dd>{typeName(request.typeCode)}</dd>
  </div>
  <div class="fact">
    <dt>Zeitraum</dt>
    <dd>{fmtDate(request.startDate)} – {fmtDate(request.endDate)}</dd>
  </div>
  <div class="fact">
    <dt>Umfang</dt>
    <dd>{leaveDaysLabel(Number(request.days), request.halfDay, request.typeCode)}</dd>
  </div>
  {#if homeSalonName}
    <div class="fact" data-testid="review-fact-home-salon">
      <dt>Stammsalon</dt>
      <dd>{homeSalonName}</dd>
    </div>
  {/if}
  {#if vacationFact}
    <div class="fact" data-testid="review-fact-vacation">
      <dt>{vacationFact.label}</dt>
      <dd>{vacationFact.value}</dd>
    </div>
  {/if}
  {#if shiftFactLines}
    <div class="fact fact--full" data-testid="review-fact-shifts">
      <dt>Schichten im Zeitraum</dt>
      <dd>
        {#if shiftFactLines.length === 0}
          {NO_SHIFTS_TEXT}
        {:else}
          <ul class="shift-lines">
            {#each shiftFactLines as line, i (i)}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
      </dd>
    </div>
  {/if}
  {#if request.note}
    <div class="fact fact--full">
      <dt>Anmerkung Mitarbeiter</dt>
      <dd>„{request.note}"</dd>
    </div>
  {/if}
</dl>

<style>
  /* The facts are a plain definition list on the dialog surface (Issue #853); no bespoke box. */
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-3) var(--s-6);
    margin: 0;
  }
  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fact--full {
    grid-column: 1 / -1;
  }
  .fact dt {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .fact dd {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .shift-lines {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 9.5rem;
    overflow-y: auto;
  }

  @media (max-width: 700px) {
    .facts {
      grid-template-columns: 1fr;
    }
  }
</style>
