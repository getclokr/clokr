// Issue #851 (prototype „Zeiten“): the four Kennzahlen above the own month - Gearbeitet, Monatssaldo,
// Pausen, Status. Pure wording over figures the page already holds (its MonthMetrics, the sum of the
// recorded breaks and the server's day-check map): nothing is computed here, so the figures stay the
// ones MonatSaldoCard showed (#125 one-source count, #433 MONTHLY_HOURS Soll, #495 no-Soll contract).
// Issue #1029 adds the Gesamtsaldo of Team › Zeiten: the GET /overtime/:id total the page already
// loads, only worded here (Stichtag gestern, forecast label from the one helper) - still no sum.
import { fmtBalance, fmtMin } from "$lib/utils/format-minutes";
import { forecastLabel } from "$lib/saldo/forecast-label"; // Issue #588: one forecast wording
import { MONTH_STATUS_TONE, monthStatusLabel } from "$lib/saldo/month-status"; // Issue #598: one status wording
import type { ChipTone } from "$lib/components/ui/chip-tone";

/** The fields of KpiStrip's item this module fills (a structural subset; a plain .ts module cannot
 *  import a type from a .svelte file under `tsc`). */
export interface KpiItem {
  label: string;
  value: string;
  unit?: string;
  explanation?: string;
  testId?: string;
}

export interface ZeitenMonthFigures {
  sollToDateMin: number;
  istMin: number;
  /** null = no Soll target or no contract: no saldo is claimed. */
  saldoMin: number | null;
  noSollTarget: boolean;
  /** Days with worked time, from the same source as `istMin`; null = that source has none. */
  workdaysSoFar: number | null;
  rosterIncomplete: boolean;
  extraNote?: string;
}

export interface ZeitenKpiInput {
  month: ZeitenMonthFigures;
  /** The displayed month is closed (Monatsabschluss). */
  locked: boolean;
  /** Recorded break minutes of the counted entries (through yesterday). */
  breakMinutes: number;
  /** Days of the month with a finding of the server's day check; null = the check is off. */
  findingDays: number | null;
  runningCount: number;
  /**
   * Issue #853 (additive, Team › Zeiten): the caller may not read this person's Soll and saldo
   * (#85). The figures then show the Ist only and say who sees the rest, never a no-Soll wording.
   */
  saldoWithheld?: boolean;
  /**
   * Issue #1029 (additive, Team › Zeiten only): the GET /overtime/:id answer the page already holds.
   * Present (even as null) = the Gesamtsaldo Kennzahl is added after the Monatssaldo; absent = the
   * three items of before (Ich › Zeiten stays unchanged).
   */
  account?: ZeitenAccountFigure | null;
  /** Issue #1029: the account read was refused (#85) - the Gesamtsaldo shows „—“ like the Monatssaldo. */
  accountWithheld?: boolean;
}

/** The fields of GET /overtime/:id the Gesamtsaldo Kennzahl words (Issue #1029). */
export interface ZeitenAccountFigure {
  balanceHours: number;
  unconfirmedMonths?: number | null;
  hasClosedMonth?: boolean;
  /** „Stand gestern, 3.11.“ - see `standGesternText`. */
  stand: string;
}

/**
 * One wording for a saldo the viewer may not read (#85), shared by Monatssaldo and Gesamtsaldo. Role
 * names are tenant data and never named in a text (Issue #992, N-07 of 14.11., D-992-25).
 */
const SALDO_WITHHELD_EXPLANATION = "für dich nicht freigegeben";

/**
 * „Stand gestern, 23.11.“ - the Stichtag wording of Ich › Konto (Issue #1029). `anchor` is the tenant
 * day as a calendar anchor (`tenantDayAnchor` / `dayAnchor`), never the raw device clock (Issue #1072).
 */
export function standGesternText(anchor: Date): string {
  const yesterday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 1);
  const label = yesterday.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
  return `Stand gestern, ${label}`;
}

function daysText(n: number): string {
  return n === 1 ? "1 Arbeitstag" : `${n} Arbeitstage`;
}

