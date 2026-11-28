# Compliance und Revisionssicherheit

Clokr ist eine revisionssichere Zeiterfassung für Betriebe in Deutschland. Diese Seite fasst zusammen, was Clokr prüft, schützt und aufbewahrt, und auf welche Gesetze sich das stützt.

::: warning Hinweis
Diese Seite beschreibt, wie Clokr arbeitet, und ersetzt keine Rechtsberatung. Dein Unternehmen bleibt selbst verantwortlich für die richtige Einrichtung: Aufbewahrungsfristen, Bundesland je Salon, Arbeitszeitmodelle und Vereinbarungen im Betrieb.
:::

## Revisionssicherheit

Alle Daten, die für Arbeitszeit, Urlaub und Lohn zählen, müssen unverfälscht und nachvollziehbar bleiben. Clokr hält dafür diese Grundsätze ein:

1. **Nichts wird endgültig gelöscht.** Zeiteinträge, Urlaubsanträge, Abwesenheiten und Personen werden nicht hart gelöscht, sondern auf gelöscht gesetzt oder in ihrem Status geändert.
2. **Jede Änderung wird protokolliert**: wer, wann, von wo, mit dem Stand vor und nach der Änderung. Du liest das Protokoll unter **Verwalten › Daten › Protokoll**.
3. **Abgeschlossene Monate sind unveränderlich.** Nach dem [Monatsabschluss](../verwalten/monatsabschluss.md) lassen sich Einträge nicht mehr ändern oder löschen, auch nicht durch die Verwaltung.
4. **Keine stillen Überschreibungen.** Eine Korrektur an einem abgeschlossenen Monat entsteht als neue Buchung mit Bezug zum Original. Der alte Eintrag bleibt stehen.
5. **Nachvollziehbarkeit.** Es lässt sich jederzeit rekonstruieren, wer was wann und warum geändert hat.

## Arbeitszeitgesetz (ArbZG)

Clokr prüft jeden Zeiteintrag. Die Hinweise verhindern das Speichern nicht, damit Korrekturen möglich bleiben, aber sie werden dokumentiert.

| Paragraph                        | Regel                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| § 3                              | Die tägliche Arbeitszeit darf **10 Stunden** nicht überschreiten. Das ist die harte Tagesgrenze.                                                                                                                                                                                                                                                                     |
| § 3                              | Die **8-Stunden-Regel** ist ein Durchschnitt über 24 Wochen (6 Monate), keine Grenze pro Tag. Ein Tag mit 8 bis 10 Stunden ist erlaubt und löst keinen Hinweis aus. Eine 4-Tage-Woche mit 39 Stunden (9,75 Stunden pro Tag) ist zulässig.                                                                                                                            |
| § 3                              | Die wöchentliche Höchstarbeitszeit beträgt **48 Stunden** (Montag bis Samstag).                                                                                                                                                                                                                                                                                      |
| § 4                              | Mehr als 6 Stunden Arbeit brauchen mindestens **30 Minuten** Pause, mehr als 9 Stunden mindestens **45 Minuten**.                                                                                                                                                                                                                                                    |
| § 4 Satz 2                       | Eine Pause unter 15 Minuten zählt nicht als Ruhepause, und eine Pause liegt nie ganz am Anfang oder am Ende der Arbeit.                                                                                                                                                                                                                                              |
| § 4 Satz 3                       | Nach spätestens 6 Stunden am Stück muss eine Pause von mindestens 15 Minuten liegen, auch wenn die Summe stimmt.                                                                                                                                                                                                                                                     |
| § 5                              | Zwischen Arbeitsende und nächstem Arbeitsbeginn liegen mindestens **11 Stunden** Ruhezeit.                                                                                                                                                                                                                                                                           |
| § 18 Abs. 2 ArbZG, § 11 JArbSchG | Für Personen unter 18 Jahren ersetzt das Jugendarbeitsschutzgesetz die Pausenregel: mehr als 4,5 Stunden brauchen 30 Minuten, mehr als 6 Stunden 60 Minuten. Pausen sind mindestens 15 Minuten lang, es gibt höchstens 4,5 Stunden am Stück ohne Pause, und in der ersten und letzten Stunde liegt keine Pause. Das Alter zählt am Arbeitstag, nicht heute.          |
| § 18 Abs. 2 ArbZG, § 8 JArbSchG  | Für Personen unter 18 Jahren ersetzt das Jugendarbeitsschutzgesetz auch die Höchstarbeitszeit: höchstens 8 Stunden am Tag, bis zu 8,5 Stunden, wenn an einem anderen Werktag derselben Woche weniger als 8 Stunden gearbeitet wird, und höchstens 40 Stunden in der Woche (Berufsschulzeit und ein ausfallender Feiertag zählen mit). Das Alter zählt am Arbeitstag. |

