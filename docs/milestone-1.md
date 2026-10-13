# Milestone 1: skeleton, simulator basics, ingest spike

Status: done (2026-10-09)

## What exists

- Project setup: Node.js 22 LTS, TypeScript strict (6.0, ES modules), vitest, ESLint
  (typescript-eslint strict) + Prettier. Scripts: `dev`, `build`, `start`, `test`, `lint`, `sim`.
- `src/server/config.ts`: `config/drones.json` validated with zod, fail-fast with a readable
  list of problems. Path via `--config <path>`, env `DLSH_CONFIG`, default `config/drones.json`.
- `src/server/flv/`: own FLV code — tag types, header/tag writer, incremental stream parser,
  video tag header parser (legacy AVC/HEVC + Enhanced RTMP), AVC decoder config + SPS parser
  (resolution, profile, level, RFC 6381 codec string), AMF0 decoder, `@setDataFrame` stripping.
- `src/server/ingest/`: `IngestAdapter` interface and `NmsIngestAdapter` (ADR 0001). Accepts only
  app `live`, rejects keys not in the config, drops audio, closes idle publishers after 10 s.
- `src/server/ingest/stream-probe.ts` (since replaced by `src/server/diagnostics/`): spike diagnostics — logs metadata, sequence header
  (codec, resolution, changes), first keyframe, and every 10 s fps, kbit/s, keyframe interval.
  Keyframes themselves at `LOG_LEVEL=debug`.
- `src/sim/`: simulated drone (one ffmpeg process per drone) and CLI.

Not yet: registry, GOP cache, delivery, web UI (milestones 2–3), scenarios, chaos proxy and
viewers (milestones 4–5).

## Running the spike

```sh
npm install
cp config/drones.example.json config/drones.json
npm run dev                      # terminal 1: service (tsx watch)
npm run sim -- --drones 1        # terminal 2: one simulated drone
```

Useful simulator options (`npm run sim -- --help`): `--profile 720p30`, `--camera thermal`,
`--audio`, `--switch-every 6`, `--ids m30t-01,rogue-01`, `--gop 1`, `--bitrate 4000`,
`--source clip.mp4`, `--duration 30`.

ffmpeg must be on PATH (or set `FFMPEG_PATH`). The overlay needs a TrueType font; a system
font is found automatically on Windows/Linux/macOS, otherwise set `SIM_FONT`.

## Simulated drone

- Overlay: drone id, camera mode, resolution, frame counter and wall-clock time with
  milliseconds. The frame timestamp is replaced by the real wall clock (`setpts=RTCTIME`)
  right after the `realtime` pacing filter, so the clock shows when the frame was generated —
  independent of ffmpeg start-up time — and can be compared with the viewer's clock.
  Timestamps are then reset to a constant 30 fps before encoding.
- Each drone gets a distinct background/header colour.
- Pilot 2 profile (`src/sim/profiles.ts`, all values are guesses until hardware is available):
  H.264 High, no B-frames, 30 fps, GOP 2 s, `1080p30` (6 Mbit/s) and `720p30` (3 Mbit/s).
- Camera modes: `wide` (moving pattern on the drone colour, profile resolution), `zoom`
  (cropped and upscaled, 1280×720 / 960×540), `thermal` (inferno palette, 640×512).
- Camera switch = restart ffmpeg on the same key (option (a) of CLAUDE.md §10.1).
  Graceful `stop()` sends `q` to ffmpeg (clean RTMP close); `kill()` kills it (publisher drop).
  Unexpected exits are retried with backoff 1 → 10 s, like an RC Plus reconnect.

## Findings

Measured on the dev machine (WSL2, ffmpeg 8.1, libx264):

|              | 1080p30 wide | 720p30 wide  | zoom (960×540) | thermal (640×512) |
| ------------ | ------------ | ------------ | -------------- | ----------------- |
| codec string | avc1.640028  | avc1.64001f  | avc1.64001f    | avc1.64001e       |
| fps / GOP    | 30 / 2000 ms | 30 / 2000 ms | 30 / 2000 ms   | 30 / 2000 ms      |
| bitrate      | ~6.0 Mbit/s  | ~3 Mbit/s    | ~2 Mbit/s      | ~2.9 Mbit/s       |

- Tag order per session: `onMetaData` → AVC sequence header (ts 0) → keyframe → inter frames.
  ffmpeg sends metadata as `@setDataFrame, onMetaData, {…}`; the adapter strips the prefix.
- Camera switch with the restart approach: old session ends, new session starts ~170 ms
  later with a new sequence header and timestamps starting again at 0. Within one session the
  sequence header never changes in the simulator. The GOP cache (milestone 2) must therefore
  handle both cases: a new session for a live drone (→ `4001 stream-reset`) and a changed
  sequence header inside a session (what real Pilot 2 may do; to be simulated with option (b)
  in milestone 4).
- Audio tags are counted and dropped in the adapter (283 AAC tags in 6 s with `--audio`).
- An unknown key is rejected after the RTMP `publish` command; ffmpeg reports "Broken pipe"
  and exits. The simulator then retries with growing backoff.

## Open points for the next milestones

- Choose and document the "viewer connects while drone is offline" behaviour (milestone 2).
- Real Pilot 2 parameters remain unknown (CLAUDE.md §13); profile values are easy to change.
- The NMS dependency tree is larger than needed (ADR 0001); revisit for Windows packaging.
