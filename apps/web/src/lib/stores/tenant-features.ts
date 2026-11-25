/**
 * Global tenant-feature flags store (Phase 47.3-02).
 *
 * Fetched once per (app)/ layout mount from GET /settings/work (no role gate on
 * the GET — any authenticated user can read it). Components (Sidebar,
 * BottomTabBar, admin pages) subscribe to react to toggles without page reload.
 *
 * Fail-open: default state pretends every feature is on so the nav doesn't
 * flash hidden→visible during initial load. The catch path on fetch failure
 * keeps the defaults and just marks `loaded: true` so dependent code can
 * stop waiting.
 *
 * Issue #1066: the store also carries the tenant's IANA time zone (`timezone`), the zone the
 * server files a clock stamp's day in. A page that needs "today" for the tenant awaits
 * `loadTimezone()` instead of reading the store value: a child page's `onMount` runs BEFORE the
 * (app) layout's, so at its first request the layout's fetch has not settled yet. Both callers
 * share one in-flight request. A missing or failed answer reads as `DEFAULT_TIMEZONE`, the
 * server's own default, never as the browser's zone.
 */
import { writable, get } from "svelte/store";
import { api } from "$api/client";
import { DEFAULT_TIMEZONE } from "$lib/settings/allgemein";

interface TenantFeatures {
  availabilityEnabled: boolean;
  /** The tenant's IANA zone (Issue #1066). */
  timezone: string;
  loaded: boolean;
}

interface SettingsWorkResponse {
  availabilityEnabled?: boolean;
  timezone?: string;
  // other fields exist but are not consumed here
}

function createTenantFeatures() {
  const { subscribe, update } = writable<TenantFeatures>({
    availabilityEnabled: true,
    timezone: DEFAULT_TIMEZONE,
    loaded: false,
  });

  /** The request in flight, shared by every caller that asks while it runs. */
  let inFlight: Promise<void> | null = null;
  /** True once a request has answered or failed; `loadTimezone()` then needs no request. */
  let settled = false;

  async function request(): Promise<void> {
    try {
      const cfg = await api.get<SettingsWorkResponse>("/settings/work");
      update((s) => ({
        ...s,
        availabilityEnabled: cfg.availabilityEnabled ?? true,
        timezone:
          typeof cfg.timezone === "string" && cfg.timezone !== "" ? cfg.timezone : DEFAULT_TIMEZONE,
        loaded: true,
      }));
    } catch {
      // fail-open: leave the optimistic defaults and just mark loaded so
      // any "waiting for feature flag" UI can move on.
      update((s) => ({ ...s, loaded: true }));
    } finally {
      settled = true;
      inFlight = null;
    }
  }

  function fetchFeatures(): Promise<void> {
    inFlight ??= request();
    return inFlight;
  }

  return {
    subscribe,
    fetch: fetchFeatures,
    /**
     * The tenant's time zone (Issue #1066). Without a settled fetch it makes (or joins) the
     * request first; afterwards it answers from the store without another request.
     */
    async loadTimezone(): Promise<string> {
      if (!settled) await fetchFeatures();
      return get({ subscribe }).timezone;
    },
    /**
     * Lets the admin page push the new value after a successful PUT so
     * Sidebar/BottomTabBar update instantly without a second round-trip.
     */
    applyLocal(availabilityEnabled: boolean): void {
      update((s) => ({ ...s, availabilityEnabled, loaded: true }));
    },
    /**
     * Synchronous read of the current value. Intended for tests and
     * occasional non-reactive call sites.
     */
    peek(): TenantFeatures {
      return get({ subscribe });
    },
  };
}

export const tenantFeatures = createTenantFeatures();
