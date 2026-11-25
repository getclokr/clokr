# Glossar — binding vocabulary of the web app (Issue #574)

## 1. Purpose and scope

This glossary is binding for every text the web app shows — everything under `apps/web/src/routes`
and `apps/web/src/lib`: page and section titles, labels, hints, empty states, dialogs, toasts and
error messages written in the web app. Its machine-checkable half is the lint
`pnpm --filter @clokr/web lint:ui-terms` (`apps/web/scripts/lint-ui-terms.mjs`), which runs in CI
and in the pre-commit hook.

The German texts of the API follow the same rules — error messages, notifications, e-mail
templates and PDF texts under `apps/api/src`. Their gate is `pnpm --filter @clokr/api run
lint:api-terms` (`apps/api/scripts/lint-api-terms.ts`, Issue #861), which imports the term list of
`lint:ui-terms` instead of copying it and reads only German text (English Swagger descriptions, log
lines and raw SQL stay out). In the API, „Mandant“ is allowed only in texts of the operator console
and in DATEV's field name „Mandantennummer“; „Phorest“ only in Schichtplanung, the integration and
the permission names of the role editor. A permission key such as `role-assignment:manage` is never
part of a text: the API gate names the permission in words.

The Handbuch — `docs/index.md` and everything under `docs/handbuch` — follows the same rules (Issue
#1064). Its gate is `pnpm run lint:docs-terms` (`scripts/lint-docs-terms.mjs`), which imports the
term list of `lint:ui-terms` instead of copying it, runs in CI and in the pre-commit hook, and adds
the checks only a manual needs: no app URL in text, no „Admin → Salons“ arrow path, and every
„Bereich › Seite › …“ menu path must exist in `apps/web/src/lib/nav/routes.ts`, so a renamed page
fails the lint until the Handbuch follows. „Phorest“ is allowed only under `docs/handbuch/verwalten/`
and on the team Dienstplan page; „Flag“, „Generator“ and „Audit-Spur“ are forbidden in the whole
Handbuch. Fenced code, HTML comments and link URLs are not read; inline code is, because the
Handbuch shows it.

## 2. Address form: „du“

- The app always addresses the reader with **du** — lowercase: du, dich, dir, dein, deine. A team
  or a company is addressed with „du“ too („in deinem Unternehmen“), never as „ihr / euch / eure“
  (Issue #946, which replaced the earlier „ihr / euch“ for teams of 19.10.2026).
- Never „Sie / Ihnen / Ihr“. Where „Sie“ means „she / it / they“ at the start of a sentence, the
  sentence is rephrased with the noun instead („Die Regel bleibt nachvollziehbar.“), so the lint
  needs no exception list.
- Buttons say what happens — verb and object: „Vertrag speichern“, „Antrag genehmigen“. This is a
  guideline, not a lint rule; the redesign tickets apply it page by page.

- **Verbs for creating** (Issue #946). „anlegen“ creates master data that stays and is managed:
  Person, Salon, Rolle, Vorlage, Regel, Feiertag, Betriebsurlaub. „eintragen“ records what happened
  or is planned for a time: Zeit, Abwesenheit (and „nachtragen“ for a Zeitnachtrag). „erstellen“ is
  for generated artefacts (Schlüssel, Export, Bericht), „hinzufügen“ only for adding an item to an
  existing list (a person to a Betriebsurlaub list, a salon to a person). „einladen“ is never the verb
  of a create dialog — an invitation is a step inside „Person anlegen“. Review rule, not a lint rule:
  the verbs cannot be told apart mechanically without false positives.
- Counts go through `countWord()` (`apps/web/src/lib/utils/count-word.ts`): „1 Monat“, „2 Monate“,
  never „1 Monate“. A sentence never uses the same word twice in a row („ohne … ohne“).

Examples:

| Instead of                                 | Write                                    |
| ------------------------------------------ | ---------------------------------------- |
| „Bitte versuchen Sie es erneut.“           | „Bitte versuch es noch einmal.“          |
| „Für diese Seite fehlen Ihnen die Rechte.“ | „Für diese Seite fehlen dir die Rechte.“ |
| „Geben Sie Ihre E-Mail-Adresse ein.“       | „Gib deine E-Mail-Adresse ein.“          |

## 3. Binding terms

| Use                                                | Never                                         | Note                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unternehmen                                        | Tenant, Mandant                               | „Mandant“ only in the operator console `/betreiber` (the operator is the reader) and in DATEV's own field „Mandantennummer“.              |
| Mitarbeitende (plural); Mitarbeiterin, Mitarbeiter | MA                                            | „Person“ where the role does not matter.                                                                                                  |
| Salon, Stammsalon                                  |                                               | The Stammsalon decides leave and holidays of a person.                                                                                    |
| Springerin, Springer                               |                                               | A person who works in more than one salon.                                                                                                |
| Abwesenheiten                                      |                                               | The umbrella for leave, sickness, Berufsschule and other absences.                                                                        |
| Urlaub                                             |                                               | Vacation only — not a synonym for Abwesenheiten.                                                                                          |
| Arbeitszeitmodell, Vertrag                         | Schedule, Schedule-Version                    | The four models: **Feste Arbeitszeit**, **Gleitzeit**, **Monatsstunden**, **Nach Schichtplan**.                                           |
| Besetzung, Mindestbesetzung                        | Coverage                                      |                                                                                                                                           |
| Summe, gesamt                                      | Σ, Sigma                                      |                                                                                                                                           |
| Protokoll                                          | Audit & Log                                   | The page of the audit trail.                                                                                                              |
| Aufgaben                                           | Inbox                                         | The one page where requests are decided.                                                                                                  |
| Kritische Aktionen                                 | Danger Zone                                   | The section of irreversible actions.                                                                                                      |
| Eintrag, Antrag, Datensatz …                       | Entität                                       | Name the thing.                                                                                                                           |
| Dienstplan (Regeln)                                |                                               | The Regeln page `/verwalten/regeln/dienstplan` (templates, coverage rules, patterns). Formerly „Schichteinstellungen“.                    |
| Schichtplanung                                     |                                               | The team page `/shifts` (the weekly plan).                                                                                                |
| Arbeitszeit & Verträge (Regeln)                    |                                               | The Regeln page `/verwalten/regeln/arbeitszeit` (Pausen, Arbeitstage, Standard-Arbeitszeit …; Issue #854).                                |
| Abwesenheiten (Regeln)                             |                                               | The Regeln page `/verwalten/regeln/abwesenheiten` with the tabs Urlaub, Sonderurlaub, Übertrag, Betriebsurlaub, Urlaubsgrenzen & Sperren. |
| Monatsabschluss (Regeln)                           |                                               | The two closing settings; the close itself is the page `/verwalten/monatsabschluss` (Issue #854).                                         |
| Benachrichtigungen & E-Mail                        | Mail-Einstellungen                            | The Regeln page for the e-mail server, notification mails and reminders (Issue #854).                                                     |
| Export                                             | DATEV (as a page name)                        | The one page `/verwalten/daten/export` that starts every export; „DATEV-Export“ names the file (Issue #854).                              |
| Zugang                                             | Login-Daten                                   | The tab of a person for sign-in, role and deactivation (Issue #854).                                                                      |
| Läuft noch, Zukunft                                |                                               | Monatsabschluss: the current month has not ended („Läuft noch“), a later one is „Zukunft“ (Issue #854).                                   |
| Verwalten › Salons (a link to the page)            | Admin → Salons                                | A pointer to another page names its path in the navigation (Issue #854).                                                                  |
| plain words                                        | enum values, error codes, env variables       | Never `SHIFT_BASED`, `TRACK_ONLY`, `PAIRING_ENABLED` in a text.                                                                           |
| Phorest                                            |                                               | Only in Verwaltung, Schichtplanung and the operator console — never in texts for Mitarbeitende.                                           |
| say what is compared                               | Korrelation                                   | Schichtplanung: „Geplant / Vertrag“ (Issue #850).                                                                                         |
| Hinweis, markiert                                  | Konflikt-Flag, Flag                           | Schichtplanung: a shift or week that needs a look (Issue #850; lint-checked only there).                                                  |
| Muster anwenden                                    | Generator, generieren                         | Applies the Schicht-Muster to a week. „Vorlagen“ are the shift templates — a different thing (Issue #850).                                |
| wird protokolliert                                 | Audit-Spur                                    | Schichtplanung (Issue #850).                                                                                                              |
| Personen                                           |                                               | Team › Personen: the read view of the team for leaders. Editing persons stays in Verwalten › Personen (Issue #853).                       |
| Pausenbefund                                       |                                               | An open break finding of a person's day; it is decided on Zeiten (Issue #853).                                                            |
| Woche, Bedarf, Hinweise, Verfügbarkeit             |                                               | The four tabs of Dienstplan (Issue #853); the page itself is always „Dienstplan“.                                                         |
| Personenkreis, Alle Salons                         |                                               | The filter of Team › Abwesenheiten: your own circle by default, „Alle Salons“ adds the others (Issue #853).                               |
| Wie Gerät                                          | System, Automatisch                           | The mode option that follows the device's light/dark setting (Issue #975); review rule, no lint term.                                     |
| Standard des Unternehmens                          | Standard des Betriebs, Standard des Mandanten | The Farbwelt option that returns to the Standard-Farbwelt the Unternehmen set (Issue #976); review rule, no lint term.                    |

Spelling: CSV-Import, DATEV-Export (hyphenated compounds), WLAN.

## 4. Page names

Every page has one name, defined once in the route table `apps/web/src/lib/nav/routes.ts` (read through
`page-labels.ts`, Issue #844). The sidebar, the mobile „Mehr“ sheet, the quick search (⌘K), the breadcrumb in the
top bar and the page's H1 all read it — the H1 is the menu name. The areas are „Ich“, „Team“ and „Verwalten“. The
mobile tab bar uses the page names too, without short forms (Issue #945); a long name may break onto a second
line at the soft hyphen its table entry gives (`labelBreaks`). The names are deliberately not repeated here: the
module is the one source.

## 5. What the lint checks — and what it cannot

| Lint term id    | Glossary row                           |
| --------------- | -------------------------------------- |
| `tenant`        | Unternehmen                            |
| `mandant`       | Unternehmen (operator console exempt)  |
| `ma`            | Mitarbeitende                          |
| `code-value`    | plain words                            |
| `danger-zone`   | Kritische Aktionen                     |
| `coverage`      | Besetzung                              |
| `sigma`         | Summe                                  |
| `korrelation`   | say what is compared                   |
| `entitaet`      | name the thing                         |
| `schedule`      | Arbeitszeitmodell                      |
| `inbox`         | Aufgaben                               |
| `phorest`       | Phorest (area-scoped)                  |
| `flag`          | Hinweis (Schichtplanung only)          |
| `generator`     | Muster anwenden (Schichtplanung only)  |
| `audit-spur`    | wird protokolliert (Schichtplanung)    |
| `sie-form`      | Address form „du“                      |
| `ihr-form`      | Address form „du“ (euch, eure, euer)   |
| `url-path`      | Menu path, no app URL (docs only)      |
| `old-menu-path` | „Bereich › Seite“, not „→“ (docs only) |
| `menu-path`     | Page names of `routes.ts` (docs only)  |

`lint:api-terms` adds one term of its own: `permission-key` (no permission key in a text).

Limits: the lint cannot tell the plural „Mitarbeiter“ from the singular and does not judge button
wording. The API gate recognises German text by umlauts, function words and word endings, so a
German text without any of them is not read. Those are review questions.
