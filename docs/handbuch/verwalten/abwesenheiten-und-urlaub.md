# Abwesenheiten und Urlaub

Unter **Verwalten › Regeln › Abwesenheiten** legst du die Urlaubs- und Abwesenheitsregeln für das ganze Unternehmen fest. Die Seite hat fünf Reiter: **Urlaub**, **Sonderurlaub**, **Übertrag**, **Betriebsurlaub** und **Urlaubsgrenzen & Sperren**. Oben zeigen Kennzahlen den Jahresurlaub (Standard) und das Verfalldatum des Resturlaubs.

Die Werte einer einzelnen Person pflegst du bei der Person selbst unter **Verwalten › Personen**, siehe [Personen](personen.md). Wie Mitarbeitende Urlaub beantragen, steht unter [Abwesenheiten](../ich/abwesenheiten.md). Wie du Anträge entscheidest, steht unter [Aufgaben](../team/aufgaben.md).

<!-- SCREENSHOT file=bilder/abwesenheiten-und-urlaub-01.png role=admin url=/verwalten/regeln/abwesenheiten show="Regeln Abwesenheiten mit den Reitern Urlaub, Sonderurlaub, Übertrag, Betriebsurlaub und Urlaubsgrenzen und Sperren" -->

## Urlaub

Der Reiter **Urlaub** hat vier Abschnitte, die du einzeln speicherst.

### Urlaubsanspruch

- **Jahresurlaub (Basis 5-Tage-Woche)**: die Urlaubstage bei einer 5-Tage-Woche. Ein Hinweis zeigt dir, was daraus für eine 4-Tage-Woche wird.
- **Urlaubstage Azubis (Basis 5-Tage-Woche)**: der Wert für Auszubildende ohne eigenen Wert. Er wird beim Anlegen vorgeschlagen und wirkt auf künftig angelegte Urlaubsjahre. Er muss mindestens 20 Tage betragen (§ 3 BUrlG). Jugendliche erhalten automatisch den höheren Mindesturlaub nach § 19 JArbSchG.
- **Teilzeit-Urlaub automatisch anteilig berechnen** mit **Vollzeit-Arbeitstage pro Woche**: Clokr rechnet den Anspruch nach den Arbeitstagen pro Woche um.
- **Gesetzlichen Mindesturlaub durchsetzen**: eine Warnung, wenn der Mindesturlaub nicht genommen wurde (§ 7 BUrlG).

Der Anspruch einer Person ist immer mindestens der gesetzliche Mindesturlaub. Bei Ein- oder Austritt im Laufe des Jahres rechnet Clokr den Anspruch anteilig nach § 5 BUrlG. Bereits bestehende Ansprüche ändern sich durch neue Standardwerte nicht. Die Werte gelten für künftig angelegte Urlaubsjahre.

### Urlaubsanträge

- **Vorlaufzeit (Tage)**: wie viele Tage im Voraus ein Antrag mindestens gestellt werden muss. 0 bedeutet keine Vorlaufzeit. Für Krankmeldungen gilt sie nicht.
- **Maximale Vorausbuchung (Monate)**: wie weit im Voraus Urlaub gebucht werden darf. 0 bedeutet unbegrenzt.
- **Halbe Tage erlauben**.
- **Planungsfrist sperrt eigene Änderungen**: Ist für die Urlaubsplanung eine Frist gesetzt, können Mitarbeitende ihre eigenen Wünsche danach nicht mehr ändern.

### Krankmeldung

- **Mitarbeitende dürfen eine Krankmeldung selbst eintragen**.
- **Nachweispflicht nach (Kalendertagen)**: ab wann ein ärztlicher Nachweis dokumentiert wird. Standard sind 3 Kalendertage (§ 5 Abs. 1 EFZG), 0 heißt ab dem ersten Tag. Das betrifft nur die Dokumentation des Nachweises. Für die Gutschrift bei Krankheit im Urlaub (§ 9 BUrlG) spielt der Wert keine Rolle.

### Heiligabend und Silvester

Hier legst du fest, ob der 24. und der 31. Dezember als Arbeitstag, als halber freier Tag oder als ganzer freier Tag gelten, und ab welchem Jahr (**Gültig ab Jahr**) die Regel gilt.

## Sonderurlaub

Auf dem Reiter **Sonderurlaub** pflegst du die **Sonderurlaubs-Regeln**: die Anlässe, die dein Unternehmen gewährt, mit Anzahl Tage, Nachweis, Art (gesetzlich oder betrieblich) und Status. Mitarbeitende wählen einen dieser Anlässe, wenn sie Sonderurlaub beantragen.

