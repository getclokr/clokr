# Compliance & Revisionssicherheit

Clokr ist als **revisionssichere** Zeiterfassung für den deutschen Rechtsraum konzipiert. Diese Seite fasst die implementierten gesetzlichen Prüfungen und Aufbewahrungsregeln zusammen.

> **Disclaimer:** Diese Dokumentation beschreibt den implementierten Stand von Clokr (v1.12.0). Sie ersetzt keine rechtliche Beratung. Tenants sind selbst für die korrekte Konfiguration verantwortlich (Aufbewahrungsfristen, Bundesland je Salon, Arbeitszeitmodelle, Betriebsvereinbarungen).

## Revisionssicherheit (Grundprinzipien)

1. **Keine Hard-Deletes** von Zeiteinträgen, Urlaubsanträgen, Abwesenheiten oder Mitarbeiterdaten – stattdessen Soft-Delete (`deletedAt`) oder Statuswechsel.
2. **Vollständiger Audit-Trail:** Jede Änderung (Anlegen/Ändern/Löschen) wird protokolliert mit Benutzer, Zeitstempel, IP-Adresse, User-Agent sowie Vor- und Nachher-Werten.
3. **Gesperrte Monate sind immutabel:** Nach dem Monatsabschluss sind Einträge nicht mehr editier- oder löschbar – auch nicht durch Admins.
4. **Keine stillen Überschreibungen:** Korrekturen an gesperrten/finalisierten Einträgen erzeugen einen neuen Korrektureintrag mit Referenz auf das Original.
5. **Nachvollziehbarkeit:** Es ist jederzeit rekonstruierbar, wer was wann und warum geändert hat.

Das Audit-Log ist unter **Admin → Audit** einsehbar und selbst nicht editier- oder löschbar.

## ArbZG – Arbeitszeitprüfungen

Clokr prüft jeden Zeiteintrag automatisch. Warnungen **blockieren das Speichern nicht** (Audit-Hinweis statt Hard-Block, damit Korrektur-Workflows möglich bleiben); der Verstoß wird im Audit-Log dokumentiert.

| Paragraph | Regel                                                                    | Schweregrad |
| --------- | ------------------------------------------------------------------------ | ----------- |
| **§ 3**   | Tägliche Höchstarbeitszeit netto **10 h absolut**                        | Fehler      |
| **§ 3**   | 8h-Regel = **24-Wochen-/6-Monats-Durchschnitt**, **kein** Tageslimit     | Warnung     |
| **§ 3**   | Wöchentliche Höchstarbeitszeit **48 h** (Mo–Sa = 6 Werktage)             | Fehler      |
| **§ 4**   | Bei > 6 h Arbeit: min. **30 min** Pause                                  | Warnung     |
| **§ 4**   | Bei > 9 h Arbeit: min. **45 min** Pause                                  | Fehler      |
| **§ 5**   | **11 h Mindestruhe** zwischen Arbeitsende und nächstem Beginn            | Warnung     |

> **Wichtig zur 8h-Regel:** Ein Tag mit 8–10 h ist **nicht** automatisch illegal. Die 8-Stunden-Grenze des ArbZG ist ein **Durchschnitt über 24 Wochen / 6 Monate**. Eine 4-Tage-Woche mit 39 h (≈ 9,75 h/Tag) ist zulässig. Clokr warnt daher erst, wenn der rollierende 24-Wochen-Durchschnitt 8 h/Werktag übersteigt – nicht für einzelne Tage zwischen 8 und 10 h.

Optional kann pro Tenant **Auto-Break** aktiviert werden: Ist beim Ausstempeln keine manuelle Pause eingetragen, ergänzt Clokr automatisch 30 min (> 6 h) bzw. 45 min (> 9 h). Sobald eine Pause eingetragen ist, greift Auto-Break nicht – es erscheint nur die ArbZG-Warnung.

## BUrlG – Urlaub, Übertrag & Verfall

