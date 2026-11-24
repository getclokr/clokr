import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Tailwind is a token pipeline only (Issue #843, D-843-13); it runs before sveltekit().
  // SvelteKit 3 reads no svelte.config.js: this options object is the whole SvelteKit config.
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      // Issue #849 (6): SvelteKit's own registration has no `.catch`, so a failing registration was
      // an unhandled rejection on every page load. The root layout registers the push worker itself
      // (`$lib/push/register-service-worker.ts`), catching and reporting a failure once per session.
      serviceWorker: { register: false },
      alias: {
        $lib: "./src/lib",
        $components: "./src/lib/components",
        $stores: "./src/lib/stores",
        $api: "./src/lib/api",
        // Phase 76 — colocated component tests import { renderWithTheme } from
        // "$tests/test-utils". Mirror the vitest.config.ts alias here so tsc
        // (driven by the generated tsconfig paths) resolves the same.
        $tests: "./src/__tests__",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
