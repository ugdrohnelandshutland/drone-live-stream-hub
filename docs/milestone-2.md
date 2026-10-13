# Milestone 2: single-drone playback

Status: done (2026-10-09)

## What exists

- **GOP cache** (`src/server/gop-cache/`): `onMetaData`, latest sequence header and all video tags
  since the last keyframe; GOP dropped above 16 MB until the next keyframe; reports a changed
  sequence header.
- **Delivery** (`src/server/delivery/`):
  - `LiveChannel` per drone: fan-out, viewer states (`waiting` / `streaming`), close codes,
    backpressure (above 1 MB queued: drop frames until the next keyframe; above 8 MB or 10 s
    congested: close with `4008`).
  - `LiveHub`: routes ingest sessions to channels and rejects unknown stream keys.
  - `DeliveryServer`: HTTP on port 8080 — `/healthz`, `/ws/live/<droneId>`, built web UI with
    SPA fallback (`dist/web`). Ping every 15 s drops dead viewers.
  - `src/server/app.ts`: composition root as `createService()`, used by `index.ts` and tests.
- **Close codes** shared by server and client: `src/shared/close-codes.ts`.
- **Web UI** (`src/web/`, Vite, no framework): `/drone/<droneId>` single view with fullscreen
  player, status chip, "Kein Signal" overlay (shown after 1 s, so camera switches do not
  flash it), fullscreen button. `/` is a placeholder until the overview (milestone 3).
- **Player** (`src/web/player.ts`): mpegts.js 1.8.2 (bundled, no CDN) with its own WebSocket
  loader, because the built-in loader hides the close code. Reaction per close code:
  `4000` → reconnect after 250 ms, `4001` → recreate at once, `4004` → retry after 30 s,
  `4008` → after 1 s, anything else → backoff 0.5 → 10 s. Stall watchdog (no frame for 2 s →
  "Kein Signal", 8 s → recreate). After > 3 s in a background tab: recreate (live edge).
  Unsupported browsers (no MSE/MMS) get a German message.
- **Latency measurement without OCR**: the simulator burns a 24-bit binary timecode of the
  wall clock (ms) into every frame (`src/shared/timecode.ts`, strip at the bottom left).
  `/drone/<id>?stats` decodes it per presented frame (`requestVideoFrameCallback`) and shows
  current/average/p95 latency, buffer, playback rate and dropped frames. The page syncs its
  clock with the service via `/healthz`, so this also works on tablets.
- `npm run measure:latency` drives a real Chrome through the DevTools protocol and writes a
  JSON report (+ screenshot) with `--out sim/reports/<name>.json`. Options: `--drone`,
  `--duration`, `--params "syncTarget=0.1&…"`, `--headful`. Under WSL the Windows Chrome's
  debugging port is not reachable from Linux; run the script with Windows Node instead:
  `node.exe --experimental-strip-types \wsl.localhost\<distro>\<repo>\scripts\measure-latency.ts`.
- `npm run dev` runs the service (watch) and the Vite dev server (`:5173`, reachable from
  tablets in the same Wi-Fi) with proxies for `/api`, `/healthz` and `/ws`.
- Decision record: `docs/decisions/0002-viewer-lifecycle-and-latency.md`.

## Latency measurements

Setup: dev PC (WSL2), service + 1 simulated drone (1080p30, H.264 High, 6 Mbit/s, GOP 2 s,
x264 `veryfast`/`zerolatency`), headless Chrome on the Windows host, via localhost.
Glass-to-glass = presentation time of a frame in Chrome minus the wall-clock time when the
simulator generated it (before encoding). 0 unreadable timecodes in all runs.

| Player tuning (syncTarget / syncMax / chaseMax / minRemain, s) | avg        | p50        | p95        | max        | buffer p50 | dropped frames |
| -------------------------------------------------------------- | ---------- | ---------- | ---------- | ---------- | ---------- | -------------- |
| mpegts.js-ish defaults (0.25 / 0.5 / 1.0 / 0.2), 25 s          | 370 ms     | 371 ms     | 375 ms     | 375 ms     | 330 ms     | 6              |
| 0.15 / 0.3 / 0.6 / 0.1, 25 s                                   | 231 ms     | 221 ms     | 352 ms     | 419 ms     | 177 ms     | 23             |
| **0.08 / 0.15 / 0.4 / 0.05 (chosen), 60 s**                    | **170 ms** | **177 ms** | **210 ms** | **243 ms** | 92 ms      | 37             |
| 0.04 / 0.08 / 0.3 / 0.02, 25 s                                 | 169 ms     | 165 ms     | 300 ms     | 316 ms     | 92 ms      | 127            |

- The floor is ~90–100 ms (encode, transfer, decode, display); the rest is player buffer.
- Going below the chosen values gives no gain, only more dropped frames.
- These values come from loopback without Wi-Fi jitter. Real Wi-Fi and tablets will add
  latency; re-measure on the devices (`?stats`) and with the chaos proxy (milestone 4).

## Recovery checks (real Chrome)

- Drone stops (graceful) and returns 10 s later: page goes `playing → waiting → playing`;
  the picture is back ~0.8 s after the drone restarts (ffmpeg start + first keyframe).
- Camera switches every 8 s (restart approach): playback continues with the new resolution;
  the gap is below the 1 s overlay delay, so no "Kein Signal" flash. Latency during the run:
  avg 153 ms, p95 232 ms.
- A viewer of an unknown drone gets `4004` (also through the Vite proxy).

## Tests

79 tests (`npm test`): GOP cache, LiveChannel (waiting viewers, 4000/4001/4008,
backpressure isolation), timecode, static files (SPA fallback, path traversal), and an
end-to-end test: service + simulated drone + headless viewers — the stream starts with FLV
header, `onMetaData`, sequence header and a keyframe; a late viewer gets the cached GOP;
both are closed with `4000` when the drone leaves; an offline drone's viewer stays connected.

## Notes and open points

- Publisher replacement (duplicate key) closes viewers with `4001` and ignores the old
  session, but the old RTMP connection is not actively closed yet → milestone 4
  (`duplicate-key` scenario) via an `IngestAdapter.disconnect()`.
- Drone name in the single view comes with `/api/drones` (milestone 3); the id is shown now.
- Not verified yet on real Android/iPad devices; checklist in milestone 3/4 (`docs/manual-test.md`).