1. Klicke auf **Regel anlegen**. Der Dialog heißt „Sonderurlaubsregel anlegen“.
2. Trage den **Anlass** und optional eine **Beschreibung** ein, zum Beispiel „Ehrenamtlicher Einsatz“.
3. Lege die **Anzahl Tage** fest und aktiviere bei Bedarf **Nachweis erforderlich**.
4. Speichere.

Eine vorhandene Regel öffnest du über **Bearbeiten**. Mit **Regel ist aktiv** schaltest du sie ab, ohne sie zu löschen. Eine deaktivierte Regel steht bei neuen Anträgen nicht mehr zur Auswahl. Den Namen gesetzlicher Regeln kannst du nicht ändern.

## Übertrag

Der Reiter **Übertrag** regelt, was mit Resturlaub am Jahresende passiert (§ 7 BUrlG):

- **Resturlaub verfällt am**: der Tag und Monat des Folgejahres, an dem nicht genommener Resturlaub des Vorjahres verfällt.
- **Übertrag ins Folgejahr erfordert eine Begründung**, zum Beispiel Krankheit oder betriebliche Gründe.
- **Warnung vor Verfall**: Clokr muss Mitarbeitende rechtzeitig auf verfallenden Urlaub hinweisen (EuGH C-684/16). Du stellst ein, ab welchem Monat erinnert wird, ob die Hinweise automatisch verschickt werden (täglich um 06:00 Uhr) und mit welchen Schwellen, zum Beispiel 60, 30, 14 und 7 Tage vor dem Verfall.

::: warning Achtung
Ohne einen dokumentierten Hinweis verfällt Urlaub nicht von allein. Ist die Frist ohne Hinweis abgelaufen, bleiben die Tage deshalb im Resturlaub stehen. Clokr zeigt das mit einem Grund an.
:::

## Betriebsurlaub

Auf dem Reiter **Betriebsurlaub** hältst du Zeiträume fest, in denen der ganze Betrieb geschlossen hat, etwa eine Weihnachtsschließung.

::: warning Achtung
Clokr merkt sich einen Betriebsurlaub mit allen Angaben und zeigt ihn an, rechnet ihn aber noch nicht automatisch ab: Weder das Urlaubskonto noch das Stundenkonto ändert sich dadurch. Die automatische Verrechnung wird gerade gebaut. Bis sie da ist, verrechnest du die Schließung für die betroffenen Personen selbst und prüfst Urlaubskonto und Stundenkonto danach.
:::

1. Wähle oben das **Jahr** und klicke auf **Betriebsurlaub anlegen**.
2. Trage **Bezeichnung**, **Startdatum** und **Enddatum** ein.
3. Mit **Vom Urlaubskonto abziehen** hältst du fest, ob die Schließung den Jahresurlaub belasten soll. Die Einstellung wird gespeichert und wirkt, sobald die automatische Verrechnung da ist. Optional schreibst du eine interne **Notiz**.
4. Speichere.

Ein Klick auf einen Betriebsurlaub öffnet seine Seite. Dort änderst du ihn mit **Betriebsurlaub speichern** oder löschst ihn. Unter **Ausnahmen** hältst du einzelne Personen fest, die von der Schließung ausgenommen sind, zum Beispiel wegen Notdienst: Klicke auf **Ausnahme hinzufügen**, wähle die Person und nenne optional einen **Grund**. Auch die Ausnahmen werden gespeichert und wirken erst mit der automatischen Verrechnung.

## Urlaubsgrenzen & Sperren

Hier legst du fest, wie viele Personen gleichzeitig im Urlaub sein dürfen, und sperrst Zeiträume. Gilt für einen Tag mehr als eine Regel, setzt sich die strengste durch.

- **Neue Regel**: Wähle optional einen **Salon**. Ohne Salon gilt die Regel für alle. Bei **Gruppe** wählst du **Alle**, eine **Beschäftigungsart** oder eine **Rolle**. Bei **Höchstens gleichzeitig im Urlaub** trägst du die Zahl ein. **Von** und **Bis** sind optional. Ohne Zeitraum gilt die Regel das ganze Jahr.
- **Neue Urlaubssperre**: Eine Sperre gilt für alle Mitarbeitenden. Im Zeitraum darf niemand gleichzeitig im Urlaub sein. Dafür sind **Von** und **Bis** Pflicht.

Beim Beantragen warnt Clokr, wenn eine Regel überschritten wird. Wer einen Antrag trotz überschrittener Grenze genehmigt, muss dafür eine Begründung der Ausnahme angeben. Die Regel gilt nicht rückwirkend: Bereits genehmigter Urlaub wird nur markiert.
