# ADR 0001: RTMP ingest library

- Status: accepted
- Date: 2026-10-09
- Milestone: 1

## Context

The service must accept RTMP publishes from DJI Pilot 2 (RC Plus) on port 1935, app `live`,
stream name = drone id. CLAUDE.md §3 asks for a library that is used **only for ingest**, behind
our `IngestAdapter` interface. Criteria:

1. Permissive license (MIT, Apache-2.0, BSD, ISC).
2. Maintained.
3. Access to raw FLV/RTMP video messages per session (we forward them unchanged).
4. A publish hook that can reject unknown stream keys.
5. Works on Windows without a native toolchain.
6. Small dependency footprint.

## Options evaluated (npm registry, 2026-10-09)

| Package                  | Version / last publish | License    | Notes                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-media-server`      | 4.4.3 / 2026-09-10     | Apache-2.0 | Pure JS, actively maintained, widely used. Full media server (HTTP-FLV, relay, record, admin UI, JWT API, global `Context` singleton). Its protocol layer `src/protocol/rtmp.js` is a self-contained RTMP parser with callbacks and no global state. Parses legacy and Enhanced RTMP (HEVC/AV1/VP9 FourCC). |
| `@astronautlabs/rtmp`    | 1.2.1 / 2026-08-06     | MIT        | TypeScript, RxJS-based. Sparse release history (2022 → 2025 → 2026). 1.2.1 changelog fixes a throughput cap of ~2 Mbit/s, i.e. below our expected 2–8 Mbit/s until very recently. No test suite in the package. Pulls `rxjs` and the `@astronautlabs/*` bitstream stack.                                    |
| `medooze-rtmp-server`    | 1.25.6 / 2025-03       | MIT        | Native addon (`node-gyp`, `nan`): needs a C++ toolchain on the Windows field PC. Rejected (criterion 5).                                                                                                                                                                                                    |
| `@mediafish/rtmp-server` | 0.1.4 / 2022-12        | MIT        | Unmaintained. Rejected (criterion 2).                                                                                                                                                                                                                                                                       |
| `rtmp-server`            | 0.2.0 / 2017           | GPL-2.0    | Rejected (criterion 1).                                                                                                                                                                                                                                                                                     |
| Own implementation       | –                      | –          | Handshake + chunk parser + AMF0 commands are ~800 lines. Possible, but more risk than reusing a maintained parser. Kept as fallback; the adapter interface makes the swap cheap.                                                                                                                            |

## Decision

Use **`node-media-server` 4.4.3, protocol layer only**: `NmsIngestAdapter`
(`src/server/ingest/nms-adapter.ts`) runs its own `net.Server` and session handling and creates
one `Rtmp` instance (`node-media-server/src/protocol/rtmp.js`) per connection. We do **not**
start `NodeMediaServer`, its HTTP server, its broadcast/relay logic or its `Context` singleton.

The version is pinned exactly (`"node-media-server": "4.4.3"`), because the protocol module is
an internal file, not a documented API. The package has no `exports` map, so the deep import
is allowed by Node. Types are declared in `src/server/ingest/node-media-server.d.ts`.

## Consequences

Positive:

- Pure JavaScript, runs unchanged on Windows/Linux/macOS.
- Per-message access to video, audio and data messages with the RTMP timestamp; we build FLV
  tags from them without any remux.
- Enhanced RTMP parsing is there if Pilot 2 ever sends HEVC with FourCC headers.
- Our own code controls the publish hook, idle timeouts, logging and session ids.

Negative / risks, and how we handle them:

- **Internal API.** Upgrades may break the adapter → exact version pin, integration test
  `test/integration/ingest.test.ts` against a real ffmpeg publisher, review on every upgrade.
- **Reject happens after `NetStream.Publish.Start`.** NMS answers `publish` before it calls
  our callback, so a rejected publisher sees a dropped connection rather than a
  `NetStream.Publish.BadName` status. Acceptable: no data from a rejected session is ever
  forwarded, and the rejection is logged with stream key, session id and remote address.
- **Reused payload buffer.** NMS hands out its parser buffer; the adapter copies exactly
  `packet.size` bytes before emitting a tag.
- **`parserData` can throw** on malformed input (e.g. `new URL(tcUrl)`) → wrapped in
  try/catch, the session is closed and logged; the process never crashes.
- **No RTMP aggregate messages (type 22).** ffmpeg does not send them; unknown for Pilot 2.
  To be checked in milestone 7 with real hardware.
- **Unused transitive dependencies.** Installing NMS pulls `express`, `jsonwebtoken`, `ws`, …
  (~100 packages in the production tree, all MIT/ISC/BSD/Apache-2.0). None of them is loaded
  at runtime because we only import the protocol module. If install size becomes a problem
  for Windows packaging (milestone 6), vendor the three protocol files (`rtmp.js`, `amf.js`,
  `flv.js`, Apache-2.0, with NOTICE) or switch to our own parser behind the same interface.

## Verification (milestone 1 spike)

`npm run sim -- --drones 1` (ffmpeg 8.1, libx264 High, 1080p30, GOP 2 s, 6 Mbit/s) against
the service: metadata (`onMetaData`, `@setDataFrame` stripped), AVC sequence header
(`avc1.640028`, 1920×1080), keyframes every 2000 ms, 30 fps, ~6 Mbit/s, AAC audio dropped,
unknown key rejected, camera switch = new session with new sequence header. See
`docs/milestone-1.md`.
