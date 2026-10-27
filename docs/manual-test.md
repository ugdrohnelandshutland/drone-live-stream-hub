# Manual test checklist

Run on the dev PC: `npm run dev` and `npm run sim -- --drones 3`, then open the UI from the
devices in the same Wi-Fi: `http://<pc-ip>:5173/` (WSL2: forward port 5173 first, see
`docs/dev-setup.md`). Note device, OS/browser version and date for each run.

Devices: Chrome on Android tablet · Chrome on iPad (iPadOS ≥ 17.1) · Chrome on Windows ·
1080p kiosk touchscreen.

## Overview `/`

- [ ] All configured drones shown in config order, numbered 1…n, names correct
- [ ] All drones fit on one screen without scrolling (tablet landscape and portrait, kiosk);
      phones scroll one column
- [ ] Live drones show a moving preview; offline drones show a grey hatch with "Kein Signal"
      and "Offline" in the strip
- [ ] Stop a drone (Ctrl+C in the simulator): tile switches to Offline without reload
- [ ] Start it again: tile switches to Live and the preview starts by itself
- [ ] Stop the service: banner "Keine Verbindung zum Server" after ~2 s; restart:
      banner gone, tiles current again
- [ ] Tiles are easy to tap; layout works in portrait and landscape
- [ ] Tap a live tile with "Datensparen" off: the picture continues large without going black;
      "Übersicht" and the browser's back button return without a black tile for that drone
- [ ] "Datensparen" (on for a device that never chose): tiles update about every 1–2 s, sharp,
      without artefacts or "Bild hängt"; a tap opens the drone with a fluid picture after a short
      rebuild; the choice survives a reload; `?datensparen=0|1` fixes it without storing it.
      **iPad:** tiles really update (Managed Media Source with keyframes only, ADR 0009)
- [ ] "Nur live": offline tiles disappear and the live pictures grow; numbers stay; a drone
      that drops stays ~30 s with "Kein Signal" before it disappears, and returns at once when
      live; the choice survives a reload; `?nurlive` switches it on without storing it
- [ ] Tag/Nacht switch: both readable outdoors in sunlight (Tag) and in a dark vehicle
      (Nacht); the choice survives a reload; `?theme=tag|nacht` fixes it

## Single view `/drone/<id>`

- [ ] Picture appears within ~1 s; name and "Live" shown
- [ ] `?stats`: note latency (avg / p95): ______
- [ ] Drone stops → "Kein Signal" after ~1 s; drone back → picture returns by itself
- [ ] Drone pauses (`stall` in the ingest chaos proxy, < 10 s): the last picture stays with
      "Drohne sendet gerade keine Bilder" at the bottom edge and "Bild steht" in the strip; no
      "Kein Signal". Pause > 10 s: "Kein Signal" once the hub drops the publisher
- [ ] Camera switch (`--switch-every 8`): picture continues with the new resolution; strip
      stays "Live" (no flicker to "Kein Signal")
- [ ] Fullscreen button works; "Übersicht", the browser's back button and the back swipe in
      fullscreen end fullscreen and show the whole overview
- [ ] In fullscreen the strip is hidden and the picture fills the screen; a tap shows the strip,
      a second tap or 4 s without input hide it; with a mouse, only the top area shows it (not
      moves elsewhere). iPad: Safari's own close button does not cover a control of the strip
- [ ] Recording: "Aufnahme" → badge "REC – warte auf Bild", then "REC 00:05 · …";
      "Aufnahme beenden" downloads an MP4 that plays (Windows Films & TV / VLC, iPad Dateien
      app, Android gallery) with the picture of the recorded time
- [ ] Recording with camera switch (`--switch-every 8`): one file per camera ("…_teil2.mp4"),
      each plays with its own resolution; toast "Teil n gespeichert – Aufnahme läuft weiter"
- [ ] Recording, then lock the screen (or switch app/tab): the file is downloaded, the
      recording has ended after unlocking; "Übersicht" also ends and downloads it
- [ ] iPad: download of the MP4 (confirmation dialog, file in Dateien → Downloads)
- [ ] App/tab in background > 10 s, then back: picture is live again (no old frames)
- [ ] Wi-Fi off/on on the device: "Verbindung gestört", then recovers
- [ ] `/drone/xyz`: "Unbekannte Drohne"
- [ ] Kiosk `/drone/<id>?kiosk`: no back button, no still image, no recording, larger strip; survives
      drone off/on for 10 minutes; reloads by itself after a service update

## Unsupported browsers

