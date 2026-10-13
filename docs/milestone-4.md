# Milestone 4: robustness

Status: done (2026-10-10)

## What exists

### Simulator

- **Camera switch inside one RTMP session** (`switchMode: "inline"`, now the default): one
  encoder per camera writes FLV to stdout, `FlvSplicer` joins the segments with continuous
  timestamps, and a pusher ffmpeg (`-c copy`) holds the single RTMP connection. The service
  sees a new `onMetaData` and sequence header inside the running session, which is what
  Pilot 2 is expected to send. `switchMode: "restart"` keeps the old behaviour (publisher
  reconnects). Start-up of both modes: first keyframe at the viewer after ~230 ms.
  (Lesson: the pusher must not use `-fflags nobuffer`; it drops the probed first keyframe.)
- **Chaos proxy** (`src/sim/chaos-proxy.ts`, own code): per connection and direction
  latency, jitter (order preserved), bandwidth cap (token bucket, large chunks sliced),
  stalls without closing (data piles up, TCP backpressure to the sender), hard cuts
  (TCP RST) with an optional "out of range" period that refuses new connections, `heal()`.
- `npm run sim:proxy -- --listen 8090 --target 8080 --latency 40 --jitter 60 --bandwidth 4000`
  puts the proxy in front of the web/WebSocket port to emulate a weak tablet connection
  (keys: `s` stall 3 s, `c` cut, `h` heal, `q` quit).
- **Scenarios** (`src/sim/scenarios.ts`, files in `sim/scenarios/`): JSON timeline validated
  with zod. Actions: `start`, `stop`, `drop` (+`for`), `switchCamera`, `duplicate` (+`for`),
  `network`, `stall`, `cut` (+`for`), `heal`. Durations like `500ms`, `5s`, `2m`. Drones
  go through their own chaos proxy when the scenario uses network actions.
  - `npm run sim -- --scenario sim/scenarios/<name>.json` plays one against a running service.
  - `--report` adds one reconnecting viewer per drone and `/healthz` sampling every 10 s and
    writes `sim/reports/<scenario>-<time>.json` plus a summary table.
- All scenarios from CLAUDE.md §10.2: `steady`, `staggered-start`, `camera-switch`,
  `publisher-drop`, `duplicate-key`, `unknown-key`, `bad-wifi`, `field-day` (36 min,
  72 actions, generated with a fixed seed).
- **Reconnecting headless viewer** (`src/sim/viewer-client.ts`) with the browser player's
  reconnect rules; records close codes, time to first keyframe, stalls, max gap,
  resolutions and timestamp regressions.

### Service

- **Duplicate key:** a new publish for a live key replaces the old session and the old RTMP
  connection is now actively closed (`IngestAdapter.disconnect()`). Viewers get `4001`; the
  drone is never shown offline in between. Three replacements within 60 s are logged as an
  error ("two senders probably use the same stream key"): two RC Plus with the same key
  would keep taking over from each other.
- **Closing congested viewers:** the close frame is sent, but if the viewer has not completed
  the close within 2 s the socket is cut. Behind a congested link the close frame would sit
  after megabytes of queued video, and `ws` would keep that socket and its queue for 30 s.
- `/healthz` per drone now also reports `droppedTags` (frames not sent to congested viewers).

### Behaviour reference (verified)

| Situation                                      | Service                                                  | Viewer                                                                      |
| ---------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Camera switch, inline                          | same session, new sequence header                        | `4001`, new picture < 1 s (≈ 60 ms)                                         |
| Camera switch, restart                         | session ends + new session                               | `4000`, reconnect, picture back                                             |
| Publisher crash                                | offline at once (TCP close)                              | `4000`, waits on open socket, picture back ~0.2 s after the drone returns   |
| Stall < 10 s                                   | stays live                                               | gap in the picture, then continues ("Kein Signal" after 2 s in the browser) |
| Stall > 10 s                                   | idle timeout → offline; drone reconnects after the stall | `4000`, then picture back                                                   |
| Out of range (cut)                             | offline; drone retries with backoff 1 → 10 s             | `4000`, then picture back                                                   |
| Duplicate key                                  | newest session wins, old connection closed               | `4001`                                                                      |
| Unknown key                                    | rejected, logged, never listed                           | `4004`                                                                      |
| Slow tablet (1.5 Mbit/s for a 6 Mbit/s stream) | frames dropped until the next keyframe                   | thinned-out picture (~7 of 30 fps), stays connected                         |
| Hopeless tablet (0.3 Mbit/s)                   | `4008` after 10 s congestion; socket cut after 2 s       | reconnects with backoff                                                     |

