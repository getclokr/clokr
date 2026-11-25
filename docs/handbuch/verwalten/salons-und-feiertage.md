# Salons und Feiertage

Unter **Verwalten › Salons** pflegst du die Salons deines Unternehmens mit Adresse, Öffnungszeiten und Feiertagen. Clokr berechnet die gesetzlichen Feiertage selbst. Du musst sie nicht eintragen. Maßgeblich ist das **Bundesland des Salons**, in dem an dem Tag gearbeitet wird.

## Die Salonliste

Die Liste zeigt alle Salons mit Status („Aktiv“ oder „Inaktiv“) und Bundesland. Du suchst nach dem Namen und filterst nach dem Status. Ein Klick öffnet den Salon. Mit **Salon anlegen** legst du einen neuen an, vorausgesetzt dein Paket erlaubt weitere Salons.

<!-- SCREENSHOT file=bilder/salons-und-feiertage-01.png role=admin url=/verwalten/salons show="Die Salonliste mit Spalten für Status und Bundesland und der Schaltfläche Salon anlegen" -->

## Ein Salon im Detail

Die Seite eines Salons hat drei Reiter:

- **Stammdaten**: Name, Straße, PLZ, Ort und **Bundesland**. Das Bundesland bestimmt die gesetzlichen Feiertage des Salons.
- **Öffnungszeiten**: pro Wochentag Öffnung und Schließung oder **Geschlossen**. Die Schichtplanung prüft Schichten gegen diese Zeiten, abhängig von der Einstellung unter **Verwalten › Regeln › Dienstplan**.
- **Feiertage**: die zusätzlichen Feiertage dieses Salons und die gesetzlichen Feiertage des gewählten Jahres.

### Bundesland ändern

Das Bundesland eines Salons lässt sich nur ändern, solange noch **keine Zeiteinträge** und **keine Salonzuordnungen** auf den Salon verweisen. Ein Umzug in ein anderes Bundesland ist deshalb ein **neuer Salon**.

Das Feld **Bundesland** unter **Verwalten › System › Allgemein** ist nur die Vorgabe für neu angelegte Salons. Es ändert keinen bestehenden Salon.

### Salon deaktivieren und aktivieren

Ein deaktivierter Salon bekommt keine neuen Zeiteinträge, Schichten oder Zuordnungen. Verlauf und Auswertungen bleiben erhalten. Ein Salon wird nie gelöscht und lässt sich jederzeit wieder aktivieren. Der letzte aktive Salon kann nicht deaktiviert werden.

## Welche Feiertage gelten

Für einen Tag gilt der Feiertagskalender des Salons, in dem die Person an dem Tag arbeitet (Arbeitsort nach § 2 EFZG):

1. der Salon des Zeiteintrags dieses Tages. Hat die Person mehrere Einträge, gilt der Salon des Eintrags mit dem frühesten Beginn,
2. sonst der Salon, dem die Person an dem Tag zugeordnet ist,
3. sonst der Standard-Salon des Unternehmens.

Gesetzliche Feiertage erscheinen in den Kalendern von Zeiten und Abwesenheiten und senken das Soll.

### Zusätzliche Feiertage

Einen örtlichen Feiertag trägst du pro Salon ein:

1. Öffne den Salon und den Reiter **Feiertage**.
2. Wähle das **Jahr** und klicke auf **Feiertag anlegen**.
3. Trage **Datum** und **Bezeichnung** ein (höchstens 100 Zeichen) und klicke auf **Hinzufügen**.

Mit dem Entfernen-Symbol in der Liste nimmst du einen zusätzlichen Feiertag wieder heraus. Die gesetzlichen Feiertage stehen darunter in einer eigenen Liste und lassen sich nicht ändern.

## Heiligabend und Silvester

Ob der 24. und der 31. Dezember als Arbeitstag, halber freier Tag oder ganzer freier Tag gelten, stellst du für das ganze Unternehmen unter **Verwalten › Regeln › Abwesenheiten** ein, siehe [Abwesenheiten und Urlaub](abwesenheiten-und-urlaub.md#heiligabend-und-silvester). Auch die Schulferien für Berufsschulen gelten für das ganze Unternehmen, nicht pro Salon.

## Mehrere Salons

Jede Person hat einen **Stammsalon**. Er entscheidet über Urlaub und Feiertage der Person. Wer in mehreren Salons arbeitet, ist eine Springerin oder ein Springer und bekommt zusätzliche Einsatzsalons, siehe [Personen](personen.md). Jeder Zeiteintrag gehört zu genau einem Salon. Wählt niemand einen Salon, ordnet Clokr den Eintrag automatisch zu.
