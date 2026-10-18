# CLAUDE.md — Drone Live Stream Hub

This file guides Claude Code when working in this repository. Read it fully before making changes.

## 1. What we are building

A self-hosted streaming service that receives live video from **n DJI Matrice 30T drones** and shows it in the **browser** on tablets, a touchscreen and laptops — all inside a local, offline field Wi-Fi.

```
DJI M30T ──(O3 radio)──> DJI RC Plus (Pilot 2) ──(RTMP over Wi-Fi)──> Field PC (Windows)
                                                                         │
                                                       Drone Live Stream Hub (this repo)
                                                                         │
                                         FLV over WebSocket + HTTP (Web UI, drone list)
                                                                         │
                                  Chrome on Android tablets, iPads (iPadOS ≥ 17.1), laptops
```

- Each RC Plus pushes RTMP to `rtmp://<field-pc-ip>:1935/live/<droneId>`, e.g. `m30t-01`.
- The service **forwards video unchanged** (no transcoding, no server-side remux). The browser plays the FLV stream with **mpegts.js** via Media Source Extensions.
- Works fully **offline**. No external server software (no MediaMTX, no OBS, no nginx). **Open-source libraries are allowed.**

### Goals of the first release

1. Receive RTMP streams from **n drones in parallel**.
2. Map each stream unambiguously to a drone via its stream key; reject unknown keys.
3. Web UI: **overview** of all active drones, **single view** (fullscreen), and **fixed assignment** via URL (`/drone/<droneId>`) for the kiosk touchscreen.
4. Multiple viewers per drone.
5. "No signal" state instead of a frozen frame; automatic reconnect on both sides (publisher and browser).
6. Survive camera switches in Pilot 2 (wide / zoom / thermal), which may change resolution and codec parameters mid-stream.

7. A **drone simulator** that replaces real hardware: n simulated drones, camera switches, disconnects and bad Wi-Fi, plus simulated viewers for load tests. **The team has no RC Plus available. Every feature must be developed and verified against the simulator** (see §10).

### Explicit non-goals (later extensions — do not build now)

Virtual camera, Microsoft Teams (RTMP-In), HDMI capture, server-side recording, image analysis, transcoding, WebRTC, HLS. (Recording in the browser, start/stop with MP4 download, exists since ADR 0011.) Keep the architecture open for them (the service is the single distribution point), but write no code for them.

## 2. Hard constraints

| Topic | Rule |
| --- | --- |
| Target OS | **Windows** (field PC). Must also run on Linux/macOS for development. Use `node:path`, never hard-coded separators. |
| Runtime | Node.js **LTS**, TypeScript **strict**, ES modules. |
| Language | **English** for all code, identifiers, comments, commit messages, log messages, docs in the repo. Exceptions in **German**: the web UI text, `README.md` and `docs/windows-install.md`. |
| Browsers | Chrome on Android, Chrome on iPadOS ≥ 17.1 (WebKit engine → Managed Media Source), Chrome on Windows. |
| Codec | Expect H.264 from Pilot 2. Do not transcode. Pass H.265 through unchanged; playback depends on the device. |
| Audio | Drop audio tags. Video only. |
| Network | Offline LAN. No CDN at runtime: bundle all frontend assets, including mpegts.js. |
| Dependencies | Open source only, permissive licenses (MIT, Apache-2.0, BSD, ISC, Boost). Check maintenance status before adding. Keep the dependency count small. |

## 3. Architecture

One Node.js process with four modules. The RTMP library is used **only for ingest**; everything else is our own code.

