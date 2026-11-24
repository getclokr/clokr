import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";

import { clokrMarkdown } from "../markdown-plugins.mjs";
import { buildSidebar, latestReleaseNote } from "../navigation.mjs";
import { EXCLUDED, REPO_URL, SITE_BASE } from "../publication.mjs";

// The site renders the repository's docs/ directory where it lives: nothing is copied, moved or
// given frontmatter for the site, so apps/api/Dockerfile still bakes docs/release-notes and the
// permissions test still reads docs/permissions.md. What is published is decided in
// publication.mjs (Issue #1064).
const srcDir = fileURLToPath(new URL("../../../docs", import.meta.url));

// Logo and favicon are served from the app's brand assets; nothing is copied into the repository.
const brandDir = fileURLToPath(new URL("../../web/static/brand", import.meta.url));

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
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${SITE_BASE}favicon.svg` }]],
  markdown: {
    config: (md) => clokrMarkdown(md, { srcDir }),
  },
  vite: {
    publicDir: brandDir,
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
    logo: "/mark.svg",
    nav: [
      { text: "Handbuch", link: "/handbuch/" },
      { text: "Entwickler-Doku", link: "/entwickler/" },
      { text: "Neuigkeiten", link: latestReleaseNote(srcDir) },
    ],
    sidebar: buildSidebar(srcDir),
    socialLinks: [{ icon: "github", link: REPO_URL }],
    editLink: {
      pattern: `${REPO_URL}/edit/main/docs/:path`,
      text: "Diese Seite auf GitHub bearbeiten",
    },
    outline: { level: [2, 3], label: "Auf dieser Seite" },
    docFooter: { prev: "Vorherige Seite", next: "Nächste Seite" },
    darkModeSwitchLabel: "Erscheinungsbild",
    lightModeSwitchTitle: "Zum hellen Modus wechseln",
    darkModeSwitchTitle: "Zum dunklen Modus wechseln",
    sidebarMenuLabel: "Menü",
    navMenuLabel: "Hauptnavigation",
    mobileMenuLabel: "Menü",
    extraMenuLabel: "Weitere Optionen",
    returnToTopLabel: "Nach oben",
    langMenuLabel: "Sprache",
    skipToContentLabel: "Zum Inhalt springen",
    notFound: {
      title: "Seite nicht gefunden",
      quote:
        "Diese Seite gibt es nicht (mehr). Prüfe die Adresse oder geh zurück zur Startseite, dort findest du den Weg.",
      linkLabel: "Zur Startseite",
      linkText: "Zur Startseite",
    },
    footer: { message: "Clokr ist Open Source unter der MIT-Lizenz." },
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Suchen", buttonAriaLabel: "Suchen" },
          modal: {
            displayDetails: "Details anzeigen",
            resetButtonTitle: "Suche zurücksetzen",
            backButtonTitle: "Suche schließen",
            noResultsText: "Keine Ergebnisse für",
            footer: {
              selectText: "auswählen",
              selectKeyAriaLabel: "Eingabetaste",
              navigateText: "navigieren",
              navigateUpKeyAriaLabel: "Pfeil nach oben",
              navigateDownKeyAriaLabel: "Pfeil nach unten",
              closeText: "schließen",
              closeKeyAriaLabel: "Escape",
            },
          },
        },
      },
    },
  },
});
