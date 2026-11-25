# System und Daten

Diese Seite führt durch die Seiten, mit denen du das Unternehmen als Ganzes einrichtest und mit Daten arbeitest: **Verwalten › System** (Allgemein, Integrationen), **Verwalten › Daten** (CSV-Import, Export, Protokoll, Support-Zugriffe) und die Regeln für Benachrichtigungen und Dienstplan. Rollen und Rechte, Personen, Salons und Urlaubsregeln haben eigene Seiten, die Anbindung an Phorest ebenfalls.

::: tip Hinweis
Das Erscheinungsbild gehört nicht mehr zur Verwaltung. Farbwelt und Modus wählt jede Person für sich unter **Ich › Profil › Erscheinungsbild**. Ein Erscheinungsbild für das ganze Unternehmen gibt es nicht.
:::

## System

### Allgemein

**Verwalten › System › Allgemein**

Die Seite hat vier Abschnitte, die du einzeln speicherst:

- **Unternehmen & Region**: der **Firmenname** (er steht als Überschrift in PDF-Exporten), die **Bundesland**-Vorgabe für neu angelegte Salons und die **Zeitzone**. Die Feiertage richten sich nach dem Bundesland des jeweiligen Salons, siehe [Salons und Feiertage](salons-und-feiertage.md).
- **Zwei-Faktor-Authentifizierung**: Ist **Zwei-Faktor-Authentifizierung per E-Mail verlangen** eingeschaltet, schickt Clokr nach der Anmeldung einen 6-stelligen Code per E-Mail. Der Schalter gilt sofort für das ganze Unternehmen.
- **Passwort-Richtlinie**: **Mindestlänge** und ob Großbuchstabe, Kleinbuchstabe, Ziffer und Sonderzeichen erforderlich sind. Das BSI empfiehlt mindestens 12 Zeichen.
- **Sitzungen**: die Dauer einer Anmeldung mit und ohne „Angemeldet bleiben“, Timeouts bei Inaktivität und wie viele falsche Anmeldungen zu einer vorübergehenden Sperre führen.

### Integrationen

**Verwalten › System › Integrationen**

Die Seite hat fünf Reiter:

