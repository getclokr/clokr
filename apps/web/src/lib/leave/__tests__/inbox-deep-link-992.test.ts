// Issue #992 (N-07, owner decision 25.11.2026) - the sender side of the Aufgaben deep link.
import { describe, expect, it } from "vitest";
import { inboxRequestHref, parseInboxDeepLink } from "../inbox-deep-link";

const ID = "3f2c9a10-7b1e-4c55-9d3a-1a2b3c4d5e6f";

describe("inboxRequestHref", () => {
  it("builds /team/aufgaben?request=<id>&year=<year of the start day>", () => {
    expect(inboxRequestHref(ID, "2026-12-01")).toBe(`/team/aufgaben?request=${ID}&year=2026`);
    expect(inboxRequestHref(ID, "2027-01-04T00:00:00.000Z")).toBe(
      `/team/aufgaben?request=${ID}&year=2027`,
    );
  });

  it("returns null for an id that is not a uuid and for a malformed start day", () => {
    expect(inboxRequestHref("lr1", "2026-12-01")).toBeNull();
    expect(inboxRequestHref(ID, "")).toBeNull();
    expect(inboxRequestHref(ID, "1.12.2026")).toBeNull();
  });

  it("round trip: parseInboxDeepLink reads back exactly that id and year", () => {
    const href = inboxRequestHref(ID, "2026-12-01") as string;
    const parsed = parseInboxDeepLink(new URL(href, "http://x").searchParams, 2026);
    expect(parsed.requestId).toBe(ID);
    expect(parsed.year).toBe(2026);
  });
});
