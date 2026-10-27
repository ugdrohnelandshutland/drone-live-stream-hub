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

  /** A live drone whose picture stopped (player-status.ts stalledView). */
  stall: {
    drone: {
      label: "Bild steht",
      title: "Drohne sendet gerade keine Bilder",
      detail: "Das letzte Bild bleibt stehen – es geht automatisch weiter.",
    },
    connection: {
      label: "Verzögert",
      title: "Schwache Verbindung",
      detail: "Dieses Gerät empfängt das Bild nicht schnell genug – die Drohne sendet normal.",
    },
  },

  paused: {
    label: "Angehalten",
    title: "Übertragung angehalten",
    banner: "Übertragung für dieses Gerät angehalten – das Bild kommt zurück, sobald sie freigegeben wird.",
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

  admin: {
    title: "Verwaltung",
    off: "Verwaltung nicht eingerichtet",
    offDetail:
      "Für die Verwaltung eine PIN als „adminPin“ in config/drones.json eintragen und den Dienst neu starten.",
    unreachable: "Server nicht erreichbar – neuer Versuch läuft …",
    loginTitle: "PIN eingeben",
    pin: "PIN",
    login: "Anmelden",
    logout: "Abmelden",
    wrongPin: "PIN falsch.",
    locked: (seconds: number) => `Zu viele Versuche – bitte in ${seconds} s erneut versuchen.`,
    loginFailed: "Anmeldung nicht möglich – Server nicht erreichbar.",
    diagnostics: "Diagnose",

    devicesTitle: "Geräte",
    noDevices: "Kein Gerät verbunden",
    noDevicesDetail: "Geräte erscheinen hier, sobald sie die Seite öffnen.",
    unknownDevice: "Unbekanntes Gerät",
    anonymous: "Ohne Kennung (Skript oder Simulator) – nicht steuerbar",
    online: "Verbunden",
    offline: "Getrennt",
    paused: "Angehalten",
    onlineSince: (since: string) => `verbunden ${since}`,
    lastSeen: (time: string) => `zuletzt ${time}`,
    noStreams: "kein Bild geöffnet",
    dataSaver: "Datensparen",
    pause: "Anhalten",
    resume: "Freigeben",
    reload: "Neu laden",
    rename: "Umbenennen",
    actionFailed: "Aktion nicht möglich – Gerät nicht mehr bekannt oder Server nicht erreichbar.",
    reloadUnavailable: "Neu laden geht nur, solange das Gerät verbunden ist.",
    renameTitle: "Gerät benennen",
    nameLabel: "Name",
    namePlaceholder: "z. B. ELW Großbildschirm",
    save: "Speichern",
    removeName: "Name entfernen",
    quality: "Verbindung (letzte 10 min)",
    qualityGood: "ohne Störungen",
    droppedFrames: (n: number) => `${n} Bilder ausgelassen`,
    slowClosures: (n: number) => `${n}× zu langsam`,
    aborts: (n: number) => (n === 1 ? "1 Abbruch" : `${n} Abbrüche`),

    loadTitle: "Auslastung",
    incoming: "Eingang",
    outgoing: "Ausgang an Geräte",
    viewers: "Zuschauer",
    devices: "Geräte verbunden",
    service: "Dienst",
    version: "Version",
    uptime: "Laufzeit",
    memory: "Arbeitsspeicher",
    cpu: "CPU",
    live: "live",
    droneOffline: "offline",

    eventsTitle: "Ereignisse",
    noEvents: "Noch keine Ereignisse seit dem Start des Dienstes.",

    capturesTitle: "Mitschnitte",
    capturesDetail: (seconds: number) =>
      `Speichert ${seconds} s des Streams einer Drohne unverändert als FLV-Datei – zur Analyse der echten Fernsteuerungs-Daten. Die letzten 20 Dateien bleiben erhalten.`,
    capturesOff: "Mitschnitte sind aus: Der Dienst läuft ohne Datenordner.",
    capture: (seconds: number) => `${seconds} s mitschneiden`,
    captureRunning: "Mitschnitt läuft …",
    captureOffline: "Die Drohne ist nicht live.",
    captureBusy: "Für diese Drohne läuft schon ein Mitschnitt.",
    captureFailed: "Mitschnitt nicht möglich – Server nicht erreichbar.",
    noCaptures: "Noch keine Mitschnitte.",
    download: "Herunterladen",
    captureCutShort: {
      offline: "abgebrochen: Drohne offline",
      size: "abgebrochen: Größenlimit",
      error: "abgebrochen: Schreibfehler",
      stopped: "abgebrochen: Dienst beendet",
    },
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
