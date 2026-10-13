# ADR 0007: Fast switching between drones

- Status: accepted
- Date: 2026-10-10
- Decided by: product owner ("switching between tiles is far too slow")
- Supersedes: "Full page loads between pages" in ADR 0006

## Measurements (before)

Headless Chrome on the dev PC, two simulated drones at 1080p30, 6 Mbit/s, keyframe every 2 s,
production build. Time from opening a view to its first presented frame:

| View         | Before       | Main cost                                                         |
| ------------ | ------------ | ----------------------------------------------------------------- |
| Single view  | 0.45 – 3.3 s | page load, new WebSocket, dropped frames, seek before first frame |
| Overview (2) | 1.9 – 2.5 s  | as above, twice                                                   |

The Vite dev server (`npm run dev`) adds 0.6 – 2 s per page load on top (68 unbundled modules);
judge speed with the production build.

## Causes and decisions

1. **The server treated every late joiner as a slow viewer.** A new viewer gets the cached GOP
   in one message — up to 1.5 MB for a 2 s GOP at 6 Mbit/s — while the soft backpressure limit
   is 1 MB. The socket buffer was over the limit at once, so the following frames were dropped
   until the next keyframe: up to 2 s without picture, on a tablet over Wi-Fi on nearly every
   switch. **Decision:** the start snapshot is added to both limits until it has drained below
   the soft limit (`LiveChannel.startupBytes`). A viewer that really is too slow still hits the
   limits once the snapshot is through.
2. **The player jumped to the live edge before showing anything.** mpegts.js' latency chaser
   seeks as soon as the cached GOP is buffered; the browser then decodes up to 2 s of frames
   before the first one appears (0 – 600 ms, depending on where in the GOP the viewer joined).
   **Decision:** chasing is done by `LivePlayer` and only after the first presented frame: the
   keyframe is on screen at once, then the picture jumps to live. `liveSync` (playback rate)
   stays with mpegts.js.
3. **Every switch was a page load and a new connection.** Tile and single view show the same
   stream (no transcoding), so the picture does not need to be re-fetched at all.
   **Decision:** overview and single view are one page (`features/live/`). A tap changes the URL
   with the History API (`navigation.ts`); the tapped monitor stays mounted — same `<video>`,
   player and WebSocket — and only its layout changes. The other monitors unmount while one is
   focused (saves decoding and Wi-Fi on tablets) and reconnect on the way back, which is fast
   now thanks to 1 and 2. Back/forward and swipe work via `popstate`; direct URLs and the kiosk
   are unchanged; modified clicks (new tab) are left to the browser.

## Measurements (after)

| Switch                     | After                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Overview → drone           | **no reconnect**, picture continues (largest frame gap 120 – 390 ms = normal headless jitter) |
| Drone → overview           | focused drone continues; others first frame after 0.12 – 0.77 s                               |
| Direct page load, single   | first frame 0.22 – 0.6 s                                                                      |
| Direct page load, overview | first frame 0.22 – 0.5 s (cold browser cache up to 1.9 s)                                     |

No frames dropped for viewers during these runs (before: hundreds). Latency unchanged
(`measure-latency.ts`: avg 361 ms, p95 506 ms on the same loaded machine).

## Consequences

- One more piece of client code (`navigation.ts`, ~40 lines) instead of a router library.
- Fullscreen is requested on the monitor element, which now survives the switch back to the
  wall; the monitor ends fullscreen itself when it loses focus (button, browser back, swipe).
- Teardown of hidden monitors relies on React unmounting; covered by tests (one player under
  StrictMode, the focused player is the same instance after wall → drone → wall, others stop).
- Real tablets decode in hardware, so the seek after the first frame should be shorter there;
  to confirm with `docs/manual-test.md`.
