# Drone Live Stream Hub

Selbst gehosteter Dienst, der RTMP-Livevideo von DJI-Matrice-30T-Drohnen (über DJI RC Plus /
Pilot 2) empfängt und im Browser per FLV über WebSocket abspielt – offline, im lokalen
Einsatz-WLAN.

Ziele, Architektur und Meilensteine stehen in `CLAUDE.md`, Notizen zu den Meilensteinen in
`docs/`, Architekturentscheidungen in `docs/decisions/` (Englisch).

## Entwicklung

Voraussetzungen: Node.js 24 LTS und ffmpeg ≥ 6 im PATH (nur für Entwicklung und Tests). Siehe
`docs/dev-setup.md`.

```sh
npm install
cp config/drones.example.json config/drones.json
npm run dev                   # Dienst (Watch-Modus) + Web-UI-Dev-Server auf :5173
npm run sim -- --drones 3     # drei simulierte Drohnen senden RTMP an den Dienst
# Übersicht:     http://localhost:5173/
# Diagnose:      http://localhost:5173/diagnose  (was jede RC sendet; für Hardwaretests)
# Verwaltung:    http://localhost:5173/admin     (Geräte anhalten/freigeben; "adminPin" in drones.json)
# Einzelansicht: http://localhost:5173/drone/m30t-01   (?stats Latenzwerte, ?kiosk für den Touchscreen)
npm run measure:latency       # Glass-to-Glass-Latenz in echtem Chrome, Bericht in sim/reports/
npm test                      # Unit- und Integrationstests (ffmpeg-Tests werden ohne ffmpeg übersprungen)
npm run test:scenarios        # Kurzfassungen aller Robustheitsszenarien (~5 min, braucht ffmpeg)
npm run sim -- --scenario sim/scenarios/camera-switch.json --report   # Szenario mit Bericht
npm run sim:proxy -- --listen 8090 --latency 40 --jitter 60           # schwaches Tablet-WLAN vor :8080
npm run lint
npm run build && npm start
```

## Windows-Paket (Einsatz-PC)

```sh
npm run package:windows       # → release/drone-live-stream-hub-<version>-win-x64.zip
```

Das ZIP enthält den gebündelten Dienst, den Service-Wrapper und `install.cmd`; auf dem
Einsatz-PC muss Node.js 24 LTS installiert sein. Installation und Betrieb:
`docs/windows-install.md`; Entwurf: ADR 0004 und 0008.

## Releases

Oben in `src/web/features/about/changelog.ts` einen Eintrag für die neue Version ergänzen
(Deutsch, für die Nutzer geschrieben; erscheint unter „Neuigkeiten“, wenn man auf die Version in
der Fußzeile tippt). `npm test` schlägt fehl, bis er zur Version in `package.json` passt.

```sh
npm version minor --no-git-tag-version      # oder patch; aktualisiert package.json und Lockfile
git commit -am "chore(release): 0.8.0"
git tag -a v0.8.0 -m v0.8.0
git push --follow-tags
```

`scripts/release-notes.ts` erzeugt Release Notes aus den Conventional-Commit-Betreffs seit dem
vorherigen Tag.

## Docker (Demo mit simulierten Drohnen)

`docker compose up -d --build` → Dienst + drei simulierte Drohnen auf `http://<host>:18080/`.
Details, Einstellungen und Nginx Proxy Manager: `docs/docker.md`.

## Entstehung

Dieses Projekt wurde mit Unterstützung von Claude (Anthropic) über Claude Code entwickelt. Die
Projektvorgaben dafür stehen in `CLAUDE.md`.

## Lizenz

MIT, siehe `LICENSE`. Die verwendeten Bibliotheken stehen unter MIT, ISC, BSD-3-Clause und
Apache-2.0.
