# Archive of the former Clokr GitHub wiki

This directory holds a verbatim, byte-identical copy of the GitHub wiki of this repository, taken
before the wiki was retired (Issue #1064).

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Source         | `https://github.com/getclokr/clokr.wiki.git`                           |
| Commit         | `f60c325579cbc9ae9e3f349348ab3c80530b26a0`                             |
| Commit date    | 2026-10-03                                                             |
| Archived on    | 2026-11-25                                                             |
| Content        | 27 Markdown files (26 pages and `_Sidebar.md`) and 40 PNG images in `images/` |

Every file except this `ARCHIVE.md` is unchanged. `archive/` is listed in `.prettierignore` so that
no formatter rewrites the copy.

## Status

The pages describe Clokr 1.13 and the user interface before the redesign of v2. They are kept for
traceability only. The content now lives on the documentation site, built from the code repository:
the user pages as the Handbuch (`docs/handbuch`), the technical pages as the Entwickler-Doku
(`docs/entwickler` and the canonical documents in `docs/`). The wiki is disabled once the site is
live (Issue #1064). The 40 screenshots show the old interface and are not reused.

## Commits of the wiki

Subjects only, newest first (`git log --format='%h %ad %s' --date=short`):

```text
f60c325 2026-10-03 Monatsstunden: Soll ist geschuldet, Schalter entfällt (Issue 433)
2e768f2 2026-10-02 Document usual-workdays Angabe and week-union vacation counting (Issue #436)
7c5caee 2026-10-01 Urlaubstage pro Mitarbeiter, Azubi-Standard und gesetzlicher Mindesturlaub (#435)
d646da5 2026-09-30 Document leave-first planning workflow for shift-based staff
d79c6de 2026-09-30 Home: Stand 1.13.0
d9e9a10 2026-09-30 Leave consumption for shift workers is counted by contract (Clokr 1.12.2, #417)
6393659 2026-09-28 Fix wiki links inside tables (pipe split the cells)
cc17f7c 2026-09-28 Rewrite user documentation for Clokr 1.12.0
9ade7a7 2026-08-03 Recreate Clokr wiki: bilingual (DE user guides + EN technical reference) for v1.9.2
```

## Page to site mapping

| Wiki page                          | Target on the site                                                                           | Action                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Home                               | `docs/handbuch/index.md`                                                                     | rewritten                                                        |
| Benutzerhandbuch                   | `docs/handbuch/ich/index.md`                                                                 | rewritten                                                        |
| Erste-Schritte                     | `docs/handbuch/erste-schritte.md`                                                            | rewritten                                                        |
| Zeiterfassung                      | `docs/handbuch/ich/mein-tag-und-zeiten.md`                                                   | rewritten                                                        |
| Abwesenheiten                      | `docs/handbuch/ich/abwesenheiten.md`                                                         | rewritten                                                        |
| Verfuegbarkeit-und-Schichten       | `docs/handbuch/ich/dienstplan.md`                                                            | rewritten                                                        |
| Admin-Handbuch                     | `docs/handbuch/team/index.md` and `docs/handbuch/verwalten/index.md`                         | rewritten, split                                                 |
| Genehmigungen                      | `docs/handbuch/team/aufgaben.md`                                                             | rewritten                                                        |
| Team-Zeiten                        | `docs/handbuch/team/zeiten.md`                                                               | rewritten                                                        |
| Schichtplanung                     | `docs/handbuch/team/dienstplan.md`                                                           | rewritten                                                        |
| Reports-und-Exporte                | `docs/handbuch/team/berichte.md` (export part in `docs/handbuch/verwalten/system-und-daten.md`) | rewritten                                                     |
| Mitarbeiter-verwalten              | `docs/handbuch/verwalten/personen.md`                                                        | rewritten                                                        |
| Arbeitszeitmodelle                 | `docs/handbuch/verwalten/arbeitszeitmodelle.md`                                              | rewritten                                                        |
| Urlaubsverwaltung                  | `docs/handbuch/verwalten/abwesenheiten-und-urlaub.md`                                        | rewritten                                                        |
| Rollen-und-Rechte                  | `docs/handbuch/verwalten/rollen-und-rechte.md`                                               | rewritten                                                        |
| Salons-und-Feiertage               | `docs/handbuch/verwalten/salons-und-feiertage.md`                                            | rewritten                                                        |
| Monatsabschluss                    | `docs/handbuch/verwalten/monatsabschluss.md`                                                 | rewritten                                                        |
| Systemeinstellungen                | `docs/handbuch/verwalten/system-und-daten.md`                                                | rewritten (the five-group admin sidebar no longer exists)        |
| Phorest-Integration                | `docs/handbuch/verwalten/phorest.md`                                                         | rewritten                                                        |
| Compliance-und-Revisionssicherheit | `docs/handbuch/hintergrund/compliance.md`                                                    | rewritten, legal statements checked                              |
| FAQ                                | `docs/handbuch/hintergrund/faq.md`                                                           | rewritten                                                        |
| Architecture                       | `docs/entwickler/architecture.md`                                                            | rewritten                                                        |
| Configuration                      | `docs/entwickler/configuration.md`                                                           | rewritten from `apps/api/src/config.ts`                          |
| Database-Migrations                | `docs/migrations.md`                                                                         | merged into the canonical document                               |
| Deployment                         | `docs/deployment.md` and `docs/getting-started.md`                                           | merged                                                           |
| Security-and-CVE-Handling          | `docs/cve-handling.md`                                                                       | merged                                                           |
| _Sidebar                           | `apps/docs/navigation.mjs`                                                                   | replaced                                                         |
