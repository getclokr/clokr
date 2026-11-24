// Issue #1015 - SvelteKit 3 wraps every route node in a boundary armed with the nearest
// `+error.svelte` and mounts with `transformError`, so a page render error reaches kit's client
// `handleError` first and clokr's own ErrorBoundary only sees a plain `{ status, message }` object.
// `src/hooks.client.ts` keeps the Phase 127 guarantee: an unexpected client error is reported to
// `POST /api/v1/logs/client` (through `clientLogger`) exactly once.
import { beforeEach, describe, expect, it, vi } from "vitest";

const errorMock = vi.hoisted(() => vi.fn());
vi.mock("$lib/utils/logger", () => ({
  clientLogger: { error: errorMock, warn: vi.fn(), install: vi.fn() },
}));

import { handleError } from "../hooks.client";

type Input = Parameters<typeof handleError>[0];

function call(input: Record<string, unknown>) {
  return handleError({
    event: {},
    status: 500,
    message: "Internal Error",
    ...input,
  } as unknown as Input);
}

describe("hooks.client handleError (kit 3 render errors)", () => {
  beforeEach(() => {
    errorMock.mockReset();
  });

  it("reports an unknown Error once, with its message, stack and the kit boundary", async () => {
    const error = new Error("kaputt");
    const result = await call({ kind: "unknown", error });
    expect(errorMock).toHaveBeenCalledTimes(1);
    const [message, extra] = errorMock.mock.calls[0];
    expect(message).toBe("Render-Fehler (kit): kaputt");
    expect(extra).toEqual({ stack: error.stack, boundary: "kit" });
    // kit keeps its default status and message
    expect(result).toBeUndefined();
  });

  it("reports a non-Error value as String(value) without a stack", async () => {
    await call({ kind: "unknown", error: "ein Text" });
    expect(errorMock).toHaveBeenCalledTimes(1);
    const [message, extra] = errorMock.mock.calls[0];
    expect(message).toBe("Render-Fehler (kit): ein Text");
    expect(extra.stack).toBeUndefined();
    expect(extra.boundary).toBe("kit");
  });

  it("does not report a framework error (a 404) or an app error", async () => {
    await call({ kind: "framework", error: { status: 404, message: "Not Found" }, status: 404 });
    await call({ kind: "app", error: { message: "gewollt" }, status: 403 });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("never throws, also when the logger throws, and still returns undefined", async () => {
    errorMock.mockImplementation(() => {
      throw new Error("logger down");
    });
    let result: unknown = "unset";
    expect(() => {
      result = call({ kind: "unknown", error: new Error("x") });
    }).not.toThrow();
    expect(await result).toBeUndefined();
    expect(errorMock).toHaveBeenCalledTimes(1);
  });
});
