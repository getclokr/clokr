// Issue #951 - the tabs of Verwalten › Regeln › Arbeitszeit & Verträge: one tab per registry section, so the
// page (once ~2,900 px long) is a strip of short panels like Regeln › Abwesenheiten. A tab is offered only
// under the alternatives of its own section (D-854-05); presentation only, the API's 403 stays the authority.
// The tab ids are lowercase German and double as URL hashes (`/verwalten/regeln/arbeitszeit#pausen`); old per-section hashes (`#arbzg`, the anchor the setup check of Verwalten › Übersicht links to, `#standard` ...) are aliases. No runes and no `$app` imports on
// purpose.

import type { PermissionHolder } from "$lib/permissions";
import { mayOpenSection, settingsSection } from "$lib/settings/settings-pages";

export type ArbeitszeitTabId =
  "arbeitszeit" | "ueberstunden" | "pausen" | "eintraege" | "berufsschule";

export interface ArbeitszeitTab {
  value: ArbeitszeitTabId;
  label: string;
  /** The registry sections the tab shows; the tab is offered when the person may open at least one. */
  sections: readonly string[];
}

/** The tabs in strip order: five that fit a 1440 px page without scrolling the strip. */
export const ARBEITSZEIT_TABS: readonly ArbeitszeitTab[] = [
  {
    value: "arbeitszeit",
    label: "Arbeitszeit",
    sections: ["arbeitszeit-standard", "arbeitszeit-arbeitstage", "arbeitszeit-gleitzeit"],
  },
  { value: "ueberstunden", label: "Überstunden", sections: ["arbeitszeit-ueberstunden"] },
  {
    value: "pausen",
    label: "Pausen & ArbZG",
    sections: ["arbeitszeit-pausen", "arbeitszeit-compliance"],
  },
  {
    value: "eintraege",
    label: "Einträge",
    sections: ["arbeitszeit-offene-eintraege", "arbeitszeit-rueckwirkend"],
  },
  { value: "berufsschule", label: "Berufsschule", sections: ["arbeitszeit-berufsschule"] },
];

/** The hashes of the former one-tab-per-section strip, each mapped onto the tab that now holds the section. */
export const ARBEITSZEIT_TAB_ALIASES: Readonly<Record<string, ArbeitszeitTabId>> = {
  standard: "arbeitszeit",
  arbeitstage: "arbeitszeit",
  gleitzeit: "arbeitszeit",
  arbzg: "pausen",
  "offene-eintraege": "eintraege",
  rueckwirkend: "eintraege",
};

/** The tabs `user` may open. */
export function visibleArbeitszeitTabs(
  user: PermissionHolder | null | undefined,
): ArbeitszeitTab[] {
  return ARBEITSZEIT_TABS.filter((tab) =>
    tab.sections.some((id) => mayOpenSection(user, settingsSection(id))),
  );
}
