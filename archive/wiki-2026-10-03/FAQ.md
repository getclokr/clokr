# FAQ – Häufige Fragen

Kurze Antworten auf die häufigsten Fragen. Ausführliche Anleitungen stehen im **[[Benutzerhandbuch]]**, **[[Admin-Handbuch]]** und unter **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]**.

## Für Mitarbeitende

### Ich habe vergessen auszustempeln

Solange der Eintrag noch offen ist, öffnen Sie ihn – z. B. über **✎ Bearbeiten** an der Karte „Heutiger Eintrag" auf dem Dashboard oder direkt in **[[Zeiterfassung]]** – und tragen die richtige Endzeit nach. Clokr erinnert Sie dazu automatisch per Benachrichtigung, wenn eine Stempelung länger offen bleibt (Standard: nach 10 Stunden); bleibt sie deutlich länger offen (Standard: 14 Stunden), markiert Clokr den Eintrag als ungültig, und sowohl Sie als auch Ihre Führungskraft werden informiert. Liegt der Tag bereits außerhalb Ihres Selbstbearbeitungsfensters (Standard 10 Tage), reichen Sie die Korrektur stattdessen als **Zeitnachtrag** ein – siehe **[[Zeiterfassung]]**, Abschnitt „Zeiten nachpflegen".

### Warum sehe ich zwischen 8 und 10 Stunden keine Warnung?

Weil das kein Fehler ist. Die 8-Stunden-Grenze des ArbZG ist gesetzlich ein **Durchschnittswert über 24 Wochen / 6 Monate**, keine tägliche Obergrenze. Das harte Tageslimit liegt bei **10 Stunden** – erst darüber warnt bzw. blockiert Clokr. Ein einzelner Tag mit z. B. 9,75 h ist normal und löst keinen Hinweis aus; erst wenn Ihr rollierender 24-Wochen-Durchschnitt 8 h/Werktag übersteigt, reagiert das System. Details: **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]**.

### Warum darf ich pro Tag nur einen Zeiteintrag anlegen?

Clokr erlaubt genau **einen Eintrag pro Tag und Mitarbeiter** – mit beliebig vielen Pausen innerhalb dieses Eintrags. Existiert bereits ein Eintrag, öffnet sich beim „Neuen Eintrag" automatisch das Bearbeitungsformular. Details: **[[Zeiterfassung]]**.

### Warum ist mein Saldo im laufenden Monat niedriger als erwartet?

Der Saldo eines noch offenen Monats ist immer eine **Prognose** – erst der Monatsabschluss macht ihn **„Bestätigt"**. Zwei Dinge wirken sich dabei besonders aus: Tage ohne jeden Eintrag zählen bis zum Abschluss mit vollem Soll und ohne Gutschrift (ein fehlender Tag drückt den Saldo also nach unten, bis er nachgetragen ist), und eine noch unbestätigte Pause oder ein noch offener Zeitnachtrag wirkt sich erst nach der Entscheidung endgültig aus. Details zu Prognose vs. Bestätigt: **[[Zeiterfassung]]**; zum Monatsabschluss selbst: **[[Monatsabschluss]]**.

### Wie storniere ich einen bereits genehmigten Urlaub?

In **Meine Anträge** den genehmigten Antrag öffnen → **Stornieren**. Die Stornierung muss von einer **anderen** Führungskraft bestätigt werden (Vier-Augen-Prinzip) – auch Sie selbst können Ihre eigene Stornierung nicht genehmigen. Solange sie aussteht, bleibt der Urlaub aktiv; Zeiteinträge in diesem Zeitraum werden zunächst als ungültig markiert. Details: **[[Abwesenheiten]]**, **[[Genehmigungen]]**.

### Wo ändere ich mein Passwort?

Profilmenü oben rechts → **Mein Profil**. Dort lassen sich Passwort, Profilbild und WLAN-Geräte verwalten. Details: **[[Erste Schritte|Erste-Schritte]]**.

## Für Manager und Administratoren

### Warum kann ich einen Monat nicht mehr bearbeiten?

Nach dem **Monatsabschluss** ist der Monat gesperrt und **unveränderlich** – auch für Admins (Revisionssicherheit). Änderungen sind nur über **Monat entsperren** (mit Pflichtgrund) + Korrektur + erneuten Abschluss möglich; Korrekturen erzeugen dabei einen neuen Eintrag mit Referenz auf das Original, statt den alten zu überschreiben. Alles wird im Audit-Log protokolliert. Details: **[[Monatsabschluss]]**.

### Wie lösche ich einen Mitarbeiter?

Auf dem Reiter **Danger Zone** der Mitarbeiter-Detailseite auf **Anonymisieren** klicken und im Dialog bestätigen. Clokr löscht dabei **nicht hart**, sondern anonymisiert nach Art. 17 DSGVO: Name, E-Mail, NFC-Karte, Notizen und alle Rollenzuweisungen werden entfernt, das Konto wird deaktiviert. Zeiteinträge, Urlaub und Überstunden **bleiben erhalten** – wegen der gesetzlichen Aufbewahrungspflicht. Eine **endgültige** Löschung des Datensatzes ist erst nach Ablauf dieser Frist möglich (bzw. vorzeitig nur mit Freigabe einer zweiten Administratorin oder eines zweiten Administrators). Details: **[[Mitarbeiter verwalten|Mitarbeiter-verwalten]]**.