## Tests

- `npm test`: unit + integration (FlvSplicer, chaos proxy, registry replacement, …).
- `npm run test:scenarios` (new, ~4.5 min, needs ffmpeg): short versions of all scenarios
  against a real service with real ffmpeg drones and reconnecting viewers:
  - steady — 3 drones × 2 viewers, 20 s: no close, no stall, no timestamp regression
  - staggered-start — state sequences, join order, viewer recovers after a stop
  - unknown-key — rejected, `4004`, never in the API/SSE
  - camera-switch — inline: exactly 3 × `4001`, resolutions 1080p → 720p → 640×512 → 1080p,
    one RTMP session; restart: 3 × `4000`, same resolution sequence for 720p
  - publisher-drop — offline gap 5–8 s for a 6 s drop, viewers `4000` then playing
  - duplicate-key — duplicate takes over, original takes back, never offline
  - bad-wifi — latency/jitter, bandwidth below bitrate, 3 s and 13 s stalls, 5 s cut: both
    drones end live and watchable, GOP cache < 16 MB, heap growth < 30 MB
  - weak viewers — thinned-out vs. cut off, a normal viewer sees no stall
  - field-day (75 s mix) — every drone ends live and watchable, memory bounded

## Latency under Wi-Fi jitter (real Chrome through the chaos proxy)

1080p30, headless Chrome on the Windows host, viewer side through `sim:proxy`, 40 s each:

| Network     | Tuning                             | avg    | p95    | max    | stalls | dropped frames |
| ----------- | ---------------------------------- | ------ | ------ | ------ | ------ | -------------- |
| 30 ± 40 ms  | default (0.08 / 0.15 / 0.4 / 0.05) | 236 ms | 265 ms | 345 ms | none   | 57             |
| 30 ± 40 ms  | 0.15 / 0.3 / 0.6 / 0.1             | 275 ms | 438 ms | 501 ms | none   | 28             |
| 60 ± 150 ms | default                            | 381 ms | 478 ms | 582 ms | none   | 92 (7.6 %)     |
| 60 ± 150 ms | 0.25 / 0.5 / 1.0 / 0.2             | 434 ms | 525 ms | 641 ms | none   | 18 (1.5 %)     |

The latency-first defaults stay: no stalls even with heavy jitter. A larger buffer costs
~50 ms and drops fewer frames (smoother motion); it can be set per device via the URL
(`?syncTarget=0.25&syncMax=0.5&chaseMax=1&chaseMinRemain=0.2`) if a tablet looks choppy.

## field-day (36 min)

`npm run sim -- --scenario sim/scenarios/field-day.json --report` against the built service
(`npm start`), 3 drones (1080p inline, 1080p inline, 720p restart), 36 min, 72 timeline
actions (83 including restarts and duplicate ends):

| Drone   | Connects | Close codes        | Stalls > 1 s | Max gap | Timestamp regressions | Playing at end |
| ------- | -------- | ------------------ | ------------ | ------- | --------------------- | -------------- |
| m30t-01 | 12       | 4000 × 6, 4001 × 5 | 4            | 5.0 s   | 0                     | yes            |
| m30t-02 | 12       | 4000 × 6, 4001 × 5 | 0            | 0.2 s   | 0                     | yes            |
| m30t-03 | 18       | 4000 × 17          | 1            | 2.0 s   | 0                     | yes            |

- Service memory over 36 min (218 samples): RSS 91 → 99 MB (max 110 MB), heap
  12.5 → 11.8 MB, GOP caches together ≤ 3.5 MB. No growth.
- No errors in the service log. Warnings were all expected: idle timeouts during the 14 s
  stalls, socket errors on cuts.
- m30t-03 uses restart mode, so each of its camera switches is a `4000` + reconnect.

## Notes

- The test proxy has much larger buffers than real Wi-Fi (kernel socket buffers), so a cut
  off slow viewer notices the cut late in tests; on real Wi-Fi far less data is in flight.
- Two publishers with the same key take over from each other until one stops; this is
  inherent in "newest wins" (needed so an RC Plus can reconnect before its old TCP
  connection timed out) and is logged as an error.
