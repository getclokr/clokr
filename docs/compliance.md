# Compliance & Rechtliche Grundlagen

Clokr ist als **revisionssichere** Zeiterfassung für den deutschen Rechtsraum konzipiert. Diese Seite dokumentiert alle implementierten gesetzlichen Prüfungen und Aufbewahrungsregeln.

> **Status:** Stand v1.9 (aktuell 1.9.2, 2026-08-03). Geprüft gegen den Code unter `apps/api/src/contexts/time-tracking/arbzg.ts`, `apps/api/src/contexts/absence/vacation-calc.ts`, `apps/api/src/composition/data-retention.ts`.

---

## § 3 / § 4 / § 5 ArbZG — Arbeitszeitprüfungen

Implementiert in [`apps/api/src/contexts/time-tracking/arbzg.ts`](../apps/api/src/contexts/time-tracking/arbzg.ts). Wird automatisch nach jedem TimeEntry-Insert/Update ausgeführt und liefert Warnungen an die UI zurück. Warnungen **blockieren das Speichern nicht** (Audit-Hinweis statt Hard-Block, damit Korrektur-Workflows möglich bleiben).

### Regelwerk

| Paragraph                                  | Regel                                                                                                                                                                 | Implementierung                                                                                                           | Severity                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **§ 3 ArbZG**                              | Tägliche Höchstarbeitszeit netto **10h absolut**                                                                                                                      | `if (netWorkedMin > 10 * 60)` → `MAX_DAILY_EXCEEDED`                                                                      | `error`                     |
| **§ 3 ArbZG**                              | 8h-Regel = 24-Wochen-/6-Monats-Durchschnitt, **kein** Tageslimit                                                                                                      | Keine Tageswarnung für 8–10h Tage — nur als Rolling-Average prüfen                                                        | `warning` (avg)             |
| **§ 3 ArbZG**                              | Wöchentliche Höchstarbeitszeit **48h** (Mo–Sa = 6 Werktage)                                                                                                           | `if (weekMin > 48 * 60)` → `MAX_WEEKLY_EXCEEDED`                                                                          | `error`                     |
| **§ 4 ArbZG**                              | Bei **>6h** Arbeit: min. **30min Pause**                                                                                                                              | `if (netWorked > 6h && totalBreak < 30)` → `BREAK_TOO_SHORT`                                                              | `warning`                   |
| **§ 4 ArbZG**                              | Bei **>9h** Arbeit: min. **45min Pause**                                                                                                                              | `if (netWorked > 9h && totalBreak < 45)` → `BREAK_TOO_SHORT`                                                              | `error`                     |
| **§ 5 ArbZG**                              | **11h Mindestruhe** zwischen Arbeitsende und nächstem Beginn                                                                                                          | Prüfung gegen Vortag UND Folgetag                                                                                         | `warning`                   |
| **§ 4 S. 2 ArbZG**                         | Ein Pausenabschnitt unter **15 Min** zählt nicht als Ruhepause (ebenso nicht am ersten Beginn oder letzten Ende des Arbeitstags)                                      | `evaluatePlacement()` → `BREAK_SEGMENT_TOO_SHORT`                                                                         | `warning`                   |
| **§ 4 S. 3 ArbZG**                         | Höchstens **6h am Stück** ohne Ruhepause von mind. 15 Min — auch wenn die Summe nach Satz 1 erreicht ist                                                              | `evaluatePlacement()` → `BREAK_TOO_LATE`                                                                                  | `warning`                   |
| **§ 11 JArbSchG** (über § 18 Abs. 2 ArbZG) | Unter 18 am Arbeitstag: **30 Min** ab 4,5h, **60 Min** ab 6h, Abschnitte mind. 15 Min, höchstens **4,5h am Stück**, keine Ruhepause in der ersten oder letzten Stunde | `BREAK_REGIMES.JARBSCHG_11` → `BREAK_TOO_SHORT`, `BREAK_SEGMENT_TOO_SHORT`, `BREAK_TOO_LATE`, `BREAK_OUTSIDE_WINDOW`      | `warning` (60 Min: `error`) |
| Hinweis                                    | Pause nur als Summe gespeichert (`breakMinutes` ohne Pausenzeilen): Lage unbekannt                                                                                    | `BREAK_POSITION_UNKNOWN` — nie ein Verstoß, nie ein Kalendermarker, nie eine Mitteilung, sperrt den Monatsabschluss nicht | Hinweis                     |

### Pausenzählung (`totalBreakMin`)

Eine Pause ist die Summe aus:

1. **Explizite Pausen:** `breakMinutes` jedes TimeEntry-Slots
2. **Implizite Gaps:** Lücken zwischen aufeinanderfolgenden Slots am selben Tag
   - Gap **> 0 und ≤ 2h** → zählt als Pause
   - Gap **> 2h** → gilt als separate Schicht, NICHT als Pause
