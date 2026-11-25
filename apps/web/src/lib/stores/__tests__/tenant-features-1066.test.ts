// Issue #1066 - the tenant store also carries the tenant's IANA zone: where it comes from, what it
// falls back to, that the layout's and the page's reads share one request, and that a local
// feature push keeps it.
const apiGet = vi.fn();

vi.mock("$api/client", () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("../tenant-features").tenantFeatures;

/** A fresh singleton per test: the store keeps its settled flag at module level. */
async function freshStore(): Promise<Store> {
  vi.resetModules();
  return (await import("../tenant-features")).tenantFeatures;
}

/** An answer the test settles by hand, to start two readers while the request is in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settingsReads = () => apiGet.mock.calls.filter((c) => c[0] === "/settings/work").length;

describe("tenant-features timezone (#1066)", () => {
  // A device zone that is neither Berlin nor UTC: a fallback that read the process zone would show.
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Pacific/Kiritimati";
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  beforeEach(() => {
    apiGet.mockReset();
  });

  it("anti-vacuity: the process zone is not Berlin", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Kiritimati");
  });

  it("S1: fetch() reads timezone next to availabilityEnabled", async () => {
    apiGet.mockResolvedValue({ timezone: "America/New_York", availabilityEnabled: false });
    const store = await freshStore();
    await store.fetch();
    expect(store.peek()).toEqual({
      availabilityEnabled: false,
      timezone: "America/New_York",
      loaded: true,
    });
  });

  it("S2: no timezone in the answer, or a failed request, is Europe/Berlin and never the process zone", async () => {
    apiGet.mockResolvedValue({ availabilityEnabled: true });
    const noConfig = await freshStore();
    await noConfig.fetch();
    expect(noConfig.peek().timezone).toBe("Europe/Berlin");

    apiGet.mockResolvedValue({ timezone: "", availabilityEnabled: true });
    const blank = await freshStore();
    await blank.fetch();
    expect(blank.peek().timezone).toBe("Europe/Berlin");

    apiGet.mockRejectedValue(new Error("network"));
    const failed = await freshStore();
    await failed.fetch();
    expect(failed.peek().timezone).toBe("Europe/Berlin");
    expect(failed.peek().loaded).toBe(true);
    expect(await failed.loadTimezone()).toBe("Europe/Berlin");
  });

  it("S3: the layout's fetch() and the page's loadTimezone() share one request, in either order", async () => {
    for (const order of ["layout-first", "page-first"] as const) {
      apiGet.mockReset();
      const answer = deferred<{ timezone: string }>();
      apiGet.mockReturnValue(answer.promise);
      const store = await freshStore();

      const reads =
        order === "layout-first"
          ? [store.fetch(), store.loadTimezone()]
          : [store.loadTimezone(), store.fetch()];
      expect(settingsReads()).toBe(1);
      answer.resolve({ timezone: "Asia/Tokyo" });
      await Promise.all(reads);

      expect(await store.loadTimezone()).toBe("Asia/Tokyo");
      expect(settingsReads()).toBe(1);
    }
  });

  it("S3: loadTimezone() after a settled fetch makes no request", async () => {
    apiGet.mockResolvedValue({ timezone: "Asia/Tokyo" });
    const store = await freshStore();
    await store.fetch();
    apiGet.mockClear();
    expect(await store.loadTimezone()).toBe("Asia/Tokyo");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("S4: fetch() after a settled fetch requests again (the layout's per-mount refresh)", async () => {
    apiGet.mockResolvedValue({ timezone: "Asia/Tokyo" });
    const store = await freshStore();
    await store.fetch();
    apiGet.mockResolvedValue({ timezone: "America/New_York" });
    await store.fetch();
    expect(settingsReads()).toBe(2);
    expect(store.peek().timezone).toBe("America/New_York");
  });

  it("S5: applyLocal() keeps the loaded timezone", async () => {
    apiGet.mockResolvedValue({ timezone: "Asia/Tokyo", availabilityEnabled: true });
    const store = await freshStore();
    await store.fetch();
    store.applyLocal(false);
    expect(store.peek()).toEqual({
      availabilityEnabled: false,
      timezone: "Asia/Tokyo",
      loaded: true,
    });
  });
});