1. **Ingest** (`src/server/ingest/`)
   - Wraps the chosen RTMP library behind an interface so it can be swapped:
     ```ts
     interface IngestAdapter {
       start(): Promise<void>;
       stop(): Promise<void>;
       on(event: "publish", cb: (s: { streamKey: string; sessionId: string }) => boolean): void; // return false = reject
       on(event: "videoTag", cb: (sessionId: string, tag: FlvTag) => void): void;
       on(event: "metadata", cb: (sessionId: string, tag: FlvTag) => void): void;
       on(event: "unpublish", cb: (sessionId: string) => void): void;
     }
     ```
   - Listens on port 1935. App name `live`, stream name = `droneId`.
   - **Milestone 1 includes choosing the library.** Candidates: `node-media-server`, or a lean RTMP protocol package. Criteria: permissive license, maintained, gives access to raw FLV/RTMP video messages per session, has a publish hook to reject keys, works on Windows. Document the decision in `docs/decisions/0001-rtmp-library.md`.

2. **Stream registry** (`src/server/registry/`)
   - Loads drones from `config/drones.json` (see §5). Unknown keys are rejected at publish.
   - Tracks per drone: `state` (`offline` | `live`), `since`, `sessionId`, `viewerCount`, codec info (width, height, codec) when known.
   - If a key publishes while already live, the new session replaces the old one (RC Plus reconnect).
   - Emits change events for the web UI.

3. **GOP cache** (`src/server/gop-cache/`)
   - Per live stream keep: `onMetaData` tag, the latest **video sequence header** (AVC/HEVC decoder config), and all video tags since the **last keyframe**.
   - On each keyframe, reset the GOP buffer. Cap memory per stream (e.g. drop the GOP if it grows beyond a configurable byte limit).
   - When the sequence header **changes** (camera switch), signal a **stream reset** to viewers (see §4).

4. **Delivery** (`src/server/delivery/`)
   - HTTP server on port 8080 (configurable): serves the built web UI and the API.
   - WebSocket per viewer and drone: sends a continuous **FLV byte stream** (see §4).
   - Backpressure: if a viewer's socket buffer exceeds a threshold, drop non-key frames for that viewer until the next keyframe; if it stays congested, close it. One slow viewer must never slow down others.

### Web UI (`src/web/`)

- Built with **Vite** + TypeScript + **React 19** (ADR 0005), structured and designed per ADR 0006 and 0007 (switching between overview and a drone keeps the picture running — no page load, no reconnect; with "Datensparen" on, tiles get keyframes only and the tapped drone switches to the full stream, ADR 0009): feature folders, one SSE store per page, `player/` framework-free except `use-live-player.ts`/`live-video.tsx`, German text in `strings.ts`, plain CSS per component with tokens in `styles/tokens.css`; video recording in the browser in `recording/` (framework-free, ADR 0011). Output to `dist/web/`, served by the service.
- German UI text, large touch targets, works at tablet and 1080p touchscreen size. Users are BOS / Einsatzleitung; Tag/Nacht colour schemes; system fonts only.
- Views:
  - `/` **Overview**: one tile per configured drone, showing name, state and a muted live preview while live. Updates live via SSE without page reload.
  - `/drone/<droneId>` **Single view**: fullscreen player, drone name, state, "Kein Signal" overlay when offline, automatic reconnect with backoff. Used for the kiosk touchscreen.
- Player: wrap mpegts.js in one module (`src/web/player/live-player.ts`). Check `mpegts.getFeatureList().mseLivePlayback`; if unsupported, show a clear German message (e.g. old iPadOS). Enable live latency chasing. On error or on a `stream-reset` close, destroy and recreate the player.

## 4. Protocols and interfaces

| Endpoint | Type | Purpose |
| --- | --- | --- |
| `rtmp://<host>:1935/live/<droneId>` | RTMP | Ingest from Pilot 2 |
| `GET /api/drones` | JSON | List of drones with state |
| `GET /api/events` | SSE | Live registry changes (`drone-updated`) |
| `GET /ws/live/<droneId>` | WebSocket (binary) | FLV stream for one drone |
| `GET /healthz` | JSON | Liveness for scripts |
| `/*` | static | Web UI (SPA fallback to `index.html`) |

**FLV over WebSocket — what a new viewer receives, in order:**
1. FLV file header (9 bytes, video flag only) + `PreviousTagSize0` (4 bytes, zero).
2. Cached `onMetaData` tag (if any).
3. Cached video sequence header.
4. Cached GOP (from the last keyframe), with **timestamps kept as received**.
5. Live video tags as they arrive.

