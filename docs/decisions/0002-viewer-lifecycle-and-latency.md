# ADR 0002: Viewer lifecycle while offline, and latency-first playback

- Status: accepted
- Date: 2026-10-09
- Milestone: 2
- Decided by: product owner (both points were open in CLAUDE.md §4 and §13)

## 1. Viewer connects while the drone is offline

CLAUDE.md §4 allows two behaviours: keep the WebSocket open, or close with `4000`.

**Decision: keep the socket open.** A viewer of an offline drone (or of a live drone before its
first keyframe) is held in state `waiting`. At the next keyframe it receives the FLV header,
`onMetaData`, the sequence header and the cached GOP, then live tags.

- The kiosk touchscreen starts playing as soon as the drone arrives, without a reconnect loop.
- When a publisher disconnects, _streaming_ viewers are still closed with `4000 drone-offline`
  (their decoder state is useless). The client reconnects after 250 ms and is then held
  waiting by the server, so `4000` costs no polling either.
- _Waiting_ viewers are not closed when a publisher leaves; they never received data.
- The client handles both cases (an open socket without data and `4000`) identically:
  "Kein Signal" and wait.
- Dead viewers (tablet left the Wi-Fi) are detected by WebSocket ping every 15 s.

## 2. Latency target

**Decision: as low as possible.** Where latency and smoothness conflict, prefer latency;
measure it continuously.

Consequences:

- Server: every tag is sent immediately (no batching, no compression, `TCP_NODELAY`).
  New viewers start from the last keyframe (GOP cache), so the first frame appears at once.
- Player (`src/web/player.ts`): no stash buffer, no lazy load, mpegts.js `liveSync`
  (play at 1.1× above 150 ms buffer, down to 80 ms) plus latency chasing (seek above 400 ms,
  keep 50 ms). Values are overridable per URL for field tuning
  (`?syncTarget=…&syncMax=…&syncRate=…&chaseMax=…&chaseMinRemain=…`).
- Measured on the dev PC: ~170 ms average glass-to-glass at 1080p30 (docs/milestone-2.md).
- Risk: a small buffer reacts to Wi-Fi jitter with short freezes. To be measured with the
  chaos proxy in milestone 4; the defaults may need to become slightly larger.
- The GOP length of the publisher (unknown for Pilot 2) affects only the start-up time
  of a new viewer, not the steady-state latency.
