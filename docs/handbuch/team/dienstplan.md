# Dienstplan

Auf **Team › Dienstplan** planst du die Schichten deines Teams Woche für Woche: Schichten zuweisen und verschieben, ein Muster anwenden, die Vorwoche kopieren und die Besetzung im Blick behalten. Die Seite zeigt Personen, die nach Schichtplan arbeiten. Vorlagen und Mindestbesetzung pflegt die Verwaltung unter **Verwalten › Regeln › Dienstplan**. Schichten, die aus Phorest kommen, erscheinen als ganz normale Schichten im Plan (siehe unten).

Der Dienstplan hat vier Reiter: **Woche**, **Bedarf**, **Hinweise** und **Verfügbarkeit**.

## Woche

Die Wochenansicht ist ein Raster: eine Zeile pro Person, eine Spalte pro Wochentag. Mit **Vorherige Woche**, **Nächste Woche** und **Heute** blätterst du. Es gibt keine Monatsansicht.

- Links in jeder Zeile steht die Person mit **Geplant / Vertrag**: wie viele Stunden die Person geplant hat, verglichen mit ihrem Vertrag. Bei Urlaub oder Abwesenheit senkt sich der Vertragswert entsprechend. Eine Abweichung ist farbig markiert.
- Über jedem Tag zeigt die **Besetzung**, wie viele Personen geplant sind im Verhältnis zur Mindestbesetzung. Fehlt die Aufsicht, sagt die Anzeige das. An geschlossenen Tagen steht „geschlossen“.
- Ein Tag, an dem jemand laut Vertrag arbeitet, aber keine Schicht hat, trägt den Hinweis **laut Vertrag**: Er zählt zur Besetzung.
- Vergangene Tage lassen sich nicht ändern.

Unter der Wochenansicht erklärt eine Legende die Markierungen: Schicht, Unterbesetzung, Hinweis, Urlaub, Berufsschule und geschlossen. Auf schmalen Bildschirmen gibt es zusätzlich eine Tagesansicht.

<!-- SCREENSHOT file=bilder/team-dienstplan-01.png role=manager url=/team/dienstplan show="Der Dienstplan im Reiter Woche mit Vorlagen, Personenzeilen, Schichten und der Besetzung über den Tagen" -->

### Schicht zuweisen

- **Per Klick**: Klicke in einer freien Zelle auf **+ Schicht**. Im Dialog „Schicht zuweisen“ wählst du optional eine **Vorlage**, trägst **Startzeit** und **Endzeit** ein und ergänzt optional eine **Bezeichnung** und eine **Notiz**. Speichere.
- **Per Ziehen**: Ziehe eine Kachel aus **Vorlagen** über dem Raster auf eine freie Zelle. Die Schicht entsteht sofort mit den Zeiten der Vorlage.

Eine neue Schicht ist sofort aktiv und für die Person sichtbar. Einen Entwurfsstatus gibt es nicht.

### Schicht verschieben, bearbeiten, löschen

- **Verschieben**: Ziehe die Schicht auf eine andere freie Zelle.
- **Bearbeiten**: Klicke auf die Schicht. Der Dialog heißt dann „Schicht bearbeiten“.
- **Löschen**: Wähle im Dialog **Löschen** und bestätige „Schicht löschen?“. Sind für die Zeit Kundentermine gebucht, zeigt Clokr das vorher an.

### Wenn etwas kollidiert

Überschneidet sich eine Schicht mit Urlaub oder einer Abwesenheit, fragt Clokr nach („Schicht trotz Urlaub/Abwesenheit zuweisen?“). Mit **Trotzdem zuweisen** legst du die Schicht bewusst trotzdem an, und Clokr protokolliert das. Beim Ziehen geschieht nie etwas automatisch. Die tägliche Höchstarbeitszeit von 10 Stunden (§ 3 ArbZG) ist eine harte Grenze: Eine Schicht darüber lässt sich nicht anlegen. Auch die Ruhezeit von 11 Stunden (§ 5 ArbZG) wird geprüft.

## Muster anwenden