### Was passiert bei der Löschung eines Mitarbeiters (DSGVO)?

Siehe vorherige Frage sowie **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]** für die vollständige Übersicht, was anonymisiert wird und was aus Aufbewahrungsgründen erhalten bleibt.

### Wie funktioniert der Phorest-Import?

Über **Admin → Phorest**: Zugangsdaten eintragen, speichern, dann testen; Phorest-Mitarbeiter den Clokr-Mitarbeitenden zuordnen; danach manuell oder automatisch synchronisieren. Der Import ist **einseitig** (Phorest ist führend → Clokr). Nicht zugeordnete Mitarbeiter werden übersprungen. Details: **[[Phorest-Integration]]**.

### Werden Termine oder Kundendaten aus Phorest gespeichert?

Nein. Termine werden nur als **PII-freier, DSGVO-konformer Read-only-Cache** vorgehalten – **ohne** Kundennamen oder Kontaktdaten. Auf dieser Basis erscheinen schreibgeschützte Kollisionswarnungen in den Urlaubs- und Schicht-Flows. Details: **[[Phorest-Integration]]**.

### Was bedeutet der Vor-/Nachbereitungszeit-Puffer?

Der Puffer (0–30 Min., je für Vor- und Nachbereitung) erweitert eine importierte Phorest-Schicht um Vor- und Nachbereitungszeit. Er gilt tenant-global und ist **pro Mitarbeiter** auf der Mitarbeiter-Detailseite überschreibbar. Der gepufferte Roster fließt in den schichtbasierten Saldo (§ 615) ein. Details: **[[Phorest-Integration]]**.

### Was passiert bei einer Kollision zwischen Berufsschule und Phorest-Schicht?

Die **Berufsschule hat Vorrang**: Eine kollidierende Phorest-Schicht wird beim Import übersprungen und im Sync-Verlauf entsprechend ausgewiesen.

### Welche Rollen gibt es?

Jede Person hat genau eine Rolle. Über die Weboberfläche lässt sich zwischen den drei Standardrollen wählen:

- **Administrator** – Vollzugriff (Mitarbeitende, Systemeinstellungen, Audit-Log, Schichten, Import)
- **Manager** – Urlaub genehmigen, Reports einsehen, Schichten verwalten
- **Mitarbeiter** – eigene Zeiteinträge, Urlaubsanträge, Überstundenansicht

Im Hintergrund basiert der Zugriff auf einem feingranularen Berechtigungssystem mit weiteren vordefinierten Rollen-Vorlagen (z. B. für Salon-Leitung oder Personalabteilung) sowie frei zusammenstellbaren eigenen Rollen – dafür steht aktuell noch keine eigene Verwaltungsoberfläche zur Verfügung. Details: **[[Rollen & Rechte|Rollen-und-Rechte]]**.

### Wie lange werden meine Daten aufbewahrt?

Wählbar sind vier feste Fristen: **10 Jahre (GoBD, Standard)**, **6 Jahre (§ 41 EStG Lohnkonten)**, **3 Jahre** oder **2 Jahre (Minimum § 16 ArbZG)** – einstellbar unter **Admin → Audit & Log**. Die Frist startet am Ende des Kalenderjahres der Erstellung; betroffene Daten werden danach jährlich zum Stichtag archiviert. Hintergründe: **[[Compliance und Revisionssicherheit|Compliance-und-Revisionssicherheit]]**.

## Weitere Themen

Nicht fündig geworden? Diese Seiten decken die übrigen Bereiche ab:

- **[[Verfügbarkeit & Schichten|Verfuegbarkeit-und-Schichten]]** – eigene Verfügbarkeit hinterlegen, eingeteilte Schichten einsehen
- **[[Team-Zeiten]]** – Zeiten des Teams einsehen, korrigieren und nacherfassen
- **[[Schichtplanung]]** – Wochenschichten planen, Vorlagen, Coverage
- **[[Reports und Exporte|Reports-und-Exporte]]** – Monatsberichte, Urlaubsübersichten, DATEV-Export
- **[[Arbeitszeitmodelle]]** – Unterschiede zwischen Fester Stundenplan, Gleitzeit, Monatsstunden und Schichtplan
- **[[Urlaubsverwaltung]]** – Jahresurlaub, Übertrag, Sonderurlaub und Betriebsurlaub konfigurieren
- **[[Salons & Feiertage|Salons-und-Feiertage]]** – Bundesland und gesetzliche Feiertage
- **[[Systemeinstellungen]]** – Admin-Bereich im Überblick, Branding, CSV-Import, Audit-Log

## Betrieb

### Wie pinne ich eine bestimmte Version?

Setzen Sie in der `.env` die Variablen `CLOKR_API_IMAGE` und `CLOKR_WEB_IMAGE` auf ein konkretes Image mit Versions-Tag (GHCR-Tags haben **kein** führendes „v", z. B. `1.12.0`) und starten Sie die Container neu. Details: **[[Deployment]]**.

### Wo finde ich die technische Dokumentation zum Betrieb?

Im englischen Technical-Reference-Teil: **[[Deployment]]**, **[[Configuration]]**, **[[Database Migrations|Database-Migrations]]**, **[[Security and CVE Handling|Security-and-CVE-Handling]]** und **[[Architecture]]**.
