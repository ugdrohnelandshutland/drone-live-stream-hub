# Drone Live Stream Hub – Installation unter Windows

Diese Anleitung ist für den Einsatz-PC. Sie liegt dem Release-ZIP auch als `README.md` bei.

## Voraussetzungen

- Windows 10 oder 11 (64 Bit).
- **Node.js 24 LTS**, installiert mit dem offiziellen Windows-Installer (`node-v24.x.x-x64.msi`
  von https://nodejs.org/, Standardoptionen). Node.js ist nicht im Paket enthalten. Für einen
  PC ohne Internet die `.msi` zusammen mit dem ZIP mitnehmen. Für alle Benutzer in den
  Standardordner `C:\Program Files\nodejs` installieren; ein Node.js im Benutzerprofil (z. B.
  nvm-windows) kann der Dienst nicht verwenden. Bei 24.x bleiben: Updates innerhalb von 24.x
  sind in Ordnung, eine andere Hauptversion (z. B. 26) nur zusammen mit einem Release, das sie
  unterstützt. Der Service-Wrapper ist im Paket enthalten.
- Administratorrechte für die Installation (nicht für den Betrieb).
- Das Einsatz-WLAN muss in Windows ein **privates** Netzwerk sein (siehe unten).

## Installieren oder aktualisieren

1. `drone-live-stream-hub-<version>-win-x64.zip` entpacken, z. B. auf den Desktop.
2. Im entpackten Ordner **`install.cmd`** doppelklicken und die Admin-Abfrage bestätigen.
   Alternativ in einer Administrator-PowerShell:
   `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1`
3. Am Ende zeigt das Skript die Adressen an, zum Beispiel:
   ```
   Web UI in the LAN:  http://192.168.1.20:8080/
   RC Plus RTMP URL:   rtmp://192.168.1.20:1935/live/<drone id>
   ```

Das Skript

- prüft, ob Node.js 24 installiert ist (sonst bricht es ab und sagt, was zu installieren ist;
  `-NodePath <Pfad zu node.exe>` wählt eine andere Installation),
- kopiert alles nach `C:\Program Files\DroneLiveStreamHub` (Option `-InstallDir`),
- legt `config\drones.json` aus dem Beispiel an, falls sie fehlt, und prüft sie,
- registriert den Windows-Dienst **DroneLiveStreamHub** (startet automatisch beim Hochfahren,
  läuft unter dem eingeschränkten Konto `LocalService`),
- legt eingehende Firewall-Regeln für TCP 1935 (RTMP) und 8080 (Web) an, **nur für private
  Netzwerke**,
- startet den Dienst und prüft, ob er antwortet.

Ein erneuter Aufruf mit einem neueren Paket aktualisiert das Programm. `config\drones.json`
und die Logs bleiben erhalten.

## Drohnen konfigurieren

`C:\Program Files\DroneLiveStreamHub\config\drones.json` bearbeiten (als Administrator, z. B.
Editor über „Als Administrator ausführen“ öffnen):

```json
{
  "rtmpPort": 1935,
  "httpPort": 8080,
  "drones": [
    { "id": "m30t-01", "name": "Drohne 1" },
    { "id": "m30t-02", "name": "Drohne 2" }
  ]
}
```

- `id`: Kleinbuchstaben, Ziffern und `-` (max. 32 Zeichen). Sie ist der Stream-Key auf der
  RC Plus und Teil der Kiosk-URL `/drone/<id>`.
- `name`: wird in der Weboberfläche angezeigt.

Danach den Dienst neu starten (Administrator-PowerShell): `Restart-Service DroneLiveStreamHub`.
Wurde ein **Port** geändert, `install.cmd` erneut ausführen, damit die Firewall-Regeln passen.

Eine Konfigurationsdatei ohne Neustart prüfen:
`& "C:\Program Files\nodejs\node.exe" "C:\Program Files\DroneLiveStreamHub\app\server.mjs" --check-config --config "C:\Program Files\DroneLiveStreamHub\config\drones.json"`

## RC Plus (DJI Pilot 2)

Livestream → RTMP → `rtmp://<IP des Einsatz-PCs>:1935/live/<Drohnen-ID>`, z. B.
`rtmp://192.168.1.20:1935/live/m30t-01`. Unbekannte IDs werden abgewiesen.

## Anzeigen

- Übersicht: `http://<IP des Einsatz-PCs>:8080/`
- Eine Drohne, z. B. für den Kiosk-Touchscreen:
  `http://<IP des Einsatz-PCs>:8080/drone/m30t-01?kiosk`

## Privates Netzwerk

Windows blockiert den Dienst in Netzwerken, die als **Öffentlich** eingestuft sind. Das
Installationsskript warnt davor. So wird das Einsatz-WLAN umgestellt (Administrator-PowerShell):

```powershell
Get-NetConnectionProfile                       # zeigt InterfaceAlias und NetworkCategory
Set-NetConnectionProfile -InterfaceAlias "WLAN" -NetworkCategory Private
```

## Logs und Status

- Logs: `C:\Program Files\DroneLiveStreamHub\logs\`
  - `service_rCURRENT.log`: der Dienst (JSON-Zeilen); Rotation bei 10 MB, 9 alte Dateien
    bleiben erhalten.
  - `wrapper_rCURRENT.log`: Start, Stopp und Neustarts des Dienstprozesses.
- Status: `Get-Service DroneLiveStreamHub` oder `http://localhost:8080/healthz` im Browser.
- Installierte Version: Fußzeile der Übersicht, `http://localhost:8080/api/info` oder
  `build-info.json` im Installationsordner.
- Nach einem Absturz startet sich der Dienst selbst neu. Nach einem **Konfigurationsfehler**
  hält er stattdessen an; der Grund steht am Ende von `service_rCURRENT.log`.

## Diagnose (Tests mit einer echten RC)

`http://<IP des Einsatz-PCs>:8080/diagnose` (in der Oberfläche nicht verlinkt) zeigt je Drohne,
was die RC tatsächlich sendet: Verbindung und Encoder, `onMetaData`,
Codec/Profil/Level/Auflösung, Bildrate, Bitrate, Keyframe-Abstand, B-Frames, Empfangslücken,
Zeitstempelsprünge, Kamerawechsel und Audio – neben den Werten des Simulators, Abweichungen
hervorgehoben. Außerdem listet sie Verbindungsversuche mit **unbekannten Stream-Keys** (z. B.
ein Tippfehler auf der RC). „JSON speichern“ sichert alles für die spätere Auswertung. Dieselben
Daten: `GET /api/diagnostics`.

## Deinstallieren

Im Installationsordner **`uninstall.cmd`** doppelklicken. Konfiguration und Logs bleiben
erhalten; `uninstall-windows.ps1 -Purge` löscht auch diese.