Auf Wunsch zieht Clokr die Pflichtpause automatisch ab und lässt die Person sie bestätigen, siehe [Mein Tag und Zeiten](../ich/mein-tag-und-zeiten.md). Wer nach § 18 ArbZG von der Zeiterfassungspflicht befreit ist, bekommt die Stempelfunktion nicht angezeigt.

## Urlaub (BUrlG)

- **Mindesturlaub (§ 3 BUrlG):** Arbeitstage pro Woche mal 4. Bei einer 5-Tage-Woche sind das 20 Tage, bei einer 4-Tage-Woche 16. Der Anspruch ist immer mindestens der Mindesturlaub. Für Jugendliche gilt der Mindesturlaub nach § 19 JArbSchG.
- **Teilurlaub (§ 5 BUrlG):** Bei Ein- oder Austritt im Laufe des Jahres berechnet Clokr den Anspruch anteilig.
- **Übertrag (§ 7 Abs. 3 BUrlG):** Urlaub muss im Kalenderjahr genommen werden. Ein Übertrag ins nächste Jahr ist nur mit einem dokumentierten Grund möglich, etwa Krankheit oder betriebliche Gründe. Nicht genommener Resturlaub verfällt zu dem Tag, den dein Unternehmen festlegt (üblich ist der 31. März).
- **Hinweispflicht (EuGH C-684/16):** Ohne dokumentierten Hinweis des Arbeitgebers verfällt Urlaub nicht von allein. Clokr verschickt deshalb Erinnerungen vor dem Verfall und protokolliert sie.
- **Urlaub und Zeiterfassung (§ 8 BUrlG):** An einem Tag mit **genehmigtem** Urlaub lässt sich keine Zeit eintragen. Wer arbeiten will, beantragt zuerst die Stornierung. Solange die Stornierung aussteht, sind Einträge möglich, sie gelten aber als ungültig und zählen nicht. Wird die Stornierung genehmigt, werden sie automatisch gültig.
- **Krankheit im Urlaub (§ 9 BUrlG):** Wird jemand im Urlaub krank und reicht eine ärztliche Bescheinigung ein, schreibt Clokr die Urlaubstage gut. Das läuft über einen eigenen Vorgang, den die Führungskraft entscheidet.
- **Krankmeldung (§ 5 EFZG):** Ab wann ein Nachweis dokumentiert wird, stellst du unter **Verwalten › Regeln › Abwesenheiten** ein. Standard sind 3 Kalendertage.

Mehr dazu auf der Seite [Abwesenheiten und Urlaub](../verwalten/abwesenheiten-und-urlaub.md).

## Feiertage

Ein gesetzlicher Feiertag gilt an dem Ort, an dem an dem Tag gearbeitet wird (§ 2 EFZG). Deshalb steht das Bundesland am **Salon** und nicht am Unternehmen. Mehr dazu unter [Salons und Feiertage](../verwalten/salons-und-feiertage.md).

## Vier-Augen-Prinzip

