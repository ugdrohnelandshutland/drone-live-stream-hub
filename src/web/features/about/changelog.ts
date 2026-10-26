/**
 * What changed per release, for the users (Einsatzleitung), in German. Newest first. Add an
 * entry with every `chore(release)` commit; test/web/changelog.test.ts checks that the newest
 * entry matches package.json. Developer details stay in the commits and ADRs.
 */
export interface Release {
  version: string;
  /** ISO date of the release, e.g. "2026-10-10". */
  date: string;
  changes: readonly string[];
}

export const changelog: readonly Release[] = [
  {
    version: "0.10.0-beta.1",
    date: "2026-10-26",
    changes: [
      "Testversion für den nächsten Feldtest.",
      "Diagnose: zählt Bilder mit fehlerhafter NAL-Struktur pro Drohne und warnt davor. Browser verwerfen den Rest solcher Bilder; strengere Empfänger brechen ab.",
      "Verwaltung: Mitschnitte – speichert 30 s des Streams einer Drohne unverändert als FLV-Datei zum Herunterladen, für die Analyse der echten Fernsteuerungs-Daten.",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-10-25",
    changes: [
      "Die PIN der Verwaltung kann auch über die Umgebungsvariable DLSH_ADMIN_PIN gesetzt werden – praktisch für Docker, ohne eigene drones.json.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-25",
    changes: [
      "Neue Verwaltungsseite unter /admin (mit PIN, „adminPin“ in drones.json): zeigt alle verbundenen Geräte mit den geöffneten Drohnen und der Verbindungsqualität.",
      "Einzelne Geräte lassen sich anhalten und wieder freigeben – die Drohne sendet weiter, alle anderen Geräte sehen das Bild wie bisher. Ein angehaltenes Gerät zeigt „Übertragung angehalten“, auch nach dem Neuladen.",
      "Geräte können benannt (z. B. „ELW Großbildschirm“) und aus der Ferne neu geladen werden. Dazu Auslastung des Dienstes und die letzten Ereignisse.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-18",
    changes: [
      "Videoaufnahme in der Einzelansicht: „Aufnahme“ starten, „Aufnahme beenden“ – die MP4-Datei wird sofort heruntergeladen. Gleiche Bildqualität wie das Livebild.",
      "Bei einem Kamerawechsel und nach 10 Minuten beginnt automatisch eine neue Datei („…_teil2.mp4“), damit jede Datei überall abspielbar bleibt.",
      "Wird der Bildschirm gesperrt, die App gewechselt oder zur Übersicht gewechselt, endet die Aufnahme und die Datei wird gespeichert.",
      "Standbilder sind deutlich kleiner (JPEG statt PNG).",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-12",
    changes: [
      "Neues Aussehen: dunkelblaue Flächen, türkise Schalter, abgerundete Kacheln. Tag- und Nachtmodus bleiben, ebenso die Statusfarben.",
      "Eigenes Symbol im Browser-Tab und auf dem Home-Bildschirm von iPad und iPhone: eine Drohne im Wappenschild.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-12",
    changes: [
      "Neuer Schalter „Datensparen“ in der Übersicht: Die Vorschaubilder zeigen nur noch alle 1–2 Sekunden ein neues Bild und brauchen dadurch nur noch einen Bruchteil der Daten – gut für schwaches WLAN und Tablets. Das Bild bleibt scharf.",
      "Datensparen ist auf jedem Gerät zunächst eingeschaltet; die Wahl wird pro Gerät gespeichert. Die geöffnete Drohne zeigt immer das flüssige Bild.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-11",
    changes: [
      "Vollbild zeigt nur noch das Bild: Die Leiste blendet sich aus. Antippen des Bildes oder die Maus am oberen Rand blendet sie wieder ein.",
      "Wichtig für die Installation: Auf dem Feld-PC muss vorher Node.js 24 LTS installiert sein (Windows-Installer von nodejs.org). Das Installationspaket ist dadurch viel kleiner (1,5 statt 34 MB).",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-11",
    changes: [
      "Schalter „Nur live“ in der Übersicht: zeigt nur Drohnen, die gerade senden – deren Bilder werden dadurch größer. Die Nummern der Drohnen bleiben gleich.",
      "Fällt eine Drohne aus, bleibt ihr Bild noch 30 Sekunden mit „Kein Signal“ stehen, damit sich die Anzeige bei kurzen Funklöchern nicht ständig umbaut.",
      "Unten auf der Seite: Antippen des Namens zeigt „Über“ mit Herausgeber und Open-Source-Lizenzen, Antippen der Version zeigt diese Neuigkeiten.",
      "Behoben: Im Windows-Paket fehlte ein Lizenzhinweis (React).",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-10",
    changes: [
      "Neue Oberfläche als Monitorwand: alle Drohnen nebeneinander, große Bedienflächen für Tablets und Touchscreen.",
      "Tag- und Nachtmodus: automatisch nach Geräteeinstellung oder per Schalter oben rechts.",
      "Wechsel zwischen Übersicht und Drohne ohne Unterbrechung – das Bild läuft einfach weiter.",
      "Schnellerer Bildstart: Das erste Bild erscheint sofort, danach springt die Anzeige auf live.",
      "Behoben: Beim Öffnen einer Drohne fehlte oft bis zu 2 Sekunden lang das Bild.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-10",
    changes: [
      "Version und Stand der Software unten auf der Seite; Geräte laden nach einem Update selbst neu.",
      "Feste Werkzeugleiste über dem Bild in der Einzelansicht.",
      "Standbild speichern – mit Drohnenname und Uhrzeit im Bild.",
      "Diagnose-Seite (/diagnose): zeigt, was jede Fernsteuerung tatsächlich sendet.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-10",
    changes: [
      "Erste Version: Livebild mehrerer Drohnen gleichzeitig im Browser.",
      "Übersicht aller Drohnen und Einzelansicht; feste Zuordnung per Adresse für den Kiosk-Bildschirm.",
      "„Kein Signal“ statt eines eingefrorenen Bildes, automatische Wiederverbindung.",
      "Kamerawechsel (Weitwinkel, Zoom, Wärmebild) ohne Abbruch.",
      "Windows-Paket: startet als Dienst mit dem PC, inklusive Firewall-Regeln und Protokolldateien.",
    ],
  },
];
