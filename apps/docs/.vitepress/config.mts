import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";

import { clokrMarkdown } from "../markdown-plugins.mjs";
import { EXCLUDED, SITE_BASE } from "../publication.mjs";

// The site renders the repository's docs/ directory where it lives: nothing is copied, moved or
// given frontmatter for the site, so apps/api/Dockerfile still bakes docs/release-notes and the
// permissions test still reads docs/permissions.md. What is published is decided in
// publication.mjs (Issue #1064).
const srcDir = fileURLToPath(new URL("../../../docs", import.meta.url));

const packageManifest = fileURLToPath(new URL("../package.json", import.meta.url));

export default defineConfig({
  srcDir,
  srcExclude: EXCLUDED.map(({ path }) => path),
  base: SITE_BASE,
  lang: "de-DE",
  title: "Clokr",
  description: "Handbuch und Entwickler-Doku für Clokr",
  cleanUrls: true,
  // A shallow CI checkout would show wrong dates.
  lastUpdated: false,
  // A dead internal link fails the build. Only `localhost` URLs are exempt: docs such as
  // getting-started.md name http://localhost:3000 as the address of the local stack, which no
  // build can reach.
  ignoreDeadLinks: "localhostLinks",
  markdown: {
    config: (md) => clokrMarkdown(md, { srcDir }),
  },
  vite: {
    plugins: [
      {
        // Every page module VitePress generates imports `vue`. The Markdown files sit in the
        // repository's docs/ directory, whose ancestors hold no node_modules with vue (pnpm keeps
        // it in this package), so those imports would not resolve. Resolve them from this
        // package instead — the same vue the rest of the site gets.
        name: "clokr-docs-resolve-vue-from-package",
        enforce: "pre",
        async resolveId(source, importer, options) {
          const isVue = source === "vue" || source.startsWith("vue/");
          if (!isVue || !importer || !importer.startsWith(srcDir)) return null;
          return this.resolve(source, packageManifest, { ...options, skipSelf: true });
        },
      },
    ],
  },
  themeConfig: {
    nav: [
      { text: "Handbuch", link: "/handbuch/" },
      { text: "Entwickler-Doku", link: "/entwickler/" },
    ],
  },
});