- **§ 3 Mindesturlaub:** `Arbeitstage/Woche × 4` (5-Tage-Woche = 20 Tage, 6-Tage-Woche = 24 Tage, 4-Tage-Woche = 16 Tage). Bei Teilzeit wird der Anspruch automatisch reduziert.
- **§ 7 Abs. 3 Übertrag:** Urlaub muss im Kalenderjahr genommen werden. Übertrag ins Folgejahr nur mit dokumentiertem Grund (Krankheit, betriebliche Notwendigkeit). Verfall am **31. März** des Folgejahres (pro Tenant konfigurierbar).
- **Langzeitkrankheit:** Übertrag bis zu 15 Monate (EuGH C-214/10 „KHS").
- **Hinweispflicht (EuGH C-684/16):** Ohne dokumentierten Hinweis verfällt Urlaub gesetzlich **nicht**. Clokr versendet automatische Reminder (ab einem konfigurierbaren Monat, spätestens Dezember, mit frei wählbaren Schwellwerten in Tagen vor Verfall) und protokolliert jeden Reminder.
- **Cross-Year Booking:** Urlaub über den Jahreswechsel (z. B. 30.12.–5.1.) wird automatisch auf beide Jahre gesplittet und separat geprüft; eine Stornierung dreht beide Jahre zurück.
- **§ 5 Abs. 2 BUrlG (Austritt):** Bei Austritt nach dem 30. Juni voller Jahresanspruch statt Zwölftelung.

### Urlaub ↔ Zeiterfassung

| Urlaubsstatus            | Zeiteintrag erlaubt?          | Verhalten                                                                  |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------- |
| Ausstehend (pending)     | ja                            | normaler Eintrag möglich                                                   |
| Genehmigt                | **nein** (Hard-Block)         | Mitarbeiter muss erst Stornierung beantragen                              |
| Stornierung angefragt    | ja, aber als **ungültig**     | Hinweis „Urlaubsstornierung ausstehend"; zählt nicht im Saldo             |
| Storniert                | ja, Auto-Revalidierung        | zuvor ungültige Einträge werden automatisch gültig                        |

Stornierungen erfordern das **Vier-Augen-Prinzip**: Bestätigung durch einen **anderen** Manager (Selbst-Genehmigung ist blockiert). Details zum Ablauf: **[[Genehmigungen]]**.

## Feiertage

Ein gesetzlicher Feiertag gilt an dem Ort, an dem an diesem Tag gearbeitet wurde (§ 2 EFZG). Das Bundesland ist daher am **Salon** hinterlegt, nicht am Mandanten – jeder Mandant erhält dafür automatisch mindestens einen Salon. Das Bundesland eines Salons lässt sich nur ändern, solange ihm noch keine Zeiteinträge zugeordnet sind; ein Umzug ist ein neuer Salon. Manuell angelegte Feiertage gehören ebenfalls zu einem Salon. Zur Konfiguration siehe **[[Salons und Feiertage|Salons-und-Feiertage]]**.

## Vier-Augen-Prinzip

Mehrere sicherheitsrelevante Aktionen sind in Clokr bewusst nicht durch eine einzelne Person allein möglich:

- **Stornierung eines genehmigten Urlaubsantrags:** Weder Antragsteller noch der ursprüngliche Genehmiger dürfen die Stornierung selbst freigeben.
- **Endgültiges Löschen eines Mitarbeiters** innerhalb der laufenden Aufbewahrungsfrist verlangt die Freigabe durch eine zweite, andere Administratorin bzw. einen zweiten Administrator (siehe „DSGVO" unten).
- **Rollenzusammenstellung:** Enthält eine Rolle nach dem Speichern zugleich das Recht, eigene Zeiten zu ändern, und das Recht, Zeitnachträge anderer zu genehmigen, verlangt das Speichern eine ausdrückliche Bestätigung – sonst könnte dieselbe Rolle Arbeitszeiten sowohl erfassen als auch selbst freigeben.

Details zu Rollen, Rechten und dem Aussperrschutz: **[[Rollen & Rechte|Rollen-und-Rechte]]**.

## DSGVO – Datenschutz & Anonymisierung

### Art. 17 – „Recht auf Vergessenwerden"

Mitarbeiter werden **anonymisiert, nicht hart gelöscht**:

| Feld                                            | Anonymisierung                            |
| ----------------------------------------------- | ------------------------------------------ |
| Vorname                                         | „Gelöscht"                                |
| Nachname, Personalnummer                        | „GELÖSCHT-XXX"                            |
| NFC-Karte                                       | entfernt                                  |
| E-Mail                                          | anonymisiert                              |
| Passwort, Login                                 | anonymisiert, deaktiviert                 |
| Rolle                                           | auf Mitarbeiter zurückgesetzt              |
| Rollenzuweisungen                                | alle entfernt, mit Protokolleintrag je Zuweisung |
| Notizen (Zeiteinträge, Urlaub, Abwesenheiten)   | entfernt                                  |
| Dokumente (Abwesenheiten, § 9-Vorgänge)         | entfernt (Datei aus Objektspeicher)       |
| Einladungen, OTP, Refresh-Tokens                | hart gelöscht (nicht aufbewahrungspflichtig) |
| Audit-Log (Benutzerbezug)                       | anonymisiert, **nicht** gelöscht (Audit-Pflicht) |

**Erhalten bleiben** (gesetzliche Aufbewahrungspflicht): Zeiteinträge, Urlaubsanträge, Abwesenheiten, Schichten, Überstundenkonto und Saldo-Snapshots.

Die Aktion selbst heißt in der Oberfläche **Anonymisieren** (Reiter **Danger Zone** der Mitarbeiter-Detailseite). Erst nach Ablauf der Aufbewahrungsfrist lässt sich ein bereits anonymisierter Datensatz über **Endgültig löschen** vollständig entfernen; eine vorzeitige endgültige Löschung verlangt zusätzlich das oben beschriebene Vier-Augen-Prinzip. Details: **[[Mitarbeiter verwalten|Mitarbeiter-verwalten]]**.

### Art. 6 – WLAN-Präsenz (Einwilligung)

WLAN-basiertes Auto-Stempeln ist **opt-in** pro Mitarbeiter (Default aus). Der Einwilligungszeitpunkt wird als Beleg festgehalten (auch nach Widerruf). Mitarbeitende können jederzeit unter **Mein Profil → Meine Geräte** widerrufen. Präsenz-Events ohne Zeiteintrag (unbekannte MAC-Adresse, außerhalb Zeitfenster, keine Schicht, Opt-out) werden standardmäßig nach 90 Tagen automatisch gelöscht (Speicherbegrenzung, Art. 5 Abs. 1 lit. e DSGVO).

## Aufbewahrungsfristen (Deutschland)

| Grundlage                            | Frist        | Norm                 |
| ------------------------------------ | ------------ | --------------------- |
| Arbeitszeitnachweis                  | 2 Jahre      | § 16 Abs. 2 ArbZG    |
| Lohnkonten                           | 6 Jahre      | § 41 EStG            |
| Buchungsbelege (lohnsteuerrelevant)  | **10 Jahre** | § 147 AO / § 257 HGB |

**In Clokr** wählen Sie unter **Admin → Audit & Log → Aufbewahrung** eine von vier festen Optionen: **10 Jahre (GoBD, Standard)**, **6 Jahre (§ 41 EStG Lohnkonten)**, **3 Jahre** oder **2 Jahre (Minimum § 16 ArbZG)**.

- Die Frist startet **am Ende des Kalenderjahres** der Erstellung.
- Nach Ablauf werden betroffene Zeiteinträge, Urlaubsanträge und Abwesenheiten **archiviert (Soft-Delete)** – nicht rollierend, sondern einmal jährlich zum Stichtag (Anfang Januar, für Datensätze, deren Frist am 31.12. abgelaufen ist). Aggregierte Salden (Monatsabschluss-Snapshots) bleiben davon unberührt; die Archivierung setzt voraus, dass für den betroffenen Zeitraum bereits ein Snapshot existiert.

## Phorest-Schichtimport & §615

Aus Phorest importierte Schichten können den Roster-Soll um eine Vor-/Nachbereitungszeit erweitern (tenant-global, pro Mitarbeiter überschreibbar). Dieser gepaddete Roster fließt in den schichtbasierten Saldo (§ 615 Annahmeverzug) ein. Berufsschul-Abwesenheiten haben Vorrang vor kollidierenden Phorest-Schichten (die Schicht wird beim Import übersprungen). Die Phorest-Kopplung gilt je Salon; der Import ist einseitig (Phorest führend), ein Rückschreiben nach Phorest findet nicht statt. Details siehe **[[Phorest-Integration]]**.

---

Weiter: **[[Admin-Handbuch]]** · **[[Benutzerhandbuch]]** · **[[FAQ]]**