Mit **Muster anwenden** füllt Clokr die Woche nach den Schicht-Mustern, die die Verwaltung pro Person hinterlegt hat. Vorher zeigt eine Vorschau, was passiert:

- **Zu erstellen (N)**: die Schichten, die entstehen.
- **Übersprungen (N)**: die Einträge mit Grund, zum Beispiel Urlaub, Abwesenheit, bestehende Schicht oder kein Muster.

Erst mit der Bestätigung legt Clokr die Schichten an. Die Aktion gilt für alle Salons deiner Reichweite, nicht nur für den gewählten Salon.

## Letzte Woche kopieren

Mit **Letzte Woche kopieren** übernimmst du die Schichten einer früheren Woche in die angezeigte Woche. Die **Quellwoche** (ein Montag) kannst du ändern. Personen mit Urlaub, Krankheit oder bestehenden Schichten werden übersprungen. Auch hier zeigt eine Vorschau vorher, was passiert, und die Aktion gilt für alle Salons deiner Reichweite.

## Bedarf

Der Reiter **Bedarf** zeigt pro Woche und Person, was noch zu planen ist: **Vertrag**, **Urlaub diese Woche (Tage)**, **noch einzuplanen** und sobald Schichten existieren **geplant** und **Differenz**. So siehst du auf einen Blick, wo der Plan der Woche noch Lücken hat. Du blätterst von Woche zu Woche, ohne Obergrenze, denn Urlaub kann ein Jahr im Voraus gebucht sein.

## Hinweise

Auf dem Reiter **Hinweise** stehen Schichten, die einen Blick brauchen. Mit **Von** und **Bis** grenzt du den Zeitraum ein und aktualisierst mit **Aktualisieren**. Die Hinweise sind:

- **Entfernt**: Eine Schicht wurde automatisch entfernt, weil ein neuer Berufsschultag angelegt wurde. Mit **Wiederherstellen** holst du sie zurück. Das wird protokolliert.
- **Prüfen**: Eine Schicht überschneidet sich mit genehmigtem Urlaub oder einem Berufsschultag. Mit **Schicht behalten** nimmst du den Hinweis weg. Das wird protokolliert.
- **Woche voll**: In einer Woche sind mehr Schichttage geplant, als der Vertrag nach Urlaub und Abwesenheiten zulässt.

Ein Klick auf das Info-Zeichen erklärt dir jede Art genauer.

## Verfügbarkeit

Der Reiter **Verfügbarkeit** (nur sichtbar, wenn dein Unternehmen die Verfügbarkeit nutzt) listet die Personen. Mit **Öffnen** siehst du, wann eine Person arbeiten kann: das wiederkehrende Wochenmuster und einzelne Ausnahmen. Die Angaben fließen als Markierungen in die Wochenansicht ein, zum Beispiel „nicht verfügbar“ oder „bevorzugt“. Die Personen tragen sie unter [Ich › Dienstplan](../ich/dienstplan.md) selbst ein.

## Urlaub und Dienstplan

Urlaub wird oft lange im Voraus genehmigt, der Dienstplan steht dagegen nur Wochen im Voraus. Deshalb gilt:

1. Prüfe zuerst, welcher Urlaub in der Woche genehmigt ist. Das siehst du auf **Team › Abwesenheiten**.
2. Plane dann um den Urlaub herum. An genehmigten Urlaubstagen wird die Person nicht eingeplant.
3. Urlaub verringert die Arbeitstage der Woche: Bei einem Vertrag mit 5 Arbeitstagen und 2 Urlaubstagen bleiben 3 Arbeitstage einzuplanen. Welche Wochentage das sind, entscheidet die Planung.

Genehmigter Urlaub ist verbindlich. Wie viele Urlaubstage ein Antrag kostet, richtet sich nach dem Vertrag und nicht nach dem Plan.

## Schichten aus Phorest

Wenn dein Unternehmen Phorest nutzt, kommen die Schichten von dort automatisch in den Plan. Ein eigener Sync-Button steht hier nicht. Wird eine Schicht gelöscht, die Kundentermine hat, warnt Clokr vorher. Die Einrichtung übernimmt die Verwaltung.
