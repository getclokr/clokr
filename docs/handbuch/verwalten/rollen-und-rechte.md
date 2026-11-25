# Rollen und Rechte

In Clokr entscheiden **Rollen**, wer was sehen und ändern darf. Eine Rolle bündelt Rechte. Du weist sie einer Person zu und legst fest, **wo** sie gilt: im ganzen Unternehmen, in ausgewählten Salons oder für ausgewählte Personen. Die Seite dazu ist **Verwalten › System › Rollen & Rechte**.

## Rollen und Geltungsbereich

Jede Person hat eine oder mehrere **Zuweisungen**. Eine Zuweisung besteht aus einer Rolle und einem **Geltungsbereich**:

- **Ganzes Unternehmen**
- **Ausgewählte Salons**
- **Ausgewählte Personen**

Der Geltungsbereich gehört zur Zuweisung, nicht zur Rolle. Dieselbe Rolle kann eine Person im ganzen Unternehmen haben und eine andere nur für einen Salon. Manche Rechte wirken nur bei einer Zuweisung für das ganze Unternehmen. Der Rollen-Editor markiert sie mit „wirkt nur bei Zuweisung für das ganze Unternehmen“, der Zuweisungsdialog weist darauf hin.

::: warning Achtung
Wer keine Rolle hat, kann sich nicht anmelden.
:::

## Die Systemrollen

Clokr bringt sieben Systemrollen mit. Diese Rollen sind fest, du siehst sie, kannst sie aber nicht ändern oder löschen. Willst du eine abgewandelte Fassung, **kopierst** du die Rolle und passt die Kopie an.

| Rolle                 | Wofür sie gedacht ist                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mitarbeiter**       | die eigenen Daten: eigene Zeiten, Abwesenheiten, Dienstplan und Konto                                                                                                |
| **Manager**           | Anträge und Zeitnachträge entscheiden, Team-Ansichten, Berichte, Schichtplanung                                                                                      |
| **Admin**             | die Verwaltung des Unternehmens: Personen, Regeln, Daten und System                                                                                                  |
| **Inhaber**           | alle Rechte                                                                                                                                                          |
| **Salonmanager**      | die Führung eines oder mehrerer Salons: Zeiten, Anträge, Dienstplan und Urlaubsplanung des Salons. Verträge, Saldo, Monatsabschluss und Berichte gehören nicht dazu. |
| **Personalabteilung** | Personen-, Vertrags- und Urlaubsdaten sowie Berichte lesen. Die Tageszeiten der Personen gehören nicht dazu.                                                         |
| **Ausbilder**         | für Ausbilderinnen und Ausbilder, vergeben für ausgewählte Personen                                                                                                  |

Wer als Salonmanager, Personalabteilung oder Ausbilder selbst arbeitet, bekommt zusätzlich die Rolle Mitarbeiter für die eigenen Daten.

## Rollen zuweisen

Die Seite hat zwei Reiter, je nachdem was du darfst: **Rollen** und **Zuweisungen**.

Auf dem Reiter **Zuweisungen** siehst du alle Personen mit ihren Rollen. So weist du eine Rolle zu:

1. Suche die Person und öffne ihre Zuweisung.
2. Wähle die **Rolle** im Dialog „Rolle zuweisen“ („Zuweisung ändern“ bei einer bestehenden).
3. Wähle den **Geltungsbereich**. Bei „Ausgewählte Salons“ wählst du die Salons, bei „Ausgewählte Personen“ suchst du die Personen.
4. Speichere.

Du findest dieselbe Zuweisung auch bei der Person selbst: auf dem Reiter **Zugang** unter **Verwalten › Personen**. Beim Anlegen einer Person wählst du die Rollen im Schritt „Salon & Rolle“, siehe [Personen](personen.md). Mehrere Personen auf einmal bekommen eine Rolle über die Auswahl in der Personenliste.

<!-- SCREENSHOT file=bilder/rollen-und-rechte-01.png role=admin url=/verwalten/system/rollen show="Rollen und Rechte mit dem Reiter Zuweisungen: Personen mit ihren Rollen" -->

## Eigene Rollen anlegen

Auf dem Reiter **Rollen** stehen die Systemrollen und die eigenen Rollen deines Unternehmens, jeweils als „Systemrolle“ oder „Eigene Rolle“ gekennzeichnet.

1. Klicke auf **Neue Rolle** (oder kopiere eine vorhandene).
2. Gib der Rolle einen **Namen**.
3. Wähle die Rechte. Die Liste ist nach Themen gruppiert und im Klartext beschriftet.
4. Speichere.

Eine eigene Rolle kannst du später ändern und löschen, solange sie niemandem zugewiesen ist. Ohne das Recht, Rollen zu verwalten, kannst du sie nur ansehen.

## Schutzregeln

- **Vier-Augen-Prinzip**: Eine Rolle, die zugleich erlaubt, **eigene Zeiten zu ändern** und **Zeitnachträge anderer zu genehmigen**, verlangt beim Speichern eine ausdrückliche Bestätigung („Vier-Augen-Prinzip bestätigen“). Sonst könnte dieselbe Rolle Zeiten erfassen und selbst freigeben. Auch eigene Anträge kann niemand selbst genehmigen, egal welche Rolle.
- **Aussperrschutz**: Clokr lehnt eine Änderung ab, nach der niemand mehr Rollen verwalten könnte.
- **Endgültiges Löschen** einer Person innerhalb der Aufbewahrungsfrist braucht die Freigabe einer zweiten Administratorin oder eines zweiten Administrators, siehe [Personen](personen.md#löschen-heißt-anonymisieren).
- Jede Änderung an Rollen und Zuweisungen wird protokolliert, siehe das Protokoll unter **Verwalten › Daten › Protokoll**.
