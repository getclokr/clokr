import { api } from "$api/client";
import type { Theme } from "$stores/theme";

/** Server shape — matches apps/api/src/contexts/platform/api/me.ts merged defaults. */
/** Issue #602: the e-mail groups a person may switch off (the server's PERSONAL_EMAIL_OPT_OUT_FIELDS). */
export type EmailOptOutField =
  "emailOnLeaveDecision" | "emailOnRetroEntry" | "emailOnMissingEntries" | "emailOnLeaveRequest";

export interface UiPreferences {
  /** Issue #976: the RESOLVED Farbwelt (own choice, else tenant default, else pflaume), decided on the server. */
  theme: Theme;
  /** The own choice; null = none, the tenant default applies. */
  themeChoice: Theme | null;
  /** The tenant's Standard-Farbwelt. */
  tenantDefaultTheme: Theme;
  mode: "light" | "dark" | "system";
  language: "de" | "en";
  emailOptOut: EmailOptOutField[];
}

/** What a PUT may carry; `theme: null` removes the own choice (back to the tenant default). */
export type UiPreferencesPartial = Partial<
  Omit<UiPreferences, "theme" | "themeChoice" | "tenantDefaultTheme">
> & { theme?: Theme | null };

/** Fetch the authenticated user's preferences (merged with server-side defaults). */
export function fetchPreferences(): Promise<UiPreferences> {
  return api.get<UiPreferences>("/me/preferences");
}

/** Partial-update the authenticated user's preferences. Returns the new merged state. */
export function savePreferences(partial: UiPreferencesPartial): Promise<UiPreferences> {
  return api.put<UiPreferences>("/me/preferences", partial);
}
