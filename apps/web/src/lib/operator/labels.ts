// German display labels of the operator console (Issue #89). Display only: control decisions
// branch on codes and enum values, never on these strings (D-13).
import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { FederalState } from "@clokr/types";
import type { TenantModule } from "$lib/packages/tenant-modules";
import type { SupportAccessEndedBy, SupportAccessStatus, SupportDurationHours } from "./types";
import { CONNECTION_TEXT, RATE_LIMIT_TEXT, SERVER_FAULT_TEXT } from "./reasons";
import { dateTimeLabel, dayLabel, dayRangeLabel } from "$lib/utils/day-label";

const LABELS: Record<FederalState, string> = {
  BADEN_WUERTTEMBERG: "Baden-Württemberg",
  BAYERN: "Bayern",
  BERLIN: "Berlin",
  BRANDENBURG: "Brandenburg",
  BREMEN: "Bremen",
  HAMBURG: "Hamburg",
  HESSEN: "Hessen",
  MECKLENBURG_VORPOMMERN: "Mecklenburg-Vorpommern",
  NIEDERSACHSEN: "Niedersachsen",
  NORDRHEIN_WESTFALEN: "Nordrhein-Westfalen",
  RHEINLAND_PFALZ: "Rheinland-Pfalz",
  SAARLAND: "Saarland",
  SACHSEN: "Sachsen",
  SACHSEN_ANHALT: "Sachsen-Anhalt",
  SCHLESWIG_HOLSTEIN: "Schleswig-Holstein",
  THUERINGEN: "Thüringen",
};

export const FEDERAL_STATE_OPTIONS: ReadonlyArray<{ value: FederalState; label: string }> = (
  Object.entries(LABELS) as Array<[FederalState, string]>
)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "de"));

export function federalStateLabel(value: FederalState): string {
  return LABELS[value];
}

/**
 * The browser-zone calendar day of an instant as `YYYY-MM-DD`, the input of the shared day wording.
 * Local accessors on purpose (D-03): the operator reads an instant in their own zone.
 */
function localDayOf(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** The German day of an instant ("1.10.2026", no leading zero, Issue #1168); an unparsable value is a dash. */
export function formatOperatorDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return dayLabel(localDayOf(date), { year: true });
}

/** "1.10.2026, 09:30" of an instant in the browser's zone (D-03); an unparsable value is a dash. */
export function formatOperatorDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return dateTimeLabel(date);
}

/** `HH:mm` of an instant in the browser's zone (D-03); an unparsable value is a dash. */
export function formatOperatorTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return format(date, "HH:mm", { locale: de });
}

/**
 * The German day of a `YYYY-MM-DD` calendar day ("1.10.2026", Issue #90, #1168). The shared
 * `dayLabel` is pure string work, so the API's UTC day is never shifted by the viewer's time zone.
 * Anything that is not that shape is shown as a dash.
 */
export function formatOperatorDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "–";
  return dayLabel(day, { year: true });
}

/**
 * The sentence a failed load shows. Distinguishes the three causes the operator can act on
 * (no connection, server fault, rate limit) and falls back to the caller's page-specific text for
 * everything else. It reads the numeric `status` only - never a message text (D-13).
 */
export function describeLoadError(error: unknown, fallback: string): string {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== "number") {
    return error instanceof TypeError ? CONNECTION_TEXT : fallback;
  }
  if (status === 429) return RATE_LIMIT_TEXT;
  if (status >= 500) return SERVER_FAULT_TEXT;
  return fallback;
}

/**
 * One neutral line per bookable module for the "Pakete" section. The module names come from
 * `TENANT_MODULE_LABELS` (`lib/packages/tenant-modules.ts`), the one web place that names them.
 */
export const TENANT_MODULE_DESCRIPTIONS: Readonly<Record<TenantModule, string>> = {
  CHAIN: "Mehrere aktive Salons bis zum Salon-Kontingent",
  INTEGRATIONS: "Phorest-Synchronisation und API-Schlüssel",
  HARDWARE_CLOCK: "NFC-Terminals und WLAN-Anwesenheit",
  ANALYTICS: "Auswertung nach Tätigkeitsarten",
};

/** The durations of a support access (D-03), in the order the form offers them. */
export const SUPPORT_DURATION_OPTIONS: ReadonlyArray<{
  value: SupportDurationHours;
  label: string;
}> = [
  { value: 1, label: "1 Stunde" },
  { value: 4, label: "4 Stunden" },
  { value: 8, label: "8 Stunden" },
  { value: 24, label: "24 Stunden" },
];

/** Status badge text of a support access, keyed by the control value (never by the text). */
export const SUPPORT_STATUS_LABELS: Readonly<Record<SupportAccessStatus, string>> = {
  ACTIVE: "Aktiv",
  EXPIRED: "Abgelaufen",
  ENDED: "Beendet",
};

/** Who ended a support access early, keyed by the control value. */
export const SUPPORT_ENDED_BY_LABELS: Readonly<Record<SupportAccessEndedBy, string>> = {
  OPERATOR: "durch Betreiber",
  TENANT: "durch Mandant",
};

/** One calendar day, or "14.9.–18.9.2026" for a period (both ends `YYYY-MM-DD`). */
export function formatOperatorDayRange(start: string, end: string): string {
  // A malformed end keeps the dash of `formatOperatorDay` instead of printing the raw string.
  if (formatOperatorDay(start) === "–" || formatOperatorDay(end) === "–") {
    return `${formatOperatorDay(start)} – ${formatOperatorDay(end)}`;
  }
  return dayRangeLabel(start, end, { year: true });
}
