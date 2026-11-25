# Phorest-Integration

Die Phorest-Integration importiert Schichten aus der Salon-Software **Phorest** in Clokr. Der Import ist **einseitig**: Phorest ist die führende Quelle (Master), Clokr übernimmt die Daten. Ein Rückschreiben von Abwesenheiten nach Phorest ist **nicht** implementiert.

Die Konfiguration liegt im eigenen Admin-Tab **Admin → Phorest** – getrennt vom Tab „Integrationen" (WLAN-Präsenz).

## Verbindung

Tragen Sie die Zugangsdaten Ihres Phorest-Accounts ein:

- **Business ID**
- **Branch ID** – bei genau einem aktiven Salon im Mandanten ist das Feld hier direkt editierbar. Gibt es **mehrere** aktive Salons, ist es gesperrt (Hinweistext „Mehrere aktive Salons — die Phorest-Filiale wird je Salon gekoppelt."); die Kopplung läuft dann außerhalb dieser Seite – wenden Sie sich in diesem Fall an Ihre IT bzw. den Clokr-Support.
- **API-Benutzername (E-Mail)**
- **API-Passwort** – aus Sicherheitsgründen nie vorbefüllt; leer lassen, um das gespeicherte Passwort zu behalten

**So geht's:**

1. Felder ausfüllen und auf **Zugangsdaten speichern** klicken
2. Erst danach lässt sich die Verbindung über **Verbindung testen** prüfen – der Button bleibt gesperrt, solange noch keine Konfiguration gespeichert ist

## Import-Einstellungen

- **Vor-/Nachbereitungszeit** (Felder **Vorbereitungszeit (Min.)** / **Nachbereitungszeit (Min.)**, je 0–30 Min.) – erweitert eine importierte Schicht um Vor- und Nachbereitungszeit, tenant-global. Lässt sich **pro Mitarbeiter** im Abschnitt **Phorest Vor-/Nachbereitungszeit (Optional)** auf dem Reiter **Arbeitszeit** der Mitarbeiter-Detailseite überschreiben (hat Vorrang vor dem globalen Wert).
- **Zeitfenster (Tage)** – wie weit in die Zukunft Schichten importiert werden (Standard: 7 Tage, 1–90 Tage einstellbar). Gilt für den automatischen und den manuellen Sync gleichermaßen.
- **Automatischer Sync** – Schalter **Auto-Sync aktivieren** mit wählbarem **Zeitplan**: Täglich um 03:00 (Standard), Alle 6 Stunden, Alle 2 Stunden oder Wöchentlich (Montag 00:00).

Mit **Einstellungen speichern** übernehmen.

## Mitarbeiter-Zuordnung

Phorest-Mitarbeiter werden mit Clokr-Mitarbeitenden verknüpft; die Zeile schlägt dabei automatisch eine passende Zuordnung vor. **Nicht zugeordnete** Phorest-Mitarbeiter werden beim Sync übersprungen – ordnen Sie alle relevanten Personen zu, damit ihre Schichten importiert werden.

## Synchronisation

Der Sync läuft **manuell** über **Jetzt synchronisieren** (optional mit einem eigenen Zeitraum **Von**/**Bis**, sonst gilt das eingestellte Zeitfenster) oder **automatisch** (Auto-Sync). Der Verlauf zeigt je Lauf:

- **Status** – Erfolg / Fehler / Verdächtig
- Anzahl **importierter**, **aktualisierter**, **ersetzter** und **abgesagter** Schichten
- Anzahl wegen **Berufsschule übersprungener** und Anzahl **ohne Zuordnung** gebliebener Schichten

Der Status **Verdächtig** erscheint, wenn ein Lauf ein leeres Ergebnis liefert, obwohl zuvor aktive Phorest-Schichten vorlagen – ein Schutz gegen eine versehentliche Massenabsage durch eine fehlerhafte Anbindung. In diesem Fall werden **keine** Schichten abgesagt.

### Berufsschule schlägt kollidierende Schicht

Kollidiert eine Phorest-Schicht mit einer Berufsschul-Abwesenheit in Clokr, hat die Berufsschule Vorrang – die Schicht wird beim Import übersprungen.

## Termine (Appointments) – PII-freier Read-only-Cache

Termine aus Phorest werden ausschließlich als **DSGVO-konformer, PII-freier Read-only-Cache** vorgehalten. Es werden **keine** Kundennamen, Leistungen, Preise oder sonstige Kontaktdaten gespeichert – nur Mitarbeiter, Datum und Uhrzeit. Auf Basis dieses Caches erscheinen **schreibgeschützte Kollisionswarnungen** in den Urlaubs- und Schicht-Flows; Clokr verändert dabei nichts in Phorest. Ist der Cache gerade nicht erreichbar, blockiert das die Genehmigung eines Antrags oder das Anlegen einer Schicht nicht – die Warnung entfällt dann lediglich.

## §615-Hinweis (Roster-Soll)

Aus Phorest importierte Schichten – inklusive der Vor-/Nachbereitungszeit-Puffer – erweitern den Roster-Soll des jeweiligen Salons und fließen in den schichtbasierten Saldo (§ 615 Annahmeverzug) ein. Mehr zur rechtlichen Einordnung steht unter **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]**.

## Was Phorest **nicht** tut

- Kein Rückschreiben von Abwesenheiten (Urlaub/Krankheit) nach Phorest
- Keine Speicherung personenbezogener Termindaten (nur PII-freier Cache)
- Keine Änderung von Schichten in Phorest – der Fluss ist strikt Phorest → Clokr

---

Weiter: **[[Admin-Handbuch]]** · **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]**
