/**
 * All German UI text in one place, so wording can be reviewed and changed without reading
 * components. Number and date formatting lives in lib/format.ts.
 */
export const t = {
  appTitle: "Drohnen-Livestream",
  /** The title as wordmark: the second part in the accent colour. Together = appTitle. */
  wordmark: ["Drohnen-", "Livestream"] as const,
  loading: "Lade Drohnen …",

  overview: {
    summary: (live: number, total: number) => `${live} von ${total} live`,
    noDrones: "Keine Drohnen eingerichtet",
    noDronesDetail: "Drohnen werden in config/drones.json eingetragen.",
    serverLost: "Keine Verbindung zum Server – verbinde neu …",
    previewsOff: "Live – zum Öffnen tippen",
    open: (name: string) => `${name} öffnen`,
    liveOnly: "Nur live",
    liveOnlyOn: "Nur Drohnen zeigen, die live sind",
    liveOnlyOff: "Alle Drohnen zeigen",
    dataSaver: "Datensparen",
    dataSaverOn: "Vorschau mit etwa 1 Bild pro Sekunde – spart Daten",
    dataSaverOff: "Vorschau flüssig – volle Datenmenge",
    hidden: (count: number) => `${count} ausgeblendet`,
    noneLive: "Keine Drohne live",
    noneLiveDetail: "Sobald eine Drohne sendet, erscheint sie hier.",
    showAll: "Alle anzeigen",
  },

  single: {
    back: "Übersicht",
    snapshot: "Standbild",
    snapshotSaved: "Standbild gespeichert",
    snapshotFailed: "Standbild nicht möglich – noch kein Bild",
    record: "Aufnahme",
    recordStop: "Aufnahme beenden",
    recordSaved: "Aufnahme gespeichert",
    recordPartSaved: (part: number) => `Teil ${part} gespeichert – Aufnahme läuft weiter`,
    recordUnsupported: "Aufnahme nicht möglich – nur H.264 wird unterstützt",
    recordWaiting: "REC – warte auf Bild",
    recordRunning: (time: string, size: string) => `REC ${time} · ${size}`,
    fullscreen: "Vollbild",
    fullscreenExit: "Vollbild beenden",
  },

  theme: {
    /** Accessible name of the switch; "an" = night. */
    label: "Nachtmodus",
    toDay: "Zu Tag wechseln",
    toNight: "Zu Nacht wechseln",
  },

  dialog: {
    close: "Schließen",
  },

  about: {
    openAbout: "Über diese Software",
    openChangelog: "Neuigkeiten anzeigen",
    version: (version: string) => `Version ${version}`,
    aboutTitle: "Über",
    changelogTitle: "Neuigkeiten",
    installed: "installiert",
    publisherTitle: "Herausgeber",
    /** Fixed for all installations; placeholder until the publisher is decided. */
    publisher: [
      "Lorem Ipsum GmbH",
      "Lorem ipsum dolor sit amet 1",
      "12345 Consetetur",
      "lorem@ipsum.example",
    ],
    licensesTitle: "Open-Source-Lizenzen",
    licensesIntro:
      "Diese Software verwendet die folgenden Open-Source-Pakete. Zum Lesen der Lizenz antippen.",
    licensesLoading: "Lade Lizenzen …",
    licensesFailed: "Lizenzliste nicht erreichbar.",
    licensesDev: "Die Lizenzliste entsteht beim Build (npm run build).",
    noLicenseText: "Kein Lizenztext im Paket enthalten.",
    licensesWindows:
      "Das Windows-Paket enthält zusätzlich Node.js und shawl; deren Lizenzen stehen in THIRD-PARTY-NOTICES.txt im Installationsordner.",
  },

  crash: {
    title: "Anzeige gestört",
    detail: "Die Seite wird in wenigen Sekunden neu geladen.",
    reload: "Jetzt neu laden",
  },

  diagnostics: {
    title: "Diagnose",
    pause: "Anhalten",
    resume: "Fortsetzen",
    copy: "JSON kopieren",
    save: "JSON speichern",
    unreachable: "Diagnose-Daten nicht erreichbar – neuer Versuch läuft …",
    rejectedTitle: "Abgewiesene Verbindungen",
    rejectedDetail:
      "Stream-Keys, die nicht in config/drones.json stehen – z. B. ein Tippfehler auf der Fernsteuerung.",
    noFindings: "Keine Auffälligkeiten gegenüber dem Simulator-Profil.",
  },
} as const;
