# Milestone 3: n drones

Status: done (2026-10-09)

## What exists

- **Drone registry** (`src/server/registry/registry.ts`): the drones from the config, state
  `offline`/`live`, `since`, `sessionId`, `viewerCount`, video info (codec, RFC 6381 string,
  resolution from the SPS; for codecs we do not parse, the size from `onMetaData`).
  - First `publish` listener on the ingest adapter: unknown stream keys are rejected and
    logged (`streamKey`, `sessionId`, remote address).
  - A key that publishes while live replaces the old session; `since` keeps the time the
    drone first went live, the old session's late data and `unpublish` are ignored.
  - Emits `drone-updated` on every change (only on real changes, e.g. one event per new
    sequence header, not per tag).
- **API** (`src/server/delivery/api.ts`, types in `src/shared/api.ts`):
  - `GET /api/drones` → `{ drones: DroneStatus[] }` in config order.
  - `GET /api/events` (SSE): `snapshot` with all drones on every (re)connect, then
    `drone-updated` events. Updates for the same drone within 100 ms are merged (viewer
    bursts), heartbeat comment every 15 s, `retry: 2000`, slow SSE clients are dropped.
    `snapshot` is an addition to CLAUDE.md §4: without it, updates between `GET /api/drones`
    and opening the stream could be lost.
  - Unknown `/api/*` paths → 404 JSON.
- **Viewer counts** flow from each `LiveChannel` to the registry.
- **Web UI**
  - `/` overview: one tile per configured drone (config order) with name, Live/Offline chip,
    id, resolution, codec, viewers and "seit 14:03 Uhr"; muted live preview while live;
    "Kein Signal" while offline. Whole tile is the touch target and opens the single view.
    Live via SSE, no reload; banner while the server connection is lost.
    `?previews=0` disables previews on weak devices.
  - `/drone/<id>` single view: drone name from the registry, "‹ Übersicht" button,
    "Unbekannte Drohne" immediately for ids not in the config.
  - **Fixed assignment for the kiosk touchscreen:** `/drone/<id>?kiosk` — no way to navigate
    away, starts by itself when the drone comes (see ADR 0002).
- **Simulator**: `--drones n` (ids from the config, then `m30t-NN`), `--unknown-key` adds a
  drone `unknown-01`; the CLI warns about ids that are not in the config.

## Verified

- 94 tests (`npm test`), new: registry transitions, replacement, codec info, HEVC fallback,
  viewer counts; German formatting helpers; integration test with two simulated drones and
  one unknown key: SSE snapshot, `drone-updated` live with video info, `/api/drones`, unknown
  key never visible, viewer counts 2 → 1, drone stop → `offline` + viewer closed with `4000`.
- Real Chrome (headless, Windows host), service + simulated drones:
  - Overview with 2 live + 1 offline drone, previews playing.
  - Drones stop while the overview is open: "2 von 3 live" → "0 von 3 live" without reload.
  - Drones start while the overview is open: "0 von 3 live" → "3 von 3 live" without reload,
    all three previews play (1280×720).
  - Single view with name and back button, kiosk view without back button, unknown drone.

## Notes

- Overview previews are viewers too and count in `viewerCount`.
- Every preview decodes a full stream. With many 1080p drones a tablet may struggle;
  measure in milestone 5 and use `?previews=0` if needed (still-image previews would be a
  later option).
- Manual device checklist: `docs/manual-test.md`.