export function zeitenKpis(input: ZeitenKpiInput): KpiItem[] {
  const { month, locked, breakMinutes, findingDays, runningCount, saldoWithheld = false } = input;
  const accountWithheld = input.accountWithheld === true;
  const cutoff = locked ? "ganzer Monat" : "bis gestern";

  const workedParts = [
    month.workdaysSoFar !== null ? daysText(month.workdaysSoFar) : null,
    cutoff,
    runningCount > 0 ? `${runningCount} läuft` : null,
  ].filter(Boolean);

  const worked: KpiItem = {
    label: "Gearbeitet",
    value: fmtMin(month.istMin),
    unit:
      !month.noSollTarget && month.sollToDateMin > 0 ? `/ ${fmtMin(month.sollToDateMin)} h` : "h",
    explanation: workedParts.join(" · "),
    testId: "zeiten-kpi-worked",
  };

  const saldo: KpiItem = saldoWithheld
    ? {
        label: "Monatssaldo",
        value: "—",
        explanation: SALDO_WITHHELD_EXPLANATION,
        testId: "zeiten-kpi-saldo",
      }
    : month.noSollTarget
      ? {
          label: "Monatssaldo",
          value: "—",
          explanation: "Zeiterfassung ohne Sollvergleich",
          testId: "zeiten-kpi-saldo",
        }
      : {
          label: "Monatssaldo",
          value: month.saldoMin === null ? "—" : fmtBalance(month.saldoMin),
          unit: month.saldoMin === null ? undefined : "h",
          explanation: [
            locked ? "Bestätigt · Monat abgeschlossen" : "Prognose · Monat offen",
            month.rosterIncomplete ? "Dienstplan unvollständig" : null,
            month.extraNote ?? null,
          ]
            .filter(Boolean)
            .join(" · "),
          testId: "zeiten-kpi-saldo",
        };

  // Issue #1029: the account total (GET /overtime/:id) right after the Monatssaldo. The value is the
  // conversion Ich › Konto uses (Math.round(balanceHours * 60)); nothing is summed here.
  const withTotal = input.account !== undefined || accountWithheld;
  const account = input.account ?? null;
  const total: KpiItem = accountWithheld
    ? {
        label: "Gesamtsaldo",
        value: "—",
        explanation: SALDO_WITHHELD_EXPLANATION,
        testId: "zeiten-kpi-total",
      }
    : month.noSollTarget
      ? {
          label: "Gesamtsaldo",
          value: "—",
          explanation: "Zeiterfassung ohne Sollvergleich",
          testId: "zeiten-kpi-total",
        }
      : account === null
        ? { label: "Gesamtsaldo", value: "—", testId: "zeiten-kpi-total" }
        : {
            label: "Gesamtsaldo",
            value: fmtBalance(Math.round(account.balanceHours * 60)),
            unit: "h",
            explanation: `${account.stand} · ${forecastLabel(account.unconfirmedMonths, account.hasClosedMonth)}`,
            testId: "zeiten-kpi-total",
          };

  const pauses: KpiItem = {
    label: "Pausen",
    value: fmtMin(breakMinutes),
    unit: "h",
    explanation:
      findingDays === null
        ? cutoff
        : findingDays === 0
          ? "keine ArbZG-Hinweise"
          : findingDays === 1
            ? "1 Tag mit ArbZG-Hinweis"
            : `${findingDays} Tage mit ArbZG-Hinweis`,
    testId: "zeiten-kpi-breaks",
  };

  return withTotal ? [worked, saldo, total, pauses] : [worked, saldo, pauses];
}

/**
 * Issue #935 (Zeiten mockup, owner acceptance 14.11.2026): the own page names its figures Ist, Soll
 * and Differenz. The same figures as `zeitenKpis` (Ist = `istMin`, Soll = `sollToDateMin`, Differenz =
 * the month saldo `saldoMin` the page already holds) - only the wording and the order change; the
 * break sum is not a Kennzahl of the own page any more (findings stay in the day-check panels).
 * Team › Zeiten keeps `zeitenKpis`.
 */
export function ownZeitenKpis(input: ZeitenKpiInput): KpiItem[] {
  const { month, locked, runningCount } = input;
  const cutoff = locked ? "ganzer Monat" : "bis gestern";

  const ist: KpiItem = {
    label: "Ist",
    value: fmtMin(month.istMin),
    unit: "h",
    explanation:
      [
        month.workdaysSoFar !== null ? daysText(month.workdaysSoFar) : null,
        runningCount > 0
          ? runningCount === 1
            ? "1 Eintrag läuft"
            : `${runningCount} Einträge laufen`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || cutoff,
    testId: "zeiten-kpi-worked",
  };

  const soll: KpiItem = month.noSollTarget
    ? {
        label: "Soll",
        value: "—",
        explanation: "Zeiterfassung ohne Sollvergleich",
        testId: "zeiten-kpi-soll",
      }
    : {
        label: locked ? "Soll" : "Soll bis gestern",
        value: fmtMin(month.sollToDateMin),
        unit: "h",
        explanation:
          [
            locked ? "ganzer Monat" : null,
            month.rosterIncomplete ? "Dienstplan unvollständig" : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        testId: "zeiten-kpi-soll",
      };

  const diff: KpiItem = month.noSollTarget
    ? {
        label: "Differenz",
        value: "—",
        explanation: "Zeiterfassung ohne Sollvergleich",
        testId: "zeiten-kpi-saldo",
      }
    : {
        label: "Differenz",
        value: month.saldoMin === null ? "—" : fmtBalance(month.saldoMin),
        unit: month.saldoMin === null ? undefined : "h",
        explanation: [
          locked ? "Bestätigt · Monat abgeschlossen" : "Prognose · Monat offen",
          month.extraNote ?? null,
        ]
          .filter(Boolean)
          .join(" · "),
        testId: "zeiten-kpi-saldo",
      };

  return [ist, soll, diff];
}

/**
 * The status cell: closed or open. The open note names no role: who closes the month differs per company
 * (HR, the owner or the automatic close), Issue #994 (D-994-14).
 */
export function zeitenStatus(locked: boolean): {
  label: string;
  tone: ChipTone;
  explanation: string;
} {
  return locked
    ? {
        label: monthStatusLabel(true),
        tone: MONTH_STATUS_TONE.CLOSED,
        explanation: "Werte sind final",
      }
    : {
        label: monthStatusLabel(false),
        tone: MONTH_STATUS_TONE.OPEN,
        explanation: "wird nach Monatsende abgeschlossen",
      };
}
