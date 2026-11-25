# Budget

Eine private Budget-App fürs iPhone und den PC. Sie läuft komplett im Browser.

**Deine Daten bleiben auf deinem Gerät.** Es gibt keinen Server, keine Datenbank im Internet und kein Konto. Diese Seite (GitHub Pages) liefert nur den Code der App aus. Zahlen, Buchungen und Belege landen nie hier.

## Was die App kann

- **Budgetmonat von Zahltag zu Zahltag** (Standard: 25. bis 24.). Der Lohn vom 25.12. ist das Geld für den Januar.
- **Plan** mit Einnahmen, Sparen & Investieren, Fixkosten, Alltag, Einmaligem und Schulden. Beträge können monatlich, alle 3 oder 6 Monate, jährlich oder einmalig sein.
- **Übertrag:** Was in einem Monat übrig bleibt, geht automatisch in den nächsten.
- **Kontoauszug-Import (LUKB, PDF):** Das PDF wird auf dem Gerät gelesen. Bekannte Läden (Migros, Coop, Denner, Lidl, Aldi …) werden erkannt, neue Läden lernt die App von dir. Doppelte Buchungen gibt es nicht, und eine Saldo-Prüfung kontrolliert jeden Betrag.
- **Abgleich:** Handeinträge (z.B. Kreditkarte) und offene Rechnungen werden mit dem Auszug abgeglichen.
- **Belege:** Foto oder PDF an jede Buchung und Rechnung. Fotos werden automatisch verkleinert.
- **Offene Rechnungen** mit Fälligkeit, Kalender-Erinnerung und automatischem Abhaken beim Import.
- **Lebensmittel-Auswertung:** Durchschnitt pro Monat, aufgeteilt nach Laden.
- **Backup:** Eine Datei mit allem, verschlüsselt mit deinem Passwort (AES-256).
- Funktioniert offline, mit Dunkelmodus.

## Installation (einmalig)

1. Auf GitHub im Repository: **Settings → Pages**.
2. Bei *Build and deployment*: **Source: Deploy from a branch**, **Branch: main**, Ordner **/ (root)**, dann **Save**.
3. Nach 1 bis 2 Minuten läuft die App unter `https://<benutzername>.github.io/budget/`.

### Aufs iPhone

1. Die Adresse in **Safari** öffnen.
2. **Teilen** → **Zum Home-Bildschirm**.
3. Die App **vom Homescreen** öffnen und dort die Startdatei oder ein Backup laden.

Die Homescreen-App hat ihren eigenen Speicher, getrennt von Safari. Nur dort löscht iOS die Daten nicht nach 7 Tagen.

## Monatsablauf

1. Ende Monat im LUKB E-Banking: **Vermögen → Kontoauszug → Filter** (25. bis 24.) → **Exportieren** (PDF).
2. In der App: **Buchungen → Auszug laden**.
3. Unbekannte Buchungen zuordnen (die App merkt sich die Läden).
4. **Mehr → Backup erstellen** und die Datei in iCloud Drive sichern oder per AirDrop an den PC schicken.

## Auf dem PC anschauen

Die gleiche Adresse in Chrome oder Firefox öffnen und unter **Mehr → Backup oder Startdatei laden** das Backup vom iPhone öffnen. Änderungen am PC gehen nicht automatisch zurück aufs iPhone.

## Technik

- Reines HTML, CSS und JavaScript (ES-Module), ohne Build-Schritt
- Daten: IndexedDB im Browser
- PDF lesen: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0, liegt in `vendor/pdfjs/`)
- Offline: Service Worker (`sw.js`). Bei einer neuen Version `VERSION` in `sw.js` erhöhen.

```
index.html            Einstieg
css/app.css           Aussehen
js/app.js             Oberfläche
js/model.js           Budgetmonate, Plan, Übertrag, Auswertungen
js/lukb.js            LUKB-Kontoauszug lesen
js/merchants.js       Ladenerkennung
js/matching.js        Duplikate, Abgleich, Kategorie-Vorschläge
js/backup.js          Verschlüsseltes Backup
js/db.js              IndexedDB
```