3. **Abschnittsregel (§ 4 Satz 2, seit Phase 511):** Für die Lage-Prüfung zählt ein Pausenabschnitt nur, wenn er mindestens **15 Min** lang ist, im Arbeitszeitraum des Tages liegt und weder den ersten Beginn noch das letzte Ende berührt (Jugendliche: zusätzlich nicht in der ersten oder letzten Stunde). Aneinandergrenzende Abschnitte gelten als eine Ruhepause. Ein nicht zählender Abschnitt bleibt Arbeitszeit für die Compliance-Zahl; der Saldo ändert sich nicht.
4. **Lücken zwischen Einträgen:** Im selben Salon zählt eine Lücke immer, gleich wie lang (Issue #523: die frühere Grenze von 120 Min ist entfallen, eine Ruhepause hat nach § 4 ArbZG keine Höchstdauer). Zwischen **verschiedenen Salons** zählt eine Lücke nie als Pause (Fahrzeit ist Arbeitszeit), es sei denn, die freie Zeit ist als Tagespause erfasst. Weil das System die Aufteilung in Fahrzeit und freie Zeit nicht kennt, rechnet es zwei Grenzfälle: ganze Lücke Arbeitszeit, freier Anteil am Anfang und am Ende der Lücke. Beide regelkonform → konform; beide verletzt → Verstoß; sonst Befund mit Sicherheit `UNCLEAR` („Klärung nötig: Fahrzeit oder Pause?“). Aufgelöst wird durch eine erfasste Tagespause, eine erfasste Fahrzeit oder eine Quittung der Führungskraft. Ist die Fahrt zwischen den beiden Salons als eigener Eintrag erfasst (Issue #92, Abschnitt „Fahrzeit zwischen Salons“), ist die Lücke Arbeitszeit und kein Grenzfall mehr: es gibt dann keine Lücke zu beurteilen, die Frage „Fahrzeit oder Pause?“ entfällt für diese Lücke, und die Tagessumme enthält die Fahrt.

### Auto-Break (opt-in pro Tenant)

Wenn `TenantConfig.autoBreakEnabled = true` und beim Clock-out (oder beim manuellen Anlegen) **keine Pause eingetragen** wurde, setzt Clokr automatisch. Das gilt für jeden Stempel-Auslöser gleich (Web, NFC-Terminal, WLAN-Präsenz; seit Issue #799 über einen gemeinsamen Schritt nach dem Ausstempeln, `applyAutoBreakAfterClockStop`); ein wiedereröffneter Eintrag mit Lücken-Pause bekommt keine zusätzliche:

- `30min` bei >6h Arbeit
- `45min` bei >9h Arbeit
- **Jugendliche (unter 18 am Arbeitstag):** mindestens die Menge nach § 11 JArbSchG — `30min` ab 4,5h, `60min` ab 6h; größer als die konfigurierte Menge wird sie angehoben, kleiner nie. Die Pause greift für Jugendliche schon ab 4,5h Anwesenheit und wirkt auf den Saldo nur bei künftigen automatischen Pausen.

**Schicht-Soll (Vertrag „Nach Schichtplan“, Issue #1056):** Das Arbeitszeitkonto zieht von einer geplanten Schicht dieselbe Pause ab wie die Erfassung und der Dienstplan (`breakAmountFor`). Für Jugendliche (unter 18 am Schichttag) gilt damit mindestens die Pause nach § 11 JArbSchG (`30min` ab 4,5h, `60min` ab 6h), das Alter wird je Schichttag bestimmt; am 18. Geburtstag gilt die Person als volljährig. Das gilt auch für die Entlastung an einem Krankheitstag auf einer geplanten Schicht (Lohnausfallprinzip). Für Erwachsene und für Personen ohne Geburtsdatum ändert sich keine Zahl. Abgeschlossene Monate bleiben unverändert; `apps/api/scripts/audit-1056-minor-shift-soll.ts` listet sie nur auf (lesend, nur Ids und Minuten). Eine Korrektur läuft, falls gewünscht, von Hand über eine Monatskorrektur (#599, Vier-Augen-Prinzip).

**Lage (seit Phase 511):** Die Pause wird in **Mandantenzeit** gesetzt und ist konform zu § 4 Satz 2/3 ArbZG (bzw. § 11 JArbSchG): jedes Teilstück mindestens 15 Min, kein Arbeitsblock über 6h (Jugendliche 4,5h), keine Pause am Anfang oder Ende (Jugendliche: nicht in der ersten oder letzten Stunde). Gewählt wird die konforme Lage, die der konfigurierten `TenantConfig.defaultBreakStart` am nächsten liegt, sonst die Mitte des Eintrags. Bei sehr langen Tagen entstehen mehrere Teilstücke gleicher Gesamtminutenzahl. Die Minutenzahl (und damit der Saldo) bleibt für Erwachsene unverändert. Vor Phase 511 wurde `defaultBreakStart` als Serverzeit (im Container UTC) gelesen — ein Berliner Mandant mit „12:00“ bekam die Pause im Sommer um 14:00.

Sobald MA bereits eine Pause eingegeben hat (z.B. nur 15min), greift Auto-Break NICHT — nur die ArbZG-Warnung erscheint. Das Erfassungsformular zeigt in der Vorschau „mit automatischer Pause“, wenn die Speicherung eine Pause setzen wird.

### Bekanntes Edge-Case-Verhalten

**Bei eingetragener kürzerer Pause als gesetzlich vorgeschrieben:** ERROR-Warnung erscheint im Eintrag, aber Speichern wird zugelassen. Begründung: Korrektur-Workflow für Manager (z.B. Notfall, falsche Slot-Zeit) darf nicht hart blockiert werden. Der Verstoß ist im AuditLog dokumentiert und kann via Reports nachvollzogen werden.

### Bekannte Grenzen der Pausenprüfung

- **„Im Voraus feststehend“ (§ 4 Satz 1):** Die Pausen müssen im Voraus feststehen. Das lässt sich aus Zeitstempeln nicht prüfen; ein erfasstes, abgeschlossenes Pausensegment gilt als Ruhepause.
- **Ältere Einträge ohne Pausenlage:** Nur als Summe gespeicherte Pausen erzeugen den Hinweis `BREAK_POSITION_UNKNOWN`, nie einen Verstoß. Vor dem Einschalten von `blockMonthCloseOnUnconfirmedBreak` den Probelauf `audit-511-break-placement.ts` lesen.
- **Fahrzeit zwischen Salons:** wird seit Issue #92 als eigener Eintrag erfasst (Abschnitt „Fahrzeit zwischen Salons“). Eine Lücke zwischen zwei Salons, für die keine Fahrzeit erfasst ist, bleibt die Grenzfall-Rechnung (`UNCLEAR`); das System erkennt eine Fahrt nicht selbst.
- **Jugendliche:** Auf der Erfassungsseite (Zeiteinträge) wird § 8 JArbSchG (Tages- und Wochenhöchstzeit) seit Issue #524 anstelle von § 3 ArbZG geprüft (Abschnitt „§ 8 JArbSchG — Zeiterfassung“); der Dienstplan wird seit Issue #1057 geprüft (Abschnitt „§ 8 / § 12 JArbSchG — Schichtplanung“), seit Issue #1076 auch nach §§ 13–17 (Abschnitt „§§ 13–17 JArbSchG — Schichtplanung“) und seit Issue #1106 auch nach § 18 (Abschnitt „§ 18 JArbSchG — Feiertagsruhe, Schichtplanung“). Fehlt das Geburtsdatum, gilt § 4 ArbZG; bei Auszubildenden weist der Befund darauf hin.
- **Geschlossene Monate** werden nie neu bewertet.
- **Tätigkeitsart (#81):** Die Tätigkeitsart ändert keine Arbeitszeit-, Pausen- oder Ruhezeitprüfung. Ein Fahrzeiteintrag (#92) zählt wie jeder Eintrag voll als Arbeitszeit; die Art „Fahrzeit“ selbst verändert auch hier keine Prüfung.
- **Rechtsgrund im Befund:** Der Verweis auf § 11 JArbSchG im Befundtext lässt auf Minderjährigkeit schließen; Geburtsdatum und Alter werden nie ausgegeben.

---

## § 8 / § 12 JArbSchG — Schichtplanung (Issue #1057)

Wer eine Schicht für eine Person plant, die am Schichttag unter 18 ist, bekommt die Grenzen des Jugendarbeitsschutzgesetzes geprüft. Die Prüfung liegt in `apps/api/src/contexts/scheduling/minor-shift-limits.ts`; sie liest nur und schreibt weder Schicht noch Audit noch Saldo.

### Geltung

- Für eine Person unter 18 gilt das JArbSchG anstelle des ArbZG (§ 18 Abs. 2 ArbZG). „Unter 18“ wird **je Schichttag** entschieden (`isMinorAtDate`); der 18. Geburtstag selbst zählt schon als volljährig (§ 187 Abs. 2 Satz 2 BGB). Eine Woche mit Geburtstag wird deshalb tageweise geprüft.
- Fehlt das Geburtsdatum, gilt die Person als volljährig: Verhalten unverändert (§ 3 und § 5 ArbZG, kein neuer Code).
- Die Prüfung läuft vor der § 3-ArbZG-Prüfung und meldet eigene Codes.

### Regeln

Arbeitszeit ist die geplante Schichtzeit **abzüglich der Ruhepause** nach § 11 JArbSchG (dieselbe Pausenregel wie die Erfassung, `breakAmountFor`) plus die Berufsschulzeit des Tages nach § 9 Abs. 2 JArbSchG (die bestehende Anrechnung des Arbeitszeitkontos, nur gelesen). Für die Wochengrenze zählt außerdem die Arbeitszeit, die an einem Feiertag ausfällt (§ 4 Abs. 4 Satz 2 JArbSchG, Issue #1077; Lesart unten).

| Grenze               | Wert                                                                                                                  | Rechtsgrund                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Tag                  | höchstens 8 Stunden                                                                                                   | § 8 Abs. 1 JArbSchG                         |
| Tag, verkürzte Woche | bis 8,5 Stunden, wenn ein anderer Werktag (Mo–Sa) derselben Woche weniger als 8 Stunden Arbeitszeit hat               | § 8 Abs. 2a JArbSchG                        |
| Woche                | höchstens 40 Stunden, Montag bis Sonntag, nur Tage als Jugendliche, Berufsschulzeit und Feiertagsausfall eingerechnet | § 8 Abs. 1, § 4 Abs. 4, § 9 Abs. 2 JArbSchG |
| Schichtzeit          | höchstens 10 Stunden vom ersten Beginn bis zum letzten Ende des Tages, Pausen und Teildienst-Lücken eingeschlossen    | § 12 JArbSchG                               |

Lesart zu § 8 Abs. 2a: Ein Werktag ohne jede Arbeit zählt als „auf weniger als acht Stunden verkürzt“ (Wortlaut). Die engere Lesart (nur ein gearbeiteter kurzer Tag) würde rechtmäßige Wochen mit Urlaubs- oder Feiertag hart sperren, ohne Ausnahmemöglichkeit.

Lesart zu § 4 Abs. 4 Satz 2 (Issue #1077, Owner-Entscheidung 26.11.2026): Die Arbeitszeit, die an einem Feiertag ausfällt, zählt auf die 40 Stunden der Woche.

- **Ausfall = Soll des Tages laut Vertrag**, nicht die geplante Schicht und kein Schnitt aus geplanten Schichten. Ein Feiertag, den die Planung leer lässt, macht die Woche deshalb nicht kleiner.
- **Bewertung wie im Arbeitszeitkonto** (`calcExpectedMinutesTz` über genau diesen Tag), für den **am Tag gültigen Vertrag**: fester Plan = Stunden des Wochentags; Monatsstunden = Ø-Tag des Monats; Schichtplan und Gleitzeit = Wochenstunden geteilt durch die Vertragstage, an einem Vertragstag. Ein Tag ohne Vertragssoll (zum Beispiel der freie Wochentag eines festen Plans) bewertet mit 0.
- **Welche Feiertage:** gesetzliche und Salon-Feiertage am Arbeitsort des Tages, genau die Menge der zentralen Feiertagsauflösung (§ 2 EFZG), wie im Arbeitszeitkonto.
- **Nur Werktage** (Mo–Sa; das Gesetz sagt „an einem Werktag“): ein Feiertag auf einen Sonntag zählt nichts. Es zählen nur Tage, an denen die Person unter 18 ist und im Arbeitsverhältnis steht (Eintritt bis Austritt).
- **Eine Schicht am Feiertag** zählt nie doppelt: Der Tag zählt den größeren Wert aus Vertragssoll und geplanter Arbeitszeit.
- **Nur die Wochensumme:** Tagesgrenze, § 8 Abs. 2a (der Feiertag bleibt ein verkürzter Werktag), §§ 12–17 und die Fünf-Tage-Woche bleiben unverändert; der Feiertag ist kein Arbeitstag nach § 15.
- **Meldung:** Enthält die Woche Feiertagszeit, nennt die Meldung sie in einem zusätzlichen Satz („Darin sind 8:00 Stunden eingerechnet, die an einem Feiertag ausfallen“). Ohne Feiertag bleibt der Text unverändert.

### Meldung

- POST und PUT `/api/v1/shifts` antworten 422 mit `error: "JArbSchG-Verstoß"`, `canForce: false` und einem der Codes `JARBSCHG_VIOLATION_DAILY_MAX`, `JARBSCHG_VIOLATION_WEEKLY_MAX`, `JARBSCHG_VIOLATION_SHIFT_TIME` (Issue #1057) oder `JARBSCHG_VIOLATION_NIGHT_REST`, `JARBSCHG_VIOLATION_SUNDAY_REST`, `JARBSCHG_VIOLATION_FREE_TIME`, `JARBSCHG_VIOLATION_FIVE_DAY_WEEK` (Issue #1076, siehe den Abschnitt „§§ 13–17 JArbSchG — Schichtplanung“) oder `JARBSCHG_VIOLATION_HOLIDAY_REST` (Issue #1106, siehe den Abschnitt „§ 18 JArbSchG — Feiertagsruhe, Schichtplanung“). `?force=true` ändert nichts. Die Meldung ist deutsch und nennt Tag und Grenze.
- Sammelzuweisung (`/bulk`) lehnt bei einem Verstoß die **ganze** Anfrage ab (atomar). Wiederherstellen einer durch die Berufsschul-Bereinigung gelöschten Schicht wird wie eine neue Schicht geprüft.
- „Muster anwenden“ (generate-week) und „Woche kopieren“ (copy-week) überspringen die betroffene Zelle mit dem Grund „Jugendarbeitsschutz“, in Vorschau und Übernahme gleich.
- Abgelehnt wird nur, was einen Verstoß **erzeugt oder vergrößert** (Tageswert, Schichtzeit oder Wochensumme wächst). Ein bereits unzulässiger Plan (Altbestand, Phorest-Import) sperrt den Dienstplan nicht: Verkürzen, Verschieben weg vom Tag und reine Textänderungen bleiben möglich.
- Eine abgelehnte Anfrage schreibt keine Schicht und keinen Audit-Eintrag; Saldo, Soll und Arbeitszeitkonto sind nicht berührt.

### Phorest-Import (Issue #1074)

Phorest führt den Plan, ein Abgleich kann keine Schicht ablehnen, kürzen oder verschieben. Das Gesetz verbietet das Beschäftigen über die Grenzen hinaus; die Ordnungswidrigkeit (§ 58 Abs. 1 Nr. 5 und 8 JArbSchG) entsteht am Arbeitstag. Clokr übernimmt die Schicht deshalb unverändert und meldet den Befund rechtzeitig vor dem Tag.

- Nach jedem erfolgreichen Abgleich prüft Clokr jede Woche, in die der Lauf eine Schicht übernommen hat (Import und Übernahme einer Altschicht), mit **derselben Prüfung wie der Dienstplan** (seit Issue #1076 einschließlich §§ 13–17, seit Issue #1106 einschließlich § 18 JArbSchG, ohne zweite Stelle): alle Schichten der Person in allen Salons (§ 4 Abs. 5 JArbSchG), Berufsschulzeit, Alter je Tag. Geprüft wird der gespeicherte Stand der ganzen Woche.
- Wer die Schichten des Salons plant (Reichweite `shift:plan`), bekommt eine Benachrichtigung mit Tag, Stunden und Grenze. Die Person selbst bekommt keine Meldung.
- Dieselbe offene Meldung wird nicht wiederholt, ein geänderter Befund (anderer Tag, andere Stunden) kommt neu. Nach dem Ausblenden meldet der nächste Lauf erneut, solange der Plan unzulässig ist.
- Der Lauf bleibt erfolgreich, auch wenn die Meldung scheitert. Es gibt keinen Audit-Eintrag: Es wird nichts geändert, die Benachrichtigung ist der Nachweis.

### Einführung (Issue #1077)

Der erste Phorest-Lauf nach dem Release kann für eine Woche mit Feiertag einmal neu benachrichtigen, weil die Meldung jetzt die Feiertagszeit nennt (inhaltsbewusste Dedup, Issue #1074). Bestehende Pläne werden nicht nachträglich abgelehnt: Abgelehnt wird nur, was einen Verstoß erzeugt oder vergrößert.

### Bekannte Grenzen

- **§ 8 Abs. 2 JArbSchG (Brückentage, Fünf-Wochen-Schnitt)** ist nicht abgebildet; die Wochenprüfung blockiert eine solche Gestaltung (selten, bewusst konservativ).
- **Phorest-Import:** wird gemeldet, nicht abgelehnt (Issue #1074, siehe „Phorest-Import“ oben).
- **§§ 13–17 JArbSchG** (Freizeit, Nachtruhe, Fünf-Tage-Woche, Samstags- und Sonntagsruhe) prüft der Dienstplan seit Issue #1076, die Phorest-Meldung mit derselben Prüfung (Abschnitt „§§ 13–17 JArbSchG — Schichtplanung“); **§ 18** (Feiertagsruhe) seit Issue #1106 (Abschnitt „§ 18 JArbSchG — Feiertagsruhe, Schichtplanung“).
- **Zeiterfassung:** erfasste Zeiten prüft seit Issue #524 der Abschnitt „§ 8 JArbSchG — Zeiterfassung“ mit derselben Rechenregel.
- Alle Schreibwege sind in `apps/api/src/__tests__/shift-write-paths-1057.test.ts` nach Aufrufmuster mit Urteil erfasst.

### Datenschutz

Das Geburtsdatum verlässt den Server nie: weder Antwort noch Überspringen-Eintrag enthalten es. Dasselbe gilt für die Phorest-Meldung (Issue #1074): Benachrichtigung, E-Mail-Betreff („Hinweis zur Schichtplanung“) und Push-Text enthalten weder Geburtsdatum noch Alter. Der Verweis auf § 8, § 12, §§ 13–17 oder § 18 JArbSchG in der Meldung lässt auf Minderjährigkeit schließen (dieselbe hingenommene Offenlegung wie beim Pausenbefund, „Rechtsgrund im Befund“).

## § 8 JArbSchG — Zeiterfassung (Issue #524)

Für eine Person, die am Arbeitstag unter 18 ist, tritt das JArbSchG an die Stelle des ArbZG (§ 18 Abs. 2 ArbZG). Auf der Erfassungsseite heißt das: Dieselben Schreibwege, die für Erwachsene die Tages- und Wochenbefunde nach § 3 ArbZG liefern, liefern für Jugendliche die Befunde nach § 8 JArbSchG. Die Rechenregel steht **einmal**, in `apps/api/src/contexts/time-tracking/minor-working-time.ts`; der Dienstplan (Issue #1057) ruft dieselben Funktionen auf, damit Planung und Erfassung nicht auseinanderlaufen.

### Geltung

- „Unter 18“ wird **je Arbeitstag** entschieden (`isMinorAtDate`); der 18. Geburtstag selbst zählt schon als volljährig. Der Befund folgt dem geänderten Tag, wie bei der Pausenregel nach § 11 JArbSchG. Fehlt das Geburtsdatum, gilt die Person als volljährig: Verhalten und Text unverändert.
- Für einen Jugendlichen-Tag entfallen die Befunde `MAX_DAILY_EXCEEDED`, `MAX_WEEKLY_EXCEEDED` und `MAX_DAILY_AVG_EXCEEDED`. § 5 ArbZG (Ruhezeit) bleibt unverändert; § 13 JArbSchG (12 Stunden Freizeit) ist auf der Erfassungsseite nicht abgebildet.

### Regeln

Arbeitszeit ist die erfasste Arbeitszeit aller abgeschlossenen Arbeitseinträge des Tages in allen Salons (nach Pause) plus die Berufsschulzeit eines Berufsschultags (§ 9 Abs. 2 JArbSchG, Anrechnung des Arbeitszeitkontos). Die Woche läuft Montag bis Sonntag; es zählen nur Tage, an denen die Person unter 18 ist, und die Arbeitszeit, die an einem Werktags-Feiertag am Arbeitsort ausfällt (§ 4 Abs. 4 Satz 2 JArbSchG, dieselbe Bewertung wie im Dienstplan, Issue #1077).

| Code                           | Grenze                                                                                                               | Rechtsgrund                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `JARBSCHG_DAILY_MAX_EXCEEDED`  | Tag höchstens 8 Stunden, bis 8,5 Stunden, wenn ein anderer Werktag (Mo–Sa) derselben Woche weniger als 8 Stunden hat | § 8 Abs. 1 und 2a JArbSchG                  |
| `JARBSCHG_WEEKLY_MAX_EXCEEDED` | Woche höchstens 40 Stunden, Berufsschulzeit und Feiertagsausfall eingerechnet                                        | § 8 Abs. 1, § 4 Abs. 4, § 9 Abs. 2 JArbSchG |

Beide Befunde sind Fehler-Hinweise (`severity: "error"`) mit `legalBasis`. Lesart zu § 8 Abs. 2a wie im Dienstplan: Ein Werktag ohne Arbeit zählt als verkürzt. § 8 Abs. 2 (Brückentage, Fünf-Wochen-Schnitt) und Abs. 3 (Landwirtschaft) sind nicht abgebildet.

### Warnung, keine Sperre

Wie § 3 ArbZG blockiert der Befund das Speichern nicht (POST, PUT, Genehmigung eines Zeitnachtrags, Ausstempeln am Web): Eine Erfassung hält fest, was gearbeitet wurde (BAG 13.09.2022 – 1 ABR 22/21; § 16 Abs. 2 ArbZG). Sie zu verweigern würde die Aufzeichnung verfälschen und den Verstoß verbergen. Die bestehende harte Sperre am Berufsschultag nach § 9 JArbSchG (400 `JARBSCHG_MINOR_LIMIT`) bleibt unverändert.

### Tagesansichten ohne Woche

Die Tagesprüfung (`POST /api/v1/day-breaks/preview`, `GET /api/v1/day-breaks/checks`) kennt keine Woche und beurteilt für einen Jugendlichen die Obergrenze von 8,5 Stunden (§ 8 Abs. 2a): Mehr ist in keiner Woche zulässig. Die engere Grenze von 8 Stunden gilt nur, wenn alle anderen Werktage mindestens 8 Stunden haben, die Woche also ohnehin über 40 Stunden liegt; das nennt die Antwort des Speicherns.

### Sichtbarkeit

Beide Befunde ruhen auf der ISO-Woche (`warningWindow`). Wer nicht jeden Eintrag der Woche lesen darf, bekommt statt des Befunds den neutralen Hinweis `FINDING_WITHHELD` (Issue #85).

## §§ 13–17 JArbSchG — Schichtplanung (Issue #1076)

Dieselbe Prüfung (`apps/api/src/contexts/scheduling/minor-shift-limits.ts`) kennt neben § 8 und § 12 auch die Freizeit, die Nachtruhe, die Fünf-Tage-Woche und die Sonntagsruhe. Der Dienstplan (Regel 4 von `checkShiftWrite`) und die Phorest-Meldung rufen sie unverändert auf; keine Regel wird ein zweites Mal gerechnet. Antwort, Reihenfolge der Regeln und „Nur Verschlechterung“ sind wie bei Issue #1057 (422 `JArbSchG-Verstoß`, `canForce: false`, `?force=true` ändert nichts).

### Geltung

- „Unter 18“ wird je Schichttag entschieden, der 18. Geburtstag selbst zählt als volljährig; ohne Geburtsdatum gilt die Person als volljährig (wie oben).
- **Branche:** Clokr speichert keine Branche. Jeder Mandant wird als Friseurbetrieb gelesen, denn das Produkt ist für Salons gebaut. Daran hängt nur der Samstag (§ 16 Abs. 2 Satz 1 Nr. 2 „im Friseurhandwerk“); §§ 13, 14 und 17 kennen keinen Friseurfall, dort gilt die strenge Regel. Eine Einstellung dafür gibt es bewusst nicht: Sie würde heute nur § 16 umschalten, und es gibt keinen Mandanten einer anderen Branche. Ein Mandant einer anderen Branche oder eine Anzeige nach § 14 Abs. 5 JArbSchG wäre der Anlass für eine Einstellung.

### Regeln

| Regel                      | Grenze                                                                                                                                                                                    | Rechtsgrund                               | Code                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Freizeit                   | mindestens 12 Stunden zwischen dem letzten Ende eines Tages und dem ersten Beginn des nächsten Kalendertags, in beide Richtungen und über die Wochengrenze                                | § 13 JArbSchG                             | `JARBSCHG_VIOLATION_FREE_TIME`              |
| Nachtruhe                  | Arbeit nur von 6 bis 20 Uhr; jede Minute außerhalb zählt, auch der Teil einer Schicht über Mitternacht                                                                                    | § 14 Abs. 1 JArbSchG                      | `JARBSCHG_VIOLATION_NIGHT_REST`             |
| Fünf-Tage-Woche            | höchstens fünf Tage mit Schicht oder Berufsschule je Woche (Montag bis Sonntag)                                                                                                           | § 15 Satz 1, § 16 Abs. 3 JArbSchG         | `JARBSCHG_VIOLATION_FIVE_DAY_WEEK`          |
| Samstag im Friseurhandwerk | ein sechster Tag mit Samstagsschicht bleibt zulässig, wenn ein anderer Tag Mo–Fr ohne Berufsschule bis 13 Uhr endet und höchstens 8:00 Stunden minus die Arbeitszeit des Samstags umfasst | § 16 Abs. 2 Satz 1 Nr. 2, Abs. 4 JArbSchG | (kein eigener Code, hebt FIVE_DAY_WEEK auf) |
| Sonntag                    | keine Schicht an einem Sonntag; Absatz 2 nennt keinen Friseurfall                                                                                                                         | § 17 Abs. 1 JArbSchG                      | `JARBSCHG_VIOLATION_SUNDAY_REST`            |

Der Samstag allein wird nie abgelehnt: Die Samstagsarbeit im Friseurhandwerk ist erlaubt (§ 16 Abs. 2 Satz 1 Nr. 2). Mit den fünf Werktagen davor ist die Fünf-Tage-Woche dagegen voll.

### Geprüfte Ausnahmen der Branche

- **§ 14 Abs. 2 Nr. 1, 3 und 4** (Gaststätten- und Schaustellergewerbe, Landwirtschaft, Bäckereien und Konditoreien), **Abs. 3** (Bäckereien, über 17 Jahre), **Abs. 6** (Betriebe mit außergewöhnlicher Hitze) und **Abs. 7** (Aufführungen, Aufnahmen, Sport) betreffen andere Branchen oder Sonderfälle. **Abs. 2 Nr. 2** (mehrschichtige Betriebe, über 16 Jahre bis 23 Uhr) wird nicht angewendet: Clokr erkennt keinen Mehrschichtbetrieb, und ein Salon mit versetzten Beginnzeiten ist keiner. **Abs. 5** verlangt eine vorherige Anzeige bei der Aufsichtsbehörde, die Clokr nicht kennt; **Abs. 4** schränkt nur die Verlängerungen vor einem Berufsschultag ein. 16- und 17-Jährige teilen deshalb dieselbe Grenze 6 bis 20 Uhr. § 21a nennt § 14 nicht.
- **§ 16 Abs. 2 Satz 1 Nr. 2:** „im Friseurhandwerk“ erlaubt die Samstagsarbeit; deshalb ist der Samstag kein Verbot.
- **§ 17 Abs. 2:** kennt keinen Friseurfall (Krankenanstalten, Gaststätten, Landwirtschaft u. a.); die Sonntagsruhe gilt streng.
- **§ 13** hat keine Branchenausnahme; § 21a nennt ihn nicht.

### Lesarten

- **Berufsschule in der Fünf-Tage-Woche:** Ein Berufsschultag zählt als Tag ohne Ruhe, denn § 16 Abs. 3 Satz 1 und § 17 Abs. 3 Satz 1 verlangen einen „berufsschulfreien“ Ausgleichstag. Im Salon (Sonntag verboten) ist ein sechster Tag immer ein Samstag, auf den § 16 Abs. 3 wörtlich passt. Der Berufsschultag kommt aus den Abwesenheiten (`VOCATIONAL_SCHOOL`).
- **18. Geburtstag und § 13:** Die Freizeit gilt, wenn die Person am **späteren** Tag unter 18 ist: Das Verbot trifft die Beschäftigung, die zu früh beginnt. Am 18. Geburtstag antwortet § 5 ArbZG (11 Stunden, 409, übersteuerbar); für Jugendliche antwortet § 13 zuerst, sodass diese 409 nur beim Übergang bleibt. Berufsschulzeit hat in Clokr keine Uhrzeiten und geht in § 13 nicht ein.
- **Nur Verschlechterung:** Abgelehnt wird nur, was die Nachtminuten, die Sonntagsminuten oder die Zahl der Tage vergrößert oder eine Freizeit verkürzt (oder neu unter 12 Stunden bringt). Ein bereits unzulässiger Plan sperrt den Dienstplan nicht.

### Bewusst keine Ablehnung

- **§ 16 Abs. 2 Satz 2** („Mindestens zwei Samstage im Monat sollen beschäftigungsfrei bleiben“) ist eine Sollvorschrift; § 58 Abs. 1 Nr. 13 nennt nur § 16 Abs. 1 und Abs. 3 Satz 1, und § 21a Abs. 1 Nr. 4 erlaubt Tarifabweichungen (26 Samstage im Jahr oder jeden Samstag). Eine nicht übersteuerbare 422 würde rechtmäßige Pläne ohne Ausweg sperren, dieselbe Lesart wie bei § 8 Abs. 2a (Issue #1057). Ein weicher, übersteuerbarer Hinweis ist ein Folge-Issue.
- **§ 15 Satz 2** (die zwei Ruhetage „sollen nach Möglichkeit aufeinander folgen“) hängt an der Machbarkeit und ist nicht bußgeldbewehrt (§ 58 Abs. 1 Nr. 12 nennt § 15 ohne den Satz; die Ordnungswidrigkeit ist der sechste Tag).

### Bekannte Grenzen

- **§ 18 JArbSchG** (Feiertagsruhe, 24. und 31. Dezember nach 14 Uhr) gehört nicht zu Issue #1076; er wird seit Issue #1106 geprüft (Abschnitt „§ 18 JArbSchG — Feiertagsruhe, Schichtplanung“).
- **§ 21 und § 21a** (Abweichungen durch Tarifvertrag, Aufsichtsbehörde) sind nicht abgebildet, wie bei Issue #1057; ebenso § 9 Abs. 1 Nr. 1.
- **Phorest:** Eine neue Sonntagsschicht, die die Freizeit zum Montag der Folgewoche verletzt, erscheint in der Folgewoche erst, wenn diese Woche geprüft wird; die Sonntagsschicht selbst wird immer nach § 17 gemeldet.
- Berufsschulzeit hat keine Uhrzeiten; § 13 wird nur zwischen Schichten geprüft.

### Einführung

Der erste Phorest-Lauf nach dem Release kann für die Woche einer Person unter 18 eine neue Benachrichtigung senden, weil der Befund jetzt auch §§ 13–17 enthält (inhaltsbewusste Dedup, Issue #1074).

## § 18 JArbSchG — Feiertagsruhe, Schichtplanung (Issue #1106)

Dieselbe Prüfung (`apps/api/src/contexts/scheduling/minor-shift-limits.ts`, Regel 4 von `checkShiftWrite`) kennt neben §§ 8, 12–17 auch § 18 Abs. 1. Jeder Schreibweg des Dienstplans (POST, PUT, Wiederherstellen, Sammelzuweisung, „Muster anwenden“, „Woche kopieren“) und die Phorest-Meldung rufen sie unverändert auf. Antwort und Reihenfolge sind wie bei Issue #1057 (422 `JArbSchG-Verstoß`, `canForce: false`, `?force=true` ändert nichts). Ein Verstoß ist eine Ordnungswidrigkeit (§ 58 Abs. 1 Nr. 15 JArbSchG).

### Geltung

- „Unter 18“ wird je Schichttag entschieden, der 18. Geburtstag selbst zählt als volljährig; ohne Geburtsdatum gilt die Person als volljährig (wie oben). Jeder Mandant wird als Friseurbetrieb gelesen (wie bei Issue #1076).

### Regeln

| Regel                                                        | Grenze                                                                     | Rechtsgrund          | Code                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------- | --------------------------------- |
| Gesetzlicher Feiertag am Salon der Schicht                   | keine Schicht an einem Feiertag des Salons, in dem die Schicht geplant ist | § 18 Abs. 1 JArbSchG | `JARBSCHG_VIOLATION_HOLIDAY_REST` |
| 24. und 31. Dezember nach 14 Uhr, Schicht bis 14:00 zulässig | jede geplante Minute nach 14:00 Uhr an diesen beiden Tagen                 | § 18 Abs. 1 JArbSchG | `JARBSCHG_VIOLATION_HOLIDAY_REST` |

### Geprüfte Ausnahmen

§ 18 Abs. 1 lautet: „Am 24. und 31. Dezember nach 14 Uhr und an gesetzlichen Feiertagen dürfen Jugendliche nicht beschäftigt werden.“ Beide Verbote stehen in § 18 Abs. 1, nicht in § 14 und nicht in § 17. Für einen Friseurbetrieb greift keine Ausnahme:

- **§ 18 Abs. 2** erlaubt Feiertagsarbeit nur „in den Fällen des § 17 Abs. 2“, außer am 25. Dezember, 1. Januar, ersten Osterfeiertag und 1. Mai. § 17 Abs. 2 Satz 1 nennt abschließend: Krankenanstalten sowie Alten-, Pflege- und Kinderheime; Landwirtschaft und Tierhaltung; Familienhaushalt; Schaustellergewerbe; Musik-, Theater- und andere Aufführungen sowie Direktsendungen im Rundfunk; Sport; ärztlichen Notdienst; Gaststättengewerbe. Ein Friseurbetrieb ist keiner dieser Fälle.
- **Gegenprobe im selben Gesetz:** Wo das Friseurhandwerk eine Ausnahme bekommen soll, nennt das Gesetz es ausdrücklich (§ 16 Abs. 2 Satz 1 Nr. 2, Samstag). In § 17 Abs. 2 und damit in § 18 Abs. 2 fehlt es.
- Die Ausnahme in Abs. 2 gilt nur für Feiertage. Für den **24. und 31. Dezember nach 14 Uhr** gibt es für keine Branche eine Ausnahme.
- **§ 21a Abs. 1** erlaubt dem Tarifvertrag Abweichungen nur von § 18 Abs. 3, nicht von Abs. 1.
- **§ 18 Abs. 3** (Freistellung an einem anderen berufsschulfreien Arbeitstag) folgt nur auf eine nach Abs. 2 zulässige Feiertagsarbeit. Die gibt es im Salon nicht; Clokr bildet deshalb keinen Freistellungstag ab.

### Lesarten

- **Welcher Feiertag:** der gesetzliche Feiertag am **Salon der Schicht**, je Schicht. Der Salon einer geplanten Schicht ist ihr Arbeitsort, und die Feiertagsgesetze der Länder gelten dort, wo beschäftigt wird. Gelesen wird über die zentrale Feiertagsauflösung im Unterbau (`holidaysForSalon`), nicht über die Tagesauflösung der Zeiterfassung (`holidaysAtWorkLocation`, § 2 EFZG), die aus einem abgeschlossenen Zeiteintrag, der Salonzuordnung oder dem Standardsalon einen Salon je Tag bestimmt. Beispiel: Der Reformationstag (31.10.) sperrt eine Schicht im niedersächsischen Salon und nicht im bayerischen.
- **Salon-Feiertage zählen:** ein im Salon eingetragener Feiertag sperrt wie ein gesetzlicher (dieselbe Menge, die das Soll und § 4 Abs. 4 Satz 2 lesen).
- **24. und 31. Dezember:** feste Kalendertage ohne Feiertagssuche. Jede geplante Minute nach 14:00 Uhr ist ein Verstoß, eine Schicht bis 14:00 Uhr ist zulässig. Für Jugendliche liegt keine Pause in der letzten Stunde (§ 11 Abs. 2 JArbSchG), das Schichtende ist also das Ende der Beschäftigung. Fällt auf den Tag zugleich ein Salon-Feiertag, nennt die Meldung den Feiertag.
- **Feiertag auf einem Sonntag:** § 17 und § 18 sind verletzt. Der Dienstplan antwortet mit der Sonntagsruhe, die Phorest-Meldung nennt beide.
- **Nur Verschlechterung:** Abgelehnt wird nur, was die Feiertagsminuten oder die Minuten nach 14 Uhr eines Tages vergrößert. Text ändern, kürzen, auf einen anderen Tag oder in einen Salon ohne diesen Feiertag verlegen bleibt möglich; neue Schichten an anderen Tagen der Woche werden angenommen. Eine Schicht über Mitternacht wird nach ihrem Beginntag beurteilt (ihr Teil am Folgetag ist Nachtruhe, § 14).
- **Ohne Salon:** Ein Eintrag ohne Salon (Vorschau von „Muster anwenden“ oder „Woche kopieren“ in einem Mandanten ohne aktiven Salon) bekommt keine Feiertagssuche; die Zelle wird beim Übernehmen ohnehin mit 409 `NO_ACTIVE_SALON` abgelehnt und nie gespeichert. Fehlt der Salon einer geprüften Schicht in der geladenen Feiertagsliste, bricht die Prüfung ab (fail-closed), statt „kein Feiertag“ zu raten.

### Bekannte Grenzen

- Die **Zeiterfassung** (tatsächlich geleistete Zeit an einem Feiertag) wird nicht geprüft (Issue #524).
- Das Feiertags-Soll nach § 4 Abs. 4 Satz 2 (Issue #1077) liest den Arbeitsort aus der Salonzuordnung, § 18 den Salon der Schicht. Wer in einem Salon eines anderen Bundeslandes als der zugeordnete geplant ist, kann dort zwei verschiedene Feiertage sehen. Das ist unverändert und ein Kandidat für ein Folge-Issue.
- Je Wochenprüfung kostet die Feiertagsliste eine Salonabfrage plus zwei Abfragen je Salon des Mandanten (inaktive eingeschlossen), nur wenn die Woche eine Person unter 18 enthält; reine Erwachsenen-Schreibvorgänge zahlen nichts.

### Einführung

Der erste Phorest-Lauf nach dem Release kann für Wochen mit einer Feiertagsschicht oder einer Schicht nach 14 Uhr am 24./31. Dezember einer Person unter 18 eine neue Benachrichtigung senden (inhaltsbewusste Dedup, Issue #1074). Bestehende Pläne werden nicht rückwirkend abgelehnt.

## Schichtplanung — eine Prüfung für jeden Schreibweg (Issue #1075)

Jeder Weg, der Arbeitszeit in den Dienstplan **hinzufügt**, läuft durch dieselbe Funktion `checkShiftWrite` (`apps/api/src/contexts/scheduling/shift-write-checks.ts`) mit denselben sechs Regeln in derselben Reihenfolge. Kein Weg rechnet eine Regel selbst. Die Prüfung liest nur; sie schreibt weder Schicht noch Audit noch Saldo.

### Die sechs Regeln

Die erste Regel, die anschlägt, antwortet.

| Nr. | Regel                                   | Antwort                                 | Übersteuerbar             |
| --- | --------------------------------------- | --------------------------------------- | ------------------------- |
| 1   | Vertrag am Tag, nicht nach dem Austritt | 422 `SHIFT_NO_CONTRACT`                 | nein                      |
| 2   | Vergangenheit                           | 422 `SHIFT_PAST_IMMUTABLE`              | nein                      |
| 3   | Öffnungszeiten des Salons               | 409 `SHIFT_OUTSIDE_STORE_HOURS`         | ja, nur bei einer Schicht |
| 4   | JArbSchG (§§ 8, 12–18)                  | 422 `JARBSCHG_VIOLATION_*` (siehe oben) | nein                      |
| 5   | § 3 ArbZG, Tageshöchstzeit              | 422 `ARBZG_VIOLATION_DAILY_MAX`         | nein                      |
| 6   | § 5 ArbZG, Ruhezeit                     | 409 `ARBZG_VIOLATION_REST_PERIOD`       | ja, nur bei einer Schicht |

- **Vertrag** heißt: eine Vertragszeile (`WorkSchedule`) gilt an dem Tag **und** der Tag liegt nicht nach dem Austrittstag (`Employee.exitDate`, Kalendertag in der Zeitzone des Unternehmens). Der Austrittstag selbst bleibt planbar (Issue #1101); ein Tag danach wird wie ein Tag vor Vertragsbeginn mit 422 `SHIFT_NO_CONTRACT` abgelehnt bzw. mit dem Grund `no-contract` übersprungen. „Muster anwenden“ überspringt Tage nach dem Austritt schon vor der Prüfung (Grund `no-pattern`).
- **Vergangenheit** heißt: vor dem heutigen Kalendertag **des Unternehmens** (Zeitzone des Unternehmens, nicht die Serveruhr). Heute bleibt planbar. Die Sperre gilt für Anlegen, Ändern (alter und neuer Tag), Wiederherstellen, Sammelzuweisung, „Muster anwenden“, „Woche kopieren“ und Löschen (Revisionssicherheit).
- **§ 3 ArbZG ist eine Tagesregel** (§ 3 Satz 1 „werktägliche Arbeitszeit“, § 2 Abs. 1): Es zählt die **Summe** aller Schichten der Person an dem Tag, jede mit der einen Pausenregel (`breakAmountFor`) abgezogen. Mehr als 10 Stunden netto sind nicht zulässig; eine Schicht von 08:00 bis 13:00 plus eine von 13:30 bis 19:30 (11 Stunden) wird abgelehnt. Die Meldung nennt den Tag und die Stunden. Die 8-Stunden-Regel ist ein Durchschnitt über 24 Wochen und wird im Dienstplan nicht als Tagesgrenze behandelt.
- **§ 5 ArbZG gilt in beide Richtungen** (§ 5 Abs. 1 „nach Beendigung der täglichen Arbeitszeit“): Eine neue Schicht verkürzt die Ruhezeit zur letzten Schicht des Vortags **und** zur ersten Schicht des Folgetags. Wie die Erfassung prüft der Dienstplan Vortag und Folgetag. Bei einer übersteuerten Schicht schreibt Clokr je verletzter Richtung einen Eintrag `SHIFT_FORCED_OVER_ARBZG` (`prevShiftId` für den Vortag, `nextShiftId` für den Folgetag).
- Für Jugendliche läuft zuerst die Prüfung nach JArbSchG (Regel 4); § 3 und § 5 ArbZG laufen weiter. Für Jugendliche antwortet die Freizeit nach § 13 JArbSchG (12 Stunden, 422) vor § 5 ArbZG; die 11-Stunden-Ruhe mit 409 bleibt nur am 18. Geburtstag.
- Eine Schicht ohne Dauer (Beginn gleich Ende) zählt 0 Minuten.

### Schreibwege

| Weg                                           | Antwort bei einem Befund                                                 | `?force=true`                 |
| --------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Schicht anlegen (`POST /shifts`)              | Ablehnung (422 oder 409)                                                 | ja: Öffnungszeiten, § 5 ArbZG |
| Schicht ändern (`PUT /shifts/:id`)            | Ablehnung, nur bei Verschlechterung                                      | ja: Öffnungszeiten, § 5 ArbZG |
| Wiederherstellen (`POST /shifts/:id/restore`) | Ablehnung wie beim Anlegen; die Hinweise-Seite fragt vor dem Übersteuern | ja: Öffnungszeiten, § 5 ArbZG |
| Sammelzuweisung (`POST /shifts/bulk`)         | die **ganze** Anfrage wird abgelehnt, mit `itemIndex`, `canForce: false` | nein                          |
| „Muster anwenden“ (`generate-week`)           | die Zelle wird mit Grund und Meldung übersprungen                        | nein                          |
| „Woche kopieren“ (`copy-week`)                | die Zelle wird mit Grund und Meldung übersprungen                        | nein                          |
| Löschen (`DELETE /shifts/:id`)                | nur die Vergangenheitssperre (Löschen entfernt Zeit)                     | nein                          |

Die Übersteuerung ist eine bewusste, protokollierte Entscheidung für genau **eine** Schicht (`SHIFT_FORCED_OUTSIDE_HOURS`, `SHIFT_FORCED_OVER_ARBZG`). Ein Muster, eine Kopie oder eine Sammelzuweisung soll sie nicht ungesehen vervielfältigen; eine einzelne Schicht lässt sich danach weiter mit Übersteuern anlegen. Gründe beim Überspringen: `past`, `no-contract`, `outside-store-hours`, `jarbschg`, `arbzg-daily-max`, `arbzg-rest-period`; die Vorschau und die Übernahme überspringen dieselben Zellen. Wiederherstellen prüft nur dort, wo Arbeitszeit zurückkommt (eine durch die Berufsschul-Bereinigung entfernte Schicht); das Entfernen einer Markierung ändert keine Zeit, keine Person und keinen Tag.

### Nur Verschlechterung

Wie bei JArbSchG (Issue #1057) wird nur abgelehnt oder gewarnt, was einen Verstoß **erzeugt oder vergrößert**: Die Tagessumme wächst oder die Ruhezeit zu diesem Nachbarn schrumpft. Eine reine Bezeichnungsänderung und das Verkürzen einer bereits unzulässigen Altschicht (Altbestand, Import, übersteuert) gehen durch; sonst bliebe der Dienstplan gesperrt und jede Änderung brächte einen neuen Übersteuern-Eintrag.

### Bekannte Grenzen

- **Wochenhöchstarbeitszeit (48 Stunden) und 24-Wochen-Schnitt** (§ 3 ArbZG) werden im Dienstplan nicht geprüft; die Erfassung meldet die 48 Stunden. Ob der Plan eine harte Wochengrenze bekommt, ist eine offene Owner-Entscheidung (das Gesetz kennt einen Durchschnitt).
- **Phorest-Import:** wird gemeldet, nicht abgelehnt (Issue #1074).
- **Hinweise-Seite:** Sie zeigt auch entfernte Schichten vergangener Tage; deren Wiederherstellung antwortet mit der Vergangenheitssperre.
- Alle Schreibwege samt Antwort und Übersteuerung sind in `apps/api/src/__tests__/shift-write-paths-1057.test.ts` erfasst; ein neuer Weg fällt dort auf.

---

## Tätigkeitsart am Zeiteintrag (Issue #81) — Auswertungsdimension

Ein Zeiteintrag trägt eine Tätigkeitsart (`nicht angegeben`, `Produktive Zeit am Kunden`, `Rüst-, Reinigungs- und Vorbereitungszeit`) und optional Minutenanteile je Art. Die Unterscheidung ist eine reine Auswertungsdimension, keine Bewertung.

### Arbeitszeit

- Rüst-, Umkleide- und Reinigungszeit ist **vergütungspflichtige Arbeitszeit**: BAG 19.09.2012 – 5 AZR 678/11, BAG 26.10.2016 – 5 AZR 168/16, BAG 10.11.2009 – 1 ABR 54/08. Dass sie für § 3 / § 4 / § 5 ArbZG voll zählt, folgt aus § 2 Abs. 1 ArbZG (Arbeitszeit = Zeit vom Beginn bis zum Ende der Arbeit ohne Ruhepausen).
- Saldo, Monatsabschluss, Berichte und die Prüfungen nach § 3 / § 4 / § 5 ArbZG lesen die Tätigkeitsart **nie**. Abgesichert durch einen Quelltext-Wächter (`activity-kind-saldo-isolation-81.test.ts`) und einen Vorher-Nachher-Vergleich aller Kennzahlen samt Monatsabschluss (`activity-kind-saldo-equality-81.test.ts`).
- Bestandsdaten bekommen den Vorgabewert „nicht angegeben“; kein Datensatz wird umgeschrieben, kein Saldo ändert sich.

### Mitbestimmung

- Minuten produktiver Zeit je Person sind **objektiv geeignet**, Leistung oder Verhalten zu überwachen; nach § 87 Abs. 1 Nr. 6 BetrVG kommt es auf diese Eignung an, nicht auf die Absicht (BAG 08.03.2022 – 1 ABR 20/21).
- Die Tätigkeitsart gehört nicht zur gesetzlichen Pflicht der Arbeitszeiterfassung (zu dieser Pflicht BAG 13.09.2022 – 1 ABR 22/21); sie ist eine freiwillige Erweiterung.
- Ein Mandant mit Betriebsrat beteiligt diesen, **bevor** Erfassung oder Auswertung der Tätigkeitsart genutzt wird.

### Datenschutz

- Rechtsgrundlage ist Art. 6 Abs. 1 lit. b bzw. f DSGVO unmittelbar; § 26 Abs. 1 S. 1 BDSG bleibt unangewendet (EuGH 30.03.2023 – C-34/21; BAG 08.05.2025 – 8 AZR 209/21).
- Die Beschäftigten sind nach **Art. 13 DSGVO** über Zweck und Umfang zu informieren (Zweck: Auswertungsdimension, keine Leistungsbewertung).
- Datenminimierung und datenschutzfreundliche Voreinstellungen (Art. 5 Abs. 1 lit. c, Art. 25 DSGVO): Vorgabe „nicht angegeben“; erfasst wird nur, was ein Client ausdrücklich sendet; die Auswertung liefert nur Minuten, keine Quoten, Beträge oder Ranglisten; es gelten dieselben Leserechte wie für die Zeiteinträge selbst.
- Ob eine Datenschutz-Folgenabschätzung (Art. 35 DSGVO) nötig ist, beurteilt der Mandant als Verantwortlicher. Personenbezogene Ranglisten, die jemand aus den Daten bildet, sind eine Verarbeitung des Mandanten.
- Kein Freitext — bei der Anonymisierung (Art. 17) ist nichts zu tun; die Anteile werden wie der Eintrag aufbewahrt.

### Mandantenschalter

Diese Version hat keine Oberfläche für die Tätigkeitsart. Erfassung und Auswertung in der Oberfläche kommen mit einem Schalter je Mandant, Vorgabe **aus**, samt Hinweis auf Betriebsrat und Art. 13 DSGVO: Issue #529. Die einzige Oberfläche in dieser Version ist die Erfassung einer Fahrzeit zwischen zwei Salons (nächster Abschnitt); sie ist vom Schalter ausgenommen.

---

## Fahrzeit zwischen Salons (Issue #92)

### Rechtsgrund

- Die Fahrt zwischen zwei Arbeitsstätten während des Arbeitstags, auf Weisung des Arbeitgebers, ist **Arbeitszeit** nach § 2 Abs. 1 ArbZG; sie zählt für die Tageshöchstgrenze (§ 3) und für die Pausenschwellen (§ 4). BAG 12.12.2012 – 5 AZR 355/12, Rn. 16: Wegezeiten für die Fahrt vom Betriebssitz zu einer auswärtigen Arbeitsstätte werden – anders als der Weg von der Wohnung zum Betrieb – arbeitszeitschutzrechtlich der Arbeitszeit zugerechnet. Eine Ruhepause ist die Fahrt nicht (BAG 25.02.2015 – 5 AZR 886/12).
- EuGH 09.10.2025 – C-110/24 bestätigt die Richtung (vom Arbeitgeber vorgegebene gemeinsame Fahrt zum Einsatzort ist Arbeitszeit, auch für Mitfahrer).
- EuGH 10.09.2015 – C-266/14 (Tyco) wertet für Beschäftigte **ohne festen oder gewöhnlichen Arbeitsort** auch die erste und die letzte Fahrt des Tages als Arbeitszeit. Das wird hier **nicht angewandt**, weil jede Person einen Stammsalon hat. Restrisiko: ein Mandant mit echten Springern ohne gewöhnlichen Arbeitsort muss die Wege von und zu Hause selbst bewerten; Clokr erfasst sie nicht.

### Regel

- Erfasst wird eine Fahrzeit **nur zwischen zwei Einträgen desselben Tages**: nach einem Eintrag im Abfahrtssalon und vor einem Eintrag im Zielsalon. Der Weg von zu Hause zum ersten Salon und vom letzten Salon nach Hause ist keine Arbeitszeit und lässt sich nicht erfassen (die Eingabe wird mit einer Fehlermeldung abgelehnt).
- Die Fahrzeit ist ein gewöhnlicher abgeschlossener Arbeitseintrag mit Abfahrts- und Zielsalon, ohne Pause. Saldo, Monatsabschluss, Berichte, DATEV sowie die Prüfungen nach § 3 / § 4 / § 5 ArbZG rechnen sie wie jeden Eintrag mit, ohne zweite Berechnung; ein Gleichheitstest belegt das (`travel-saldo-equality-92.test.ts`), ein Quelltext-Wächter hält die Fahrzeit-Felder aus Saldo und Kernen heraus (`travel-saldo-isolation-92.test.ts`).
- Revisionssicherheit, Monatssperre, Aufbewahrung und Anonymisierung gelten wie für jeden Zeiteintrag: Erfassen, Ändern und Löschen sind protokolliert; ein gesperrter Eintrag bleibt unveränderbar. Eine Fahrzeit lässt sich nicht als Zeitnachtrag beantragen (der Antrag würde einen gewöhnlichen Eintrag anlegen); außerhalb der Erfassungsfrist ist sie nur mit einer erteilten Freigabe der Führungskraft erfassbar.
- Wer den Eintrag vor oder nach der Fahrzeit löscht oder verschiebt, so dass die Fahrzeit nicht mehr zwischen zwei Salon-Einträgen liegt, wird mit 409 abgewiesen; erst die Fahrzeit löschen, dann den Eintrag.
- Erfassen, Ändern oder Löschen einer Fahrzeit ändert den Tagesstand der Pausenprüfung. Eine schon erteilte Quittung für diesen Tag wird dadurch veraltet und muss neu erteilt werden (bestehender Mechanismus der Quittung, keine neue Regel).

### Auswertung und Mitbestimmung

- Die Fahrzeit ist getrennt von produktiver Zeit und Rüstzeit auswertbar: `GET /time-entries/summary` liefert `activityMinutes.TRAVEL`, dem Abfahrtssalon zugerechnet; nur Minuten, keine Beträge, Quoten oder Ranglisten. Die Auswertung gehört zum Modul „Auswertungen“ (`ANALYTICS`); ohne gebuchtes Modul liefert sie `null`.
- **Hinweis Betriebsrat:** Minuten je Person und Art sind – wie die übrigen Werte der Tätigkeitsart (siehe Abschnitt oben) – objektiv geeignet, Verhalten zu überwachen (§ 87 Abs. 1 Nr. 6 BetrVG; BAG 08.03.2022 – 1 ABR 20/21). Ein Mandant mit Betriebsrat beteiligt diesen, **bevor** die Auswertung der Fahrzeit genutzt wird. Die **Erfassung** der Fahrzeit ist dagegen Teil der gesetzlichen Pflicht, die Arbeitszeit zu erfassen (BAG 13.09.2022 – 1 ABR 22/21); sie ist deshalb nicht vom Mandantenschalter aus Issue #529 abhängig und wird nie durch ein Modul gesperrt.
- Der Name des Zielsalons ist für jeden sichtbar, der die Zeile lesen darf (Stammdaten des Mandanten, keine personenbezogene Angabe).
- Berichte, PDFs und DATEV zeigen die Fahrzeit als gewöhnliche Arbeitszeitzeile; es gibt keine Kilometer-, Reisekosten- oder Spesenabrechnung und keine Standorterkennung.

### Oberfläche

Die Erfassung steht nur Mandanten mit Salonauswahl zur Verfügung (Zeiterfassung und Team-Zeiterfassung: „Weiteren Eintrag an diesem Tag“, Schalter „Fahrzeit zwischen Salons“, „Von Salon“ und „Nach Salon“). Mandanten mit einem Salon sehen keine Änderung.

---

## § 8 BUrlG — Urlaub & Zeiterfassung

Implementiert in [`apps/api/src/contexts/absence/api/leave.ts`](../apps/api/src/contexts/absence/api/leave.ts) und [`apps/api/src/contexts/absence/vacation-calc.ts`](../apps/api/src/contexts/absence/vacation-calc.ts).

### Antrag-Status-Lebenszyklus

```
SUBMITTED → APPROVED → CANCELLATION_REQUESTED → CANCELLED
                    ↘  (rejected)              ↘ APPROVED (zurück)
                       REJECTED
```

### Wechselwirkung mit Zeiterfassung

| Urlaubsstatus                       | TimeEntry erlaubt?         | Verhalten                                                                 |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `SUBMITTED` (pending)               | ja                         | normaler Eintrag möglich                                                  |
| `APPROVED`                          | **NEIN**                   | Hard-Block via 409; MA muss erst Stornierung beantragen                   |
| `CANCELLATION_REQUESTED`            | ja, aber `isInvalid: true` | Eintrag mit Hinweis „Urlaubsstornierung ausstehend"; zählt nicht im Saldo |
| `CANCELLED` (cancellation approved) | ja, Auto-Revalidierung     | invalide Einträge werden automatisch gültig                               |
| `REJECTED` (cancellation rejected)  | Einträge bleiben invalid   | Manager muss manuell handhaben                                            |

Stornierungen erfordern **Vier-Augen-Prinzip**: Approval durch einen anderen Manager (Self-Approval blockiert).

### § 7 Abs. 3 — Übertrag und Verfall

- Urlaub MUSS im Kalenderjahr genommen werden
- Übertrag ins Folgejahr **nur mit Grund** (Krankheit, betriebliche Notwendigkeit)
- Verfall am **31. März** des Folgejahres (konfigurierbar pro Tenant)
- **Langzeitkrankheit**: Übertrag bis 15 Monate (EuGH C-214/10 „KHS")

### Hinweispflicht (EuGH C-684/16)

Clokr versendet automatische Reminder:

- **Oktober:** Erinnerung an MA, wenn Verfall droht
- **November:** Eskalation an Manager
- **Dezember:** finale Warnung

Ohne dokumentierte Hinweise verfällt Urlaub gesetzlich **nicht** — das System protokolliert jeden Reminder.

### § 3 BUrlG — Gesetzlicher Mindesturlaub

| Wochenarbeitstage | Mindesturlaub/Jahr |
| ----------------- | ------------------ |
| 5 Tage            | 20 Tage            |
| 6 Tage            | 24 Tage            |
| 4 Tage            | 16 Tage            |

Berechnung: `Arbeitstage/Woche × 4`. Bei Teilzeit wird der Anspruch automatisch reduziert.

### Cross-Year Booking

Urlaub vom 30.12. – 5.1. wird automatisch gesplittet (2 Tage altes Jahr + 3 Tage neues Jahr). Beide Jahre werden separat geprüft. Stornierung dreht beide um.

### § 5 BUrlG — Austrittsjahr (Issue #447)

Das Austrittsjahr und das Eintrittsjahr sind **eine Zwölftelung über eine Beschäftigungsspanne**
(Eintritt–Austritt), nicht zwei getrennte Rechnungen — ein Eintritt und ein Austritt im selben
Jahr werden genau einmal zwölftel, nicht zweimal nacheinander.

- **Teilurlaub:** 1/12 je vollem Beschäftigungsmonat der Spanne Eintritt–Austritt. Ein voller
  Monat ist ein **Beschäftigungsmonat, kein Kalendermonat** (Issue #1011): Er wird nach
  §§ 187 Abs. 2, 188 Abs. 2/3 BGB ab dem Eintrittstag gezählt (Beginn am Eintrittstag, Ende am Tag
  vor dem entsprechenden Tag des Folgemonats, oder am letzten Tag eines kürzeren Monats). Ein
  angebrochener Monat zählt nicht (§ 5 Abs. 1 BUrlG: „für jeden vollen Monat des Bestehens des
  Arbeitsverhältnisses“). Beispiele: Eintritt 16.11. → 16.11.–15.12. ist ein voller Monat,
  16.12.–31.12. keiner → 1/12 (Anspruch 30 → 2,5 → 3 Tage, Mindesturlaub 20 → 1,67 → 2 Tage);
  Eintritt 15.07. → 15.07.–14.12. = 5/12 (13 Tage bei 30). Ein Eintritt am Monatsersten zählt
  diesen Monat voll. Bei einem Austritt im Jahr nach Beschäftigung seit Jahresbeginn beginnt die
  Zählung am 1. Januar (Kalendermonate); Eintritt und Austritt im selben Jahr werden ab dem
  Eintrittstag gezählt. Die Elternzeit-Kürzung (§ 17 Abs. 1 BEEG, „vollen Kalendermonat“) bleibt
  bei Kalendermonaten. Gespeicherte Ansprüche werden dadurch nicht verändert; sie ändern sich nur
  über die bestehenden, protokollierten Neuberechnungen. Die Abweichungen im Bestand listet
  `apps/api/scripts/audit-1011-hire-year-entitlements.ts` (nur lesend).
- **Austritt vor erfüllter Wartezeit (§ 4 BUrlG, 6 Monate):** immer anteilig — auch wenn der
  Austritt in der zweiten Jahreshälfte liegt.
- **Austritt nach erfüllter Wartezeit:** Austritt in der ersten Jahreshälfte (Januar–Juni) →
  anteilig; Austritt in der zweiten Jahreshälfte (Juli–Dezember) → voller Anspruch.
- **Gesetzlicher Mindesturlaub** (§ 3 BUrlG/§ 19 JArbSchG) folgt derselben Zwölftelung wie der
  reguläre Anspruch — kein eigener Rechenweg.
- **Rundung** nach § 5 Abs. 2 BUrlG: ein Bruchteil ab einem halben Tag wird auf einen vollen Tag
  aufgerundet; darunter bleibt der exakte Bruchteil (2 Nachkommastellen) erhalten.
- **Übertrag aus dem Vorjahr wird nie gekürzt** (§ 7 Abs. 3 BUrlG) — die Zwölftelung betrifft nur
  den im Austrittsjahr neu erworbenen Anspruch.
- **Kein Rückforderungstext:** wurde im Austrittsjahr mehr Urlaub genommen als zusteht, zeigt das
  System einen neutralen Hinweis nach § 5 Abs. 3 BUrlG — keine Rückforderungs-Formulierung.

Implementiert in der einen Funktion `employmentYearVacationDays()` (`vacation-calc.ts`), auf die
sowohl `computeRegularVacationDays()` als auch der Mindesturlaubs-Schwellenwert delegieren; die
Beschäftigungsmonate zählt `employmentMonthPeriodsInYear()` (mit `monthPeriodEndDate()`, derselben
Rechnung wie die Wartezeit `wartezeitEndDate()`).

---

## DSGVO — Datenschutz & Anonymisierung

### Art. 17 — „Recht auf Vergessenwerden"

Mitarbeiter werden **anonymisiert, nicht hard-gelöscht** (siehe `CLAUDE.md` „DSGVO Employee Deletion = Anonymization"):

| Feld                                                  | Anonymisierung                                           |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `Employee.firstName`                                  | „Gelöscht"                                               |
| `Employee.lastName`                                   | „GELÖSCHT-XXX"                                           |
| `Employee.employeeNumber`                             | bleibt erhalten und im Mandanten reserviert (Issue #614) |
| `Employee.exitDate`                                   | wird gesetzt, wenn leer (Issue #614)                     |
| `Employee.nfcCardId`, `wifiMacs`                      | `null` / `[]`                                            |
| `User.email`                                          | anonymisiert (`gelöscht-<hash>@anon.local`)              |
| `User.passwordHash`, `isActive`                       | `"ANONYMIZED"`, `false`                                  |
| `TimeEntry.note`, `LeaveRequest.note`, `Absence.note` | `null`                                                   |
| `Absence.documentPath`                                | `null` (Dateien im S3 gelöscht)                          |
| `Invitation`, `OtpCode`, `RefreshToken`               | hart gelöscht (nicht aufbewahrungspflichtig)             |
| `AuditLog.userId`                                     | `null` (anonymisiert, nicht gelöscht — Audit-Pflicht!)   |

**Erhalten bleiben** (gesetzliche Aufbewahrungspflicht):

- TimeEntries, LeaveRequests, Absences, Schedules, OvertimeAccount, SaldoSnapshots

**Die Anonymisierung beendet die Beschäftigung** (Issue #614): Ein leeres Austrittsdatum wird auf den Tag der Anonymisierung gesetzt; Urlaube und Berufsschultage nach dem Austritt werden storniert bzw. gekürzt, abgeschlossene Monate bleiben unverändert. Die Personalnummer bleibt erhalten (§ 41 EStG, § 147 AO), damit die Lohnabrechnung Korrekturen alter Monate zuordnen kann.

### Art. 6 Abs. 1 lit. a — Einwilligung (WiFi-Presence)

WiFi-basiertes Auto-Stempeln (v1.4, Phase 25):

- **Opt-In erforderlich** pro MA — Default `wifiPresenceEnabled = false`
- Einwilligungszeitpunkt in `Employee.wifiOptInAt` festgehalten (auch nach Widerruf erhalten als Beleg)
- MA kann jederzeit widerrufen via `/settings → Meine Geräte`
- Bei Admin-Zuweisung eines Geräts: Opt-In wird automatisch aktiviert (über Betriebsvereinbarung gedeckt) — Audit-Log `WIFI_OPT_IN_BY_ADMIN`
- Bei Aufheben der letzten Zuweisung: Opt-In automatisch deaktiviert — Audit-Log `WIFI_OPT_OUT_BY_ADMIN`

### Art. 5 Abs. 1 lit. e — Speicherbegrenzung

WiFi-Presence-Events ohne TimeEntry (Unknown MAC, Outside Window, No Shift, Opt-out) werden mit `AuditLog.purgeable = true` markiert und **nach 90 Tagen automatisch gelöscht** durch Daily-Cron (`runPurgeableAuditLogs`). Implementiert in `data-retention.ts`.

---

## Aufbewahrungsfristen (Deutschland)

| Grundlage                           | Frist                  | Norm                 |
| ----------------------------------- | ---------------------- | -------------------- |
| Arbeitszeitnachweis                 | 2 Jahre                | § 16 Abs. 2 ArbZG    |
| Lohnkonten                          | 6 Jahre                | § 41 EStG            |
| Buchungsbelege (lohnsteuerrelevant) | **10 Jahre**           | § 147 AO / § 257 HGB |
| Personalakten / Vertragsdaten       | bis Austritt + 3 Jahre | BGB                  |
| Krankmeldungen (eAU)                | Ende des Folgejahres   | § 24c SGB V          |

**Default in Clokr:** 10 Jahre (konfigurierbar pro Tenant via `TenantConfig`, Minimum 2 Jahre).

- Aufbewahrung startet **am Ende des Kalenderjahres** der Erstellung
- Löschung **NICHT rolling**, sondern jährlich zum Stichtag (z.B. 1.1. für Datensätze, deren Frist am 31.12. abgelaufen ist)
- Implementiert in `data-retention.ts:runRetention()` (jährlich am 2.1. um 03:00)

---

## Audit-Trail / Revisionssicherheit

Implementiert in [`apps/api/src/contexts/platform/plugins/audit.ts`](../apps/api/src/contexts/platform/plugins/audit.ts).

### Grundprinzipien

1. **Keine Hard-Deletes** auf TimeEntry, LeaveRequest, Absence, Employee → Soft-Delete via `deletedAt`
2. **Alle Mutationen** (CREATE/UPDATE/DELETE) erzeugen einen `AuditLog`-Eintrag mit:
   - `userId`, `tenantId`, `timestamp`, `ipAddress`, `userAgent`
   - `entity`, `entityId`, `action`
   - `oldValue` und `newValue` als JSONB
3. **Locked Months** (`TimeEntry.isLocked`; Monats-Snapshot via `SaldoSnapshot.closedAt`) sind nach Abschluss **immutable** — auch für Admins
4. **Korrekturen** an gesperrten Monaten erzeugen einen neuen Eintrag (`TimeEntry.source = CORRECTION`) mit Referenz auf das Original, nie Inplace-Update
5. **CASCADE = Restrict** für kritische Relationen (Employee → TimeEntry/LeaveRequest/Absence)

### AuditLog Actions (Auswahl)

| Action                                                                     | Entity                | Zweck                            |
| -------------------------------------------------------------------------- | --------------------- | -------------------------------- |
| `CREATE`, `UPDATE`, `DELETE`                                               | beliebig              | Standard-CRUD                    |
| `WIFI_CLOCK_IN`, `WIFI_CLOCK_OUT`                                          | TimeEntry             | Auto-Stempel via WiFi            |
| `WIFI_UNKNOWN_MAC`, `WIFI_OPT_OUT`, `WIFI_OUTSIDE_WINDOW`, `WIFI_NO_SHIFT` | PresenceEvent         | Nicht-Stempel-Events (purgeable) |
| `WIFI_OPT_IN_BY_ADMIN`, `WIFI_OPT_OUT_BY_ADMIN`                            | Employee              | Admin setzt/widerruft Opt-In     |
| `ASSIGN_DEVICE`, `UNASSIGN_DEVICE`                                         | PresenceDevice        | MAC↔MA-Mapping                   |
| `MANAGER_CREATED`                                                          | LeaveRequest, Absence | Manager-on-behalf-of (v1.4)      |
| `CREATE`, `UNLOCK`                                                         | SaldoSnapshot         | Monatsabschluss / Wiederöffnung  |

---

## Migrations- und Datenintegrität

- **Schema-Änderungen:** Versionierte Prisma-Migrationen (`prisma migrate diff` gegen eine Wegwerf-Shadow-DB → `migrate deploy`), **nicht** `db push` und **nicht** `prisma migrate dev` (setzt bei Drift die Zieldatenbank ohne Rückfrage zurück). Siehe `CLAUDE.md` und `docs/migrations.md`.
- **CASCADE-Verhalten:** Critical Relations (`Employee → TimeEntry`, `Employee → LeaveRequest`, `Employee → Absence`) verwenden `onDelete: Restrict` — verhindert versehentlichen Cascade-Delete
- **Soft-Delete-Queries:** ALLE Queries auf `TimeEntry`, `LeaveRequest`, `Absence` MÜSSEN `deletedAt: null` im `where` enthalten (Projektregel, enforced in Code-Reviews)

---

## Code-Referenzen

| Bereich                             | Datei                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ArbZG-Prüfungen                     | `apps/api/src/contexts/time-tracking/arbzg.ts`                                                                             |
| ArbZG-Tests (33 Cases)              | `apps/api/src/contexts/time-tracking/__tests__/arbzg.test.ts`                                                              |
| Urlaubsberechnung                   | `apps/api/src/contexts/absence/vacation-calc.ts`                                                                           |
| Audit-Plugin                        | `apps/api/src/contexts/platform/plugins/audit.ts`                                                                          |
| Data-Retention (jährlich + täglich) | `apps/api/src/composition/data-retention.ts`                                                                               |
| Auto-Break-Logik                    | `apps/api/src/contexts/time-tracking/api/time-entries.ts` (Suche `autoBreakMin`)                                           |
| WiFi-Presence (Opt-In, Webhook)     | `apps/api/src/contexts/time-tracking/api/presence.ts`, `apps/api/src/contexts/time-tracking/api/admin-presence-sources.ts` |
| Projektregeln                       | `CLAUDE.md` (Sektionen „Audit-Proof", „Data Retention", „ArbZG", „BUrlG")                                                  |

---

### Phorest-Schichtimport & §615 (v1.9)

Aus Phorest importierte Schichten können den Roster-Soll um eine Vor-/Nachbereitungszeit erweitern (`TenantConfig.phorestPrepMinutes`/`phorestWrapupMinutes`, pro Mitarbeiter via `phorestPrepMinutesOverride`/`phorestWrapupMinutesOverride` überschreibbar). Dieser gepaddete Roster fließt in den SHIFT_BASED-Saldo (§615 Annahmeverzug, `apps/api/src/contexts/working-time-account/shift-based-saldo.ts`) ein. Berufsschul-Abwesenheiten (`Absence.type = VOCATIONAL_SCHOOL`) haben Vorrang vor kollidierenden Phorest-Schichten (Schicht wird beim Import übersprungen). Der Import ist einseitig (Phorest führend); ein Rückschreiben nach Phorest findet nicht statt.

---

## Disclaimer

Diese Dokumentation beschreibt den **implementierten Stand** von Clokr v1.9. Sie ersetzt keine rechtliche Beratung. Tenants sind selbst verantwortlich für die korrekte Konfiguration (Aufbewahrungsfristen, Bundesland, Arbeitszeitmodelle, Betriebsvereinbarungen).

Bei rechtlichen Änderungen (z.B. Anpassungen am ArbZG, neuen EuGH-Urteilen zu BUrlG) ist eine Code-Anpassung erforderlich — die Test-Suite (`pnpm --filter @clokr/api test arbzg`) dient als Regression-Schutz.
