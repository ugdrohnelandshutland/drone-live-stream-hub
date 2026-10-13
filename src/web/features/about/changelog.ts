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
