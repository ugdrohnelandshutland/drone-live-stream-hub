# ADR 0012: Admin page — connected devices, pausing viewers

- Status: accepted
- Date: 2026-10-25
- Decided by: product owner (pause viewers, not drones; PIN; scope: device names, connection
  quality, total load, remote reload, event log)
- Amends: product decision "no login" (a PIN for `/admin` only; all other pages stay open)

## Context

The Einsatzleitung wants to see which devices watch which drone and to stop and restart the
picture for single devices. The drone keeps streaming; only the delivery to a device is
paused. Everyone in the field Wi-Fi can reach the service, so the controls need protection.

## Decision

- **Devices, not sockets.** A browser opens several WebSockets (one per overview tile) and
  every reconnect gets a new viewer id. The server therefore gives each browser a random
  client id in a cookie (`dlsh_client`, `HttpOnly`, 5 years) with its first page or
  `/api/events` response; the browser sends it with every later request, SSE connection and
  WebSocket. A server-set cookie needs no page code and is not capped at 7 days like
  script-set cookies in WebKit. `ClientRegistry` (`src/server/clients/`) groups all
  connections with one id into one device. WebSockets without the cookie (scripts, simulated
  viewers) are listed by IP as "Ohne Kennung" and cannot be paused or named.
- **Pausing.** The registry keeps the paused client ids in memory. Pausing closes all of the
  device's video sockets with a new close code `4003 paused` and sends `client-paused` over
  its SSE connection; new sockets of a paused device are accepted and closed with 4003 at
  once, and a new SSE connection gets `client-paused` right after the snapshot. The page
  stops its players and shows "Übertragung angehalten" (not "Kein Signal"). Releasing sends
  `client-resumed`, and the page starts its players again at once. If the SSE event is lost,
  the player tries again every 30 s on its own. A reload does not help: the cookie stays.
  Pauses are per device (all drones) and end with a service restart.
- **Limit.** Clearing site data or a private window gives a new client id. This protects
  against mistakes, not against someone deliberately getting around it.
- **Device names.** The admin names a device ("ELW Großbildschirm", at most 40 characters).
  Names are stored in `<data dir>/clients.json` (written asynchronously, batched, via a
  temporary file and rename; a broken file means no names, never a failed start) and survive
  restarts and changing IPs. Data dir: `--data-dir`, `DLSH_DATA_DIR`, else `data` next to the
  config folder. The service account could write only `logs\`; the install script now also
  creates `data\` with write access for `LocalService`.
- **Connection quality per device.** Bandwidth over the last 5 s; over the last 10 minutes:
  frames left out because the device was congested, closures for being too slow (4008), and
  aborts (no answer to the ping, or the connection broke without a close).
- **Online/offline.** A device without any connection counts as gone after 5 s, so a reload
  or switching pages creates no event. Offline devices stay listed for 10 minutes, paused
  ones until they are released.
- **Total load.** Incoming bitrate per drone (from the diagnostics), outgoing total bandwidth,
  viewers, devices online, CPU, memory, uptime and version of the service.
- **Remote reload.** "Neu laden" sends `client-reload` to one device, which runs
  `location.reload()`. For a stuck kiosk screen nobody can reach. Only while the device has
  an SSE connection.
- **Event log.** The last 500 events in memory, with time: drone live/offline, stream reset
  (camera switch or new RC session), rejected stream keys, device online/offline/paused/
  released/reloaded/renamed. Not written to disk (the service log has everything). The
  server stores structured events; the page writes the German text.
- **PIN.** Optional `adminPin` in `drones.json` (4–12 digits, as a string), or the
  environment variable `DLSH_ADMIN_PIN`, which wins over the file (Docker: the PIN stays out
  of the image and needs no mounted config). The log and `--check-config` say where the PIN
  came from, never the PIN. Without one,
  `/api/admin/*` answers 404 and the page explains how to switch it on.
  `POST /api/admin/login` with the right PIN sets an `HttpOnly`, `SameSite=Strict` session
  cookie (random token, in memory, valid until the service restarts). Five wrong PINs in a row
  from one address lock that address out for one minute. POSTs must be
  `application/json`, so a plain cross-site form cannot trigger an action. Plain HTTP in an
  offline LAN: the PIN protects against mistakes and curious users, not against someone
  sniffing the Wi-Fi.
- **API.** `GET /api/admin/state?eventsAfter=<n>&epoch=<id>` (devices, load, new events),
  `POST /api/admin/login`, `/logout`, `/clients/<id>/pause` · `resume` · `reload` · `name`.
  All but the login need the session cookie. Event numbers start again after a restart; the
  `epoch` tells the page to drop its old list.
- **UI.** Route `/admin` (not linked from the live pages), feature folder
  `src/web/features/admin/`: PIN form, then one card per device (name, browser, IP, drones
  being watched, since, connection quality, state) with large buttons "Anhalten" /
  "Freigeben", "Neu laden", "Umbenennen", the load, the event log, and a link to the
  diagnostics page. **Polled every second** instead of a second SSE stream: one admin page
  and a handful of devices, and polling needs no extra connection handling.
- **Not built:** forcing "Datensparen" on a device (the switch stays on the device),
  restarting the service from the page (one wrong tap ends every stream), and repeating the
  diagnostics data (the page links to `/diagnose`).

## Consequences

- New close code 4003 in `src/shared/close-codes.ts`; `LivePlayer` reports status `paused`.
  Pages from before this release do not know 4003 and retry with backoff, getting 4003 each
  time, until they reload (they do so by themselves after the update, `useServiceInfo`).
- `LiveChannel` reports dropped frames to the connection (`noteDropped`) and stream resets to
  the hub (`onStreamReset`), for the quality figures and the event log.
- `install-windows.ps1` creates `data\` and passes `--data-dir`; `uninstall-windows.ps1`
  keeps it unless `-Purge`. The Docker image has a writable `/app/data`.
- Tests: `test/unit/client-registry.test.ts` (grouping, pause/release, anonymous devices,
  names, offline grace, quality), `test/unit/admin.test.ts` (PIN and lock-out, event log,
  names file), `test/integration/admin.test.ts` (real service: cookie, login, pause → 4003,
  refused reconnect, release, reload, names on disk, 404 without PIN),
  `test/web/admin-page.test.tsx`, `test/web/admin-format.test.ts`, paused views in
  `test/web/views.test.tsx`. Browser checks in `docs/manual-test.md`.
