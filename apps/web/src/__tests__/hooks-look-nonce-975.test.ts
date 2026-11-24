// @vitest-environment node
// Issue #975 (T-v5a-05) - the inline pre-paint script of app.html passes the enforced CSP: the hook
// puts the per-request nonce on its <script> tag and names the same nonce in script-src, and the
// policy gains no 'unsafe-inline' for scripts.
import type { RequestEvent } from "@sveltejs/kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { handle } from "../hooks.server";

const appHtml = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app.html"),
  "utf8",
);

let previousMode: string | undefined;

beforeEach(() => {
  previousMode = process.env.CSP_MODE;
  delete process.env.CSP_MODE;
});

afterEach(() => {
  if (previousMode === undefined) delete process.env.CSP_MODE;
  else process.env.CSP_MODE = previousMode;
});

describe("#975 pre-paint script and the CSP nonce", () => {
  it("the boot script tag carries the nonce the CSP header names", async () => {
    const locals: Record<string, unknown> = {};
    const event = {
      url: new URL("http://localhost/login"),
      request: new Request("http://localhost/login"),
      getClientAddress: () => "127.0.0.1",
      locals,
    } as unknown as RequestEvent;

    let rendered = "";
    const response = await handle({
      event,
      resolve: async (
        _event: RequestEvent,
        opts?: { transformPageChunk?: (a: { html: string; done: boolean }) => string | undefined },
      ) => {
        rendered = opts?.transformPageChunk?.({ html: appHtml, done: true }) ?? "";
        return new Response(rendered, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    } as unknown as Parameters<typeof handle>[0]);

    const nonce = String(locals.nonce);
    expect(nonce.length).toBeGreaterThan(10);
    expect(rendered).toContain(`<script nonce="${nonce}" id="clokr-look">`);
    // every script tag of the document carries the nonce
    const tags = rendered.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
  });
});
