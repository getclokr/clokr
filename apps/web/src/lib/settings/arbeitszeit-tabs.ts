// Issue #951 - the tabs of Verwalten › Regeln › Arbeitszeit & Verträge: one tab per registry section, so the
// page (once ~2,900 px long) is a strip of short panels like Regeln › Abwesenheiten. A tab is offered only
// under the alternatives of its own section (D-854-05); presentation only, the API's 403 stays the authority.
// The tab ids are lowercase German and double as URL hashes (`/verwalten/regeln/arbeitszeit#pausen`); `arbzg`
// is the anchor the setup check of Verwalten › Übersicht already links to. No runes and no `$app` imports on
// purpose.

import type { PermissionHolder } from "$lib/permissions";
import { mayOpenSection, settingsSection } from "$lib/settings/settings-pages";

export type ArbeitszeitTabId =
  | "standard"
  | "ueberstunden"
  | "arbeitstage"
  | "gleitzeit"
  | "pausen"
  | "arbzg"
  | "offene-eintraege"
  | "rueckwirkend"
  | "berufsschule";

export interface ArbeitszeitTab {
  value: ArbeitszeitTabId;
  label: string;
  /** The registry section the tab shows. */
  section: string;
}

/** The tabs in strip order (the order the sections had on the long page). */
export const ARBEITSZEIT_TABS: readonly ArbeitszeitTab[] = [
  { value: "standard", label: "Standard-Arbeitszeit", section: "arbeitszeit-standard" },
  { value: "ueberstunden", label: "Überstunden", section: "arbeitszeit-ueberstunden" },
  { value: "arbeitstage", label: "Arbeitstage", section: "arbeitszeit-arbeitstage" },
  { value: "gleitzeit", label: "Gleitzeit", section: "arbeitszeit-gleitzeit" },
  { value: "pausen", label: "Pausen", section: "arbeitszeit-pausen" },
  { value: "arbzg", label: "ArbZG-Prüfung", section: "arbeitszeit-compliance" },
  { value: "offene-eintraege", label: "Offene Einträge", section: "arbeitszeit-offene-eintraege" },
  { value: "rueckwirkend", label: "Rückwirkende Einträge", section: "arbeitszeit-rueckwirkend" },
  { value: "berufsschule", label: "Berufsschule", section: "arbeitszeit-berufsschule" },
];

/** The tabs `user` may open. */
export function visibleArbeitszeitTabs(
  user: PermissionHolder | null | undefined,
): ArbeitszeitTab[] {
  return ARBEITSZEIT_TABS.filter((tab) => mayOpenSection(user, settingsSection(tab.section)));
}