Each FLV tag must be followed by its `PreviousTagSize`. Every WebSocket message contains whole tags only.

**Close codes** (custom, 4000–4999):
- `4000 drone-offline` — publisher disconnected. Client shows "Kein Signal" and retries.
- `4001 stream-reset` — sequence header changed or publisher replaced. Client recreates the player immediately.
- `4004 unknown-drone`.
- `4008 viewer-too-slow` — backpressure limit.

If the drone is offline when a viewer connects, keep the socket open and start sending as soon as it goes live, or close with `4000` — pick one, document it, and make the client handle both.

## 5. Configuration

`config/drones.json` (validated at startup with zod; fail fast with a clear message):

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

- `id`: `^[a-z0-9-]{1,32}$`, used as the RTMP stream key and in URLs.
- Ship `config/drones.example.json`; `config/drones.json` is git-ignored.
- Allow overriding the config path via `--config` or an environment variable.

## 6. Repository layout (target)

```
/
├─ CLAUDE.md
├─ package.json            # scripts below; "type": "module"
├─ tsconfig.json           # strict
├─ config/drones.example.json
├─ src/
│  ├─ server/
│  │  ├─ index.ts          # composition root
│  │  ├─ config.ts
│  │  ├─ logger.ts         # structured logs (pino or similar)
│  │  ├─ flv/              # FLV tag types, header/tag writers, parsers (own code)
│  │  ├─ ingest/
│  │  ├─ registry/
│  │  ├─ gop-cache/
│  │  └─ delivery/
│  └─ web/
│     ├─ index.html
│     ├─ main.tsx, app.tsx, routes.ts, strings.ts
│     ├─ service/ player/ recording/ lib/ components/ styles/
│     └─ features/         # live/ (overview + single view, ADR 0007), diagnostics/
│  └─ sim/                 # drone simulator, chaos proxy, viewer load tester (dev/test only)
│     ├─ cli.ts
│     ├─ drone.ts          # one simulated drone = one ffmpeg process + lifecycle
│     ├─ scenarios.ts
│     ├─ chaos-proxy.ts    # TCP proxy between simulated drone and ingest
│     └─ viewers.ts        # headless WebSocket viewers + metrics
├─ sim/scenarios/          # scenario files (JSON)
├─ test/                   # vitest unit + integration + scenario tests
├─ scripts/
│  └─ install-windows.ps1  # service + firewall rules
└─ docs/decisions/         # short ADRs
```

## 7. Commands

Define these npm scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Server with watch mode + Vite dev server (proxy `/api` and `/ws` to the server) |
| `npm run build` | Type-check, build server and web into `dist/` |
| `npm start` | Run the built service |
| `npm test` | vitest |
| `npm run lint` | ESLint + Prettier check |
| `npm run sim -- --drones 5` | Start 5 simulated drones against the local service (see §10) |
| `npm run sim -- --scenario sim/scenarios/field-day.json` | Run a scripted scenario |
| `npm run sim:viewers -- --per-drone 3 --duration 300` | Headless viewer load test with a metrics report |
| `npm run test:scenarios` | Automated scenario tests (service + simulator + viewers, asserts outcomes) |

ffmpeg is a **development and test tool only** (must be on PATH on the dev machine). The service must never depend on it at runtime.

## 8. Windows deployment

- `scripts/install-windows.ps1` (run as administrator):
  - Registers the service to start automatically at boot (evaluate `node-windows` or a Node.js Single Executable Application with a service wrapper; document the choice as an ADR).
  - Creates inbound Windows Firewall rules for TCP 1935 and 8080 (`New-NetFirewallRule`), private network profile only.
  - Copies `drones.example.json` to `drones.json` if missing.
- Logs go to a file under the install directory with rotation, plus the console.
- No admin rights needed at runtime.

## 9. Milestones

Work in this order. Each milestone ends with passing tests and a short note in `docs/`.