Mehrere sicherheitsrelevante Aktionen kann eine einzelne Person nicht allein erledigen:

- **Eigene Anträge** (Urlaub, Zeitnachträge) kann niemand selbst entscheiden.
- **Die Stornierung eines genehmigten Urlaubs** gibt weder die Person frei, die sie beantragt hat, noch die, die den Urlaub genehmigt hat.
- **Eine Korrektur für einen abgeschlossenen Monat** entscheidet weder die Person, die sie gestellt hat, noch die Person, um deren Zeiten es geht.
- **Das endgültige Löschen einer Person** innerhalb der Aufbewahrungsfrist braucht die Freigabe einer zweiten Administratorin oder eines zweiten Administrators.
- **Eine Rolle**, die erlaubt, eigene Zeiten zu ändern und Zeitnachträge anderer zu genehmigen, verlangt beim Speichern eine ausdrückliche Bestätigung. Siehe [Rollen und Rechte](../verwalten/rollen-und-rechte.md).

## Datenschutz (DSGVO)

### Löschen heißt anonymisieren (Art. 17)

Wird eine Person „gelöscht“, **anonymisiert** Clokr sie, statt sie hart zu löschen:

- Der Vorname wird durch „Gelöscht“ und der Nachname durch „GELÖSCHT“ mit einer Kennung ersetzt. Die **Personalnummer bleibt erhalten**, weil die Lohnbuchhaltung sie für Korrekturen alter Monate braucht (§ 41 EStG, § 147 AO, Art. 17 Abs. 3 Buchstabe b DSGVO).
- E-Mail-Adresse und Zugang werden anonymisiert und deaktiviert. Die NFC-Karte, gekoppelte Handys und WLAN-Kennungen werden entfernt. Alle Rollenzuweisungen werden entfernt und im Protokoll festgehalten.
- Freitexte, also Notizen in Zeiteinträgen, Urlaubsanträgen und Abwesenheiten, Begründungen und Dokumente, werden entfernt. Einladungen und Zugangsschlüssel werden endgültig gelöscht.
- **Zeiten, Urlaubsanträge, Abwesenheiten, Schichten, Überstundenkonto und Salden bleiben erhalten**, weil sie der gesetzlichen Aufbewahrung unterliegen. Im Protokoll wird der Bezug zur Person entfernt, die Einträge selbst bleiben.

Die Schritte stehen unter [Personen](../verwalten/personen.md#löschen-heißt-anonymisieren).

### WLAN-Anwesenheit (Art. 6)

Das automatische Stempeln über das WLAN ist **freiwillig**. Jede Person schaltet es selbst ein, und sie kann die Einwilligung jederzeit unter **Ich › Profil** widerrufen. Verbindungs- und Trennungszeiten werden 90 Tage protokolliert und danach automatisch gelöscht.

## Aufbewahrungsfristen

| Grundlage                     | Frist                                          | Norm                |
| ----------------------------- | ---------------------------------------------- | ------------------- |
| Arbeitszeitnachweis           | 2 Jahre                                        | § 16 Abs. 2 ArbZG   |
| Lohnkonten                    | 6 Jahre                                        | § 41 EStG           |
| Buchungsbelege (lohnrelevant) | 10 Jahre                                       | § 147 AO, § 257 HGB |
| Datenschutz                   | Löschen, wenn die längste Frist abgelaufen ist | Art. 17 DSGVO       |

Standard in Clokr sind **10 Jahre**. Dein Unternehmen kann die Frist unter **Verwalten › Daten › Protokoll** auf dem Reiter **Aufbewahrung** kürzen, mindestens auf 2 Jahre. Die Frist beginnt am Ende des Kalenderjahres, in dem ein Datensatz entstanden ist. Die Löschung läuft nicht fortlaufend, sondern einmal im Jahr zum Stichtag, zum Beispiel am 1. Januar für Datensätze, deren Frist am 31. Dezember abgelaufen ist.