- **WLAN-Anwesenheit**: Jeder WLAN-Adapter meldet sich mit einem eigenen Schlüssel an. Unter **Präsenz-Quellen** legst du mit **Quelle anlegen** einen Schlüssel an und widerrufst ihn bei Bedarf. Der Schlüssel erscheint nur einmal. Dazu kommen die Liste der verbundenen Geräte und eine Übersicht, welche Mitarbeitenden die WLAN-Erkennung eingeschaltet haben (**Opt-in**). Die Personen koppeln ihr Handy selbst, siehe [Mein Tag und Zeiten](../ich/mein-tag-und-zeiten.md#stempeln-mit-dem-handy-im-wlan).
- **NFC-Terminals**: Jedes Gerät am Tresen meldet sich mit einem eigenen Schlüssel an. Mit **Terminal anlegen** erstellst du den Schlüssel und trägst ihn im Terminal ein. Ein Terminal kannst du an einen Salon binden. Die NFC-Karte einer Person trägst du bei der Person ein, siehe [Personen](personen.md).
- **API-Schlüssel**: Mit einem Schlüssel greifen externe Dienste auf gewählte Daten zu. Mit **Schlüssel anlegen** vergibst du einen Namen und wählst die Berechtigungen, zum Beispiel „Mitarbeiter lesen“ oder „Zeiteinträge schreiben“. Vergib „Voller Zugriff“ nur, wenn es wirklich nötig ist. Gib einen Schlüssel nie weiter und widerrufe ihn, wenn er nicht mehr gebraucht wird.
- **E-Mail-Versand**: der **E-Mail-Server** (Server, Port, Verschlüsselung, Benutzername, Passwort), über den Clokr Einladungen und Benachrichtigungen verschickt. Mit **Test-E-Mail senden** prüfst du die Einstellung. Bei Gmail und Outlook brauchst du ein App-Passwort. Ohne eingerichteten Server verschickt Clokr keine E-Mails.
- **DATEV**: **Berater-Nr.**, **Mandantennummer** und die Lohnarten für Normalstunden, Urlaub, Krank / AU und Sonderurlaub. Die Nummern gelten für jede erzeugte DATEV-Datei. Ohne Berater-Nr. und Mandantennummer lehnt Clokr den DATEV-Export ab.

<!-- SCREENSHOT file=bilder/system-und-daten-01.png role=admin url=/verwalten/system/integrationen show="Integrationen mit den Reitern WLAN-Anwesenheit, NFC-Terminals, API-Schlüssel, E-Mail-Versand und DATEV" -->

## Daten

### CSV-Import

**Verwalten › Daten › CSV-Import**

Mit dem CSV-Import übernimmst du Daten aus einer Datei. Unter „Was importierst du?“ wählst du, ob es **Personen** oder **Zeiten** sind. Je nachdem, was du darfst, siehst du eine oder beide Optionen.

1. Wähle die Art des Imports.
2. Klicke auf **CSV-Datei laden** oder füge den Inhalt direkt ein. **Beispielformat anzeigen** zeigt dir die Spalten. Gibt es mehrere aktive Salons, brauchst du bei Personen in jeder Zeile die Salon-Kennung als Stammsalon.
3. Klicke auf **Vorschau** und prüfe die ersten Zeilen. Noch ist nichts übernommen.
4. Klicke auf **Importieren**.

Das Ergebnis zeigt, wie viele Zeilen übernommen wurden, und listet abgelehnte Zeilen mit dem Grund.

### Export

Auf **Verwalten › Daten › Export** startest du jeden Export:

- **DATEV-Lohnexport**: die Datei für die Lohnbuchhaltung, für alle Personen eines Monats (**Alle Personen exportieren**) oder für eine einzelne Person (**Person exportieren**). Den Monat wählst du oben. Ist der Monat noch nicht abgeschlossen, warnt ein Hinweis: Exportiere erst nach dem Monatsabschluss, sonst können sich die Zahlen noch ändern. Fehlen Berater-Nr. und Mandantennummer, verweist ein Hinweis auf **Verwalten › System › Integrationen**, Reiter DATEV.
- **Zeiten und Abwesenheiten (CSV)**: eine Zeile pro Person für einen Zeitraum von höchstens 12 Monaten, mit Semikolon getrennt, für Excel. Es gibt **Zeiten als CSV** und **Abwesenheiten als CSV**.
- **Monatsexport (PDF)**: die lesbare Fassung des DATEV-Exports, alle Personen eines Monats, ohne Tagesliste. Bei mehreren Salons enthält sie alle Salons. Für einen einzelnen Salon exportierst du unter **Team › Berichte**.
- **Kalender (iCal)**: Abwesenheiten als Kalenderdatei für Outlook, Google Kalender oder Apple Kalender, für das Team oder nur für dich.
- **Letzte Exporte**: die 20 neuesten Exporte des Unternehmens, sichtbar mit dem Recht, das Protokoll zu lesen.

Die Dateien entstehen sofort und werden direkt heruntergeladen. Welche Auswertungen du am Bildschirm ansiehst, steht unter [Berichte](../team/berichte.md).

### Protokoll

**Verwalten › Daten › Protokoll**

Das Protokoll hält jede Änderung im System fest: wer was wann geändert hat, mit dem Stand davor und danach. Es lässt sich nicht verändern.

Der Reiter **Protokoll** zeigt die Einträge mit Zeit, Person, Aktion, betroffener Person, Objekt und einer Zusammenfassung der Änderung. Du filterst nach Zeitraum (**Von**, **Bis**), **Betroffene Person** und **Objekt** und exportierst die Liste mit **Als CSV exportieren**. Ein Klick auf einen Eintrag zeigt die Einzelheiten.

Auf dem Reiter **Aufbewahrung** stellst du ein, wie lange Daten aufbewahrt werden. Standard sind 10 Jahre (GoBD, § 147 AO). Nach Ablauf werden Daten automatisch anonymisiert, aggregierte Salden bleiben erhalten. Kürzere Fristen sind nur erlaubt, wenn keine Buchungsbelege betroffen sind. Die Löschung geschieht nicht fortlaufend, sondern einmal im Jahr zum Stichtag.

### Support-Zugriffe

**Verwalten › Daten › Support-Zugriffe**: Hier siehst du die Zugriffe des Betreibers von Clokr auf die Daten deines Unternehmens, neueste zuerst. Ein solcher Zugriff ist zeitlich begrenzt, nur lesend und wird protokolliert. Ein Klick auf einen Zugriff zeigt die Einzelheiten.

## Regeln

### Benachrichtigungen und E-Mail

**Verwalten › Regeln › Benachrichtigungen & E-Mail** regelt, wann Clokr benachrichtigt:

- **E-Mail-Benachrichtigungen**: Mit **E-Mail-Benachrichtigungen aktivieren** schickt Clokr zusätzlich zur Benachrichtigung in der App eine E-Mail. Dafür muss der E-Mail-Server eingerichtet sein. Je Ereignis schaltest du einzeln: neuer Urlaubsantrag, Urlaub genehmigt oder abgelehnt, Überstunden-Warnung, fehlende Zeiteinträge, vergessene Stempelung, Monatsabschluss und Zeitnachtrag.
- **Erinnerungen**: wann Clokr an offene Punkte erinnert, zum Beispiel an eine offene Stempelung nach einer Zahl von Stunden, an fehlende Einträge nach einer Zahl von Tagen, an offene Urlaubsanträge und an bevorstehende Abwesenheiten.

Jede Person kann einzelne E-Mails für sich abbestellen (**Ich › Profil**). Hinweise zur Sicherheit des Kontos und gesetzliche Hinweise bekommt sie immer.

### Dienstplan

**Verwalten › Regeln › Dienstplan**: Hier pflegst du die Bausteine des Dienstplans. Die Seite hat vier Reiter:

- **Schichtvorlagen**: wiederkehrende Schichten mit Name, Start, Ende und Farbe. Mit **Vorlage anlegen** erstellst du eine. Im Dienstplan ziehst du sie auf einen Tag.
- **Bedarfsregeln**: wie viele Personen je Vorlage und Wochentag mindestens eingeplant sein sollen, mit der Option **Aufsicht erforderlich**. Die genaueste Regel gilt. Ohne Regel gelten 2 Personen.
- **Wochenmuster**: das wiederkehrende Muster je Person mit einer Vorlage pro Wochentag. Nur Personen mit dem Arbeitszeitmodell „Nach Schichtplan“ erscheinen hier. Mit **Muster anwenden** auf [Team › Dienstplan](../team/dienstplan.md) füllt Clokr eine Woche daraus.
- **Einstellungen**: wie streng Schichten an die Öffnungszeiten der Salons gebunden sind, ob das Verfügbarkeits-System aktiv ist (dann sehen Mitarbeitende **Meine Verfügbarkeit**), ob Schichten auf Berufsschultagen automatisch entfernt werden, und die Schicht-Erinnerungen.