1. **Skeleton + simulator basics + ingest spike**: project setup, config loading, `npm run sim -- --drones 1` (one ffmpeg drone with overlay), choose the RTMP library (ADR), receive the simulated stream, log tag types, keyframes, sequence header, resolution.
2. **Single-drone playback**: FLV writer, GOP cache, WebSocket delivery, minimal page with mpegts.js. Measure end-to-end latency with the burnt-in clock.
3. **n drones**: registry, key validation, `/api/drones`, SSE, overview and single view, fixed assignment URL. Simulator: `--drones n`, unknown-key drone.
4. **Robustness**: simulator scenarios (camera switch, publisher drop/reconnect, duplicate key), chaos proxy (latency, bandwidth cap, stalls, cuts), viewer reconnect, backpressure, close codes. Automated scenario tests.
5. **Load test**: headless viewers + metrics report; find the limits on the dev machine; document bandwidth per stream.
6. **Windows packaging**: build, install script, service, firewall, logs. Run the scenario suite on Windows.
7. **Real hardware (later, when an RC Plus is available)**: compare real Pilot 2 parameters with the simulator profile and adjust the profile.

## 10. Simulation and testing

**There is no real drone or RC Plus during development.** The simulator is a first-class part of the repository, not a throwaway script. It lives in `src/sim/`, is written in TypeScript like the rest, and is never bundled into the production service.

### 10.1 Simulated drone (`src/sim/drone.ts`)

One simulated drone = one ffmpeg child process that pushes RTMP to `rtmp://<host>:<port>/live/<droneId>`, managed by Node (start, stop, restart, exit handling, log forwarding).