- [ ] iPad with iPadOS < 17.1 (if available): clear German message instead of a black screen

## Scenarios (CLAUDE.md §10.2)

Run `npm run sim -- --scenario sim/scenarios/<name>.json` (service running) and watch the
overview and a single view in the browser:

- [ ] steady · staggered-start · camera-switch · publisher-drop · duplicate-key ·
      unknown-key · bad-wifi · field-day — each observed once in the browser

## Weak tablet connection

`npm run sim:proxy -- --listen 8090 --target 8080 --latency 40 --jitter 60` and open
`http://<pc-ip>:8090/drone/<id>?stats` on the tablet (forward port 8090 under WSL2).
Press `s` (3 s stall), `c` (cut) and `h` (heal) in the proxy terminal.

- [ ] Latency with jitter (note avg/p95): ______
- [ ] Stall: picture freezes with "Schwache Verbindung" at the bottom edge and "Verzögert" in
      the strip after ~3 s (no "Kein Signal"), continues by itself
- [ ] Cut: "Verbindung gestört", picture back after heal

## Admin page `/admin` (ADR 0012)

With `"adminPin": "4711"` in `config/drones.json`; a tablet and the kiosk watch the overview.

- [ ] Without `adminPin`: the page says how to switch it on
- [ ] Wrong PIN: "PIN falsch."; five wrong ones: locked for a minute; right PIN: devices shown
- [ ] Every watching device is listed once (not once per tile) with browser, IP and the drones
      it shows; "Datensparen" tiles are marked
- [ ] "Anhalten": the device shows "Übertragung angehalten" on every tile within a second, the
      banner explains it; reloading the page keeps it paused; other devices keep playing
- [ ] "Freigeben": the picture is back within about a second, without reloading
- [ ] "Neu laden": the device reloads (kiosk too)
- [ ] "Umbenennen": the name appears; it survives a service restart; the device keeps its name
      after a reload and after the Wi-Fi gave it a new IP
- [ ] Weak tablet connection (`npm run sim:proxy`): its card shows left-out frames or aborts
- [ ] Event log: drone live/offline, camera switch, devices connected/paused/released
- [ ] **iPad:** the device keeps its identity after closing Chrome and a day later (cookie)

## Windows field PC (package)

Once per release, on a Windows 10/11 PC, with the ZIP from `npm run package:windows`
(details: `docs/windows-install.md`):

- [ ] Unpack the ZIP, double-click `install.cmd`, confirm the admin prompt: the script ends
      with "is running" and prints the LAN addresses.
- [ ] `Get-Service DroneLiveStreamHub` → Running, start type Automatic; in `services.msc` the
      account is "Lokaler Dienst" / "Local Service".
- [ ] `wf.msc`: two inbound rules in group "Drone Live Stream Hub", profile Private.
- [ ] From another device in the Wi-Fi: the overview loads; simulated drones appear and play
      (on a dev PC: `npm run sim -- --host <field PC IP> --drones 3`).
- [ ] `logs\service_rCURRENT.log` contains "HTTP server listening"; `wrapper_rCURRENT.log`
      shows the start.
- [ ] Kill `node.exe` in Task Manager: the service is back within a few seconds (wrapper log
      shows the restart), viewers reconnect.
- [ ] `Restart-Service DroneLiveStreamHub`: stops within 10 s ("shutting down" in the log).
- [ ] Break `config\drones.json` (e.g. remove a quote), restart the service: it stops, the log
      ends with the config error, no restart loop. Fix the file, start again.
- [ ] Reboot the PC: the service runs without anyone logging in.
- [ ] Run `install.cmd` again (update): `drones.json`, `data\clients.json` and the logs are kept.
- [ ] With `adminPin` set: name a device on `/admin`, restart the service: the name is still there
      (the service account can write `data\`).
- [ ] `uninstall.cmd`: service and firewall rules are gone, config and logs are kept.

## First test with a real RC Plus (milestone 7)

Open `/diagnose` on a laptop while the RC streams, then:

- [ ] The drone appears live; no entry under "Abgewiesene Verbindungen" (else: stream key on the RC).
- [ ] Note codec, profile/level, resolution, fps, bitrate, keyframe spacing, B-frames, audio.
- [ ] Switch wide → zoom → thermal → wide on the RC: each switch appears under "Ereignisse";
      the single view resumes each time.
- [ ] "JSON speichern" after each camera mode and attach the files to the test notes; the
      simulator profile (`src/sim/profiles.ts`) is adjusted from them.