- **Visual identity**: burnt-in overlay with drone id, camera mode, frame counter and wall-clock time with milliseconds (for latency measurement by eye or by OCR-free comparison with the viewer's clock). Each drone uses a distinct background colour so tiles are easy to tell apart.
- **Pilot 2 profile** (defaults, all configurable; real values are unknown until hardware is available): H.264 (High profile), 1920×1080 and 1280×720 variants, 30 fps, keyframe interval 1–2 s, constant-ish bitrate 2–8 Mbit/s, no B-frames, no audio by default (option to add an AAC track so we verify audio is dropped correctly).
- **Camera modes** emulating the M30T views, each a different ffmpeg source/filter chain and optionally a different resolution:
  - `wide`: moving test pattern (e.g. `testsrc2`)
  - `zoom`: zoomed/cropped pattern at a different resolution
  - `thermal`: greyscale/pseudo-colour pattern (e.g. a palette filter) at 640×512 upscaled or native, to force a sequence-header change
- **Camera switch**: like Pilot 2, the stream switches mid-session. Implement as either (a) restart ffmpeg on the same key quickly, and/or (b) one long-running ffmpeg with a filter that changes source — option (a) is enough if (b) is hard; document which behaviour each produces.
- **Optional real footage**: `--source <file>` loops a local video file instead of the test pattern (for realistic bitrate and motion).

### 10.2 Scenarios (`sim/scenarios/*.json`, `src/sim/scenarios.ts`)

A scenario is a timeline of actions per drone. Required built-in scenarios:

| Scenario | What it does | Expected service behaviour |
| --- | --- | --- |
| `steady` | n drones stream continuously | All live, stable playback |
| `staggered-start` | Drones join one by one, some leave | Overview updates live without reload |
| `camera-switch` | Each drone switches wide → zoom → thermal → wide every few seconds | Viewers get `4001 stream-reset`, playback resumes |
| `publisher-drop` | Drone stream stops abruptly and returns after 5–60 s | "Kein Signal", then automatic recovery |
| `duplicate-key` | Second publisher with an already live key | New session replaces old one, documented behaviour |
| `unknown-key` | Drone with a key not in config | Rejected, logged, not shown |
| `bad-wifi` | Through the chaos proxy: latency, jitter, bandwidth cap, short stalls, hard cuts | No crash, no memory growth, recovery after the network heals |
| `field-day` | Mix of all of the above over 30+ minutes with n drones | Service stays healthy, metrics within limits |

Format example:

```json
{
  "name": "camera-switch",
  "drones": [{ "id": "m30t-01", "profile": "1080p30" }, { "id": "m30t-02", "profile": "720p30" }],
  "timeline": [
    { "at": "0s",  "drone": "*",       "action": "start", "camera": "wide" },
    { "at": "20s", "drone": "m30t-01", "action": "switchCamera", "camera": "thermal" },
    { "at": "40s", "drone": "m30t-02", "action": "drop", "for": "15s" }
  ]
}
```

### 10.3 Chaos proxy (`src/sim/chaos-proxy.ts`)

A small TCP proxy (own code) between simulated drones and the ingest port, used to emulate field Wi-Fi without real radio: added latency and jitter, bandwidth cap, pauses (stall for N seconds without closing), hard connection cuts, and slow reads. Controllable from scenarios. The same proxy idea can sit in front of the HTTP/WebSocket port to emulate a weak tablet connection.

### 10.4 Simulated viewers (`src/sim/viewers.ts`)

Headless WebSocket clients (no browser) that connect to `/ws/live/<droneId>`, parse the FLV stream and record metrics: time to first keyframe, bytes/s, stalls (gaps > X ms), reconnects, close codes received. Configurable number of viewers per drone. Writes a report to `sim/reports/<timestamp>.json` and prints a summary table. Also sample server memory/CPU via `/healthz` during the run.

### 10.5 Browser checks

- A **simulation dashboard page** (dev only, e.g. `/dev/sim` served only when `NODE_ENV=development`) is optional; the normal overview with n simulated drones is the main manual test.
- To test tablets without hardware drones: run service + simulator on the dev PC, open the web UI from real Android/iPad devices in the same Wi-Fi.
- Manual checklist in `docs/manual-test.md`: Chrome on Android, Chrome on iPad (iPadOS ≥ 17.1), Chrome on Windows; each scenario from §10.2 observed once in the browser.

### 10.6 Automated tests

- **Unit** (vitest): FLV parsing/writing (byte-exact), GOP cache (keyframe reset, sequence-header change, memory cap), registry state transitions, config validation, scenario file parsing.
- **Integration**: start the service on random ports, start simulated drones, connect simulated viewers, assert the first bytes are a valid FLV header followed by metadata, sequence header and a keyframe.
- **Scenario tests** (`npm run test:scenarios`): run short versions of every scenario in §10.2 and assert the expected behaviour (states via `/api/drones`, close codes and recovery via simulated viewers, no unbounded memory growth).
- Tests that need ffmpeg skip with a clear message if it is missing; CI must install ffmpeg so they run there.

## 11. Coding conventions

- TypeScript strict, no `any` without a comment explaining why.
- Small modules with explicit interfaces; the composition root wires them together. No global singletons.
- Binary handling with `Buffer`; never convert video data to strings.
- Every error path is logged with `droneId` and `sessionId`.
- Never block the event loop: no synchronous file I/O after startup.
- Commit messages in English, imperative mood (Conventional Commits welcome).

## 12. Background facts (do not re-research)

- Pilot 2 streams the **main view only**. When the pilot switches between wide, zoom and thermal, the stream switches too and parameters may change.
- Pilot 2 pushes to **one** RTMP target at a time — this service must be that target.
- mpegts.js plays FLV over WebSocket via MSE; on iPadOS ≥ 17.1 it uses Managed Media Source. Chrome on iPad uses WebKit, so iPad behaviour equals Safari's.
- The live image is for situational awareness, **not** for flying. Pilots always fly from their RC Plus screen.

## 13. Open points (ask the user if they block you)

- Real Pilot 2 stream parameters (codec, resolution, bitrate, keyframe interval) — unknown until an RC Plus is available; until then use the simulator profile from §10.1 and keep it easy to adjust.
- Acceptable end-to-end latency.
- Maximum number of drones and viewers for the load test.
- Whether the web UI needs a login.

The full concept (German) lives in the team's Claude doc "Konzept: Drohnen-Livestream DJI Matrice 30T".
