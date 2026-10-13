# ADR 0006: Web UI architecture and design

- Status: accepted
- Date: 2026-10-10
- Decided by: product owner (users, fonts, colour schemes); architecture review
- Supersedes: the layout section of ADR 0005
- Superseded in part by ADR 0007 (in-place switching instead of page loads; `features/live/`)

## Context

ADR 0005 ported the plain-DOM UI to React one to one. This record restructures it for a
developer new to the code and redesigns it for the people who use it: an **Einsatzleitung**
(Feuerwehr, THW, Polizei) watching tablets outdoors in sunlight, a large screen in the ELW, at
day and night. The job of the UI: at a glance, which drone shows what, and is that picture live.

## Architecture

```
src/web/
├─ main.tsx            createRoot, StrictMode, ErrorBoundary, one drones store per page
├─ app.tsx             page per route
├─ routes.ts           parseRoute(), droneHref(), readPageOptions() — views never read `location`
├─ strings.ts          German UI text (status words: player/player-status.ts)
├─ styles/             tokens.css (colours, spacing, type, both schemes), base.css
├─ service/            http.ts (single place for a future auth hook), drones-store.ts (SSE),
│                      use-drones.ts, use-service-info.ts (not `api/`: Vite proxies /api)
├─ player/             live-player.ts (mpegts.js, framework-free), player-status.ts,
│                      use-live-player.ts, live-video.tsx, use-settled-status.ts, latency-meter.ts
├─ lib/                format.ts, snapshot.ts, download.ts, theme.ts, use-polling.ts, …
├─ components/         StatusBadge, DroneStrip, PictureOverlay, Banner, Notice, Toast,
│                      ThemeSwitch, AppFooter, ErrorBoundary, icons — each with its own .css
└─ features/           overview/, single-view/, diagnostics/ — one folder per page
```

- **Full page loads between pages** (no client-side router). The browser then guarantees that
  every MSE buffer, WebSocket and timer of the previous page is gone; hashed assets are cached
  immutably, so a reload is cheap; a preview player cannot be moved to another element anyway.
- **One SSE connection per page**: `createDronesStore()` is framework-free and read through
  `useSyncExternalStore`. It closes on a deferred tick after the last unsubscribe (StrictMode's
  resubscribe does not reconnect) and rebuilds the EventSource when the browser has given up
  (`readyState CLOSED`, e.g. HTTP 502 from a proxy) — before, the banner stayed forever.
- **No zod in the browser**: server and bundle ship together. Events are parsed defensively;
  a kiosk reloads itself when `/api/info` reports a different release.
- **One status table**: `describeStatus()` maps a player status to tone, word, overlay text
  and whether it applies at once. `useSettledStatus()` delays short interruptions by 1 s;
  badge and overlay both use it, so a camera switch no longer flickers the strip.
- **`<LiveVideo>` owns the `<video>` element and its player**: a new element always gets a
  new player. Callbacks go through `useEffectEvent`, so they never recreate the player.
- **Stats panel** (`?stats`) watches frames itself; no ref shared with the page.
- **Diagnostics polling** chains requests (no overlap on weak Wi-Fi), aborts on unmount and
  pauses while the tab is hidden.
- **Error boundary**: a render error shows a German message and reloads after 10 s instead of a
  blank kiosk screen.
- **Styling**: plain CSS, one file per component imported by it, tokens as custom properties.
  No CSS Modules: class names stay readable and `.status[data-state]` / `#stats` stay stable
  for `scripts/measure-latency.ts`.
- **Tests**: pure logic (routes, store, layout, status table, format) plus jsdom component
  tests with a fake player and a fake EventSource (one player under StrictMode, delayed
  overlay, kiosk, banner, theme, error boundary). Playback, MSE and layout are covered by the
  scenario tests, `measure-latency.ts` and `docs/manual-test.md`.

Not adopted: Wake Lock (needs a secure context; the field Wi-Fi serves plain HTTP — use the
device's display timeout setting); pausing off-screen previews (all monitors are on screen).

## Design

**Concept: monitor wall.** As in a Leitstelle or a broadcast gallery, each drone is a monitor
with a black bezel and a label strip (the "under-monitor display"): slot number, name, facts
and status. The same strip sits above the picture in the single view.

- **Overview fills the screen**: all drones visible without scrolling on tablets, the kiosk and
  laptops (`wall-layout.ts`: 4 → 2×2, 6 → 3×2; upright tablet: one column up to three).
  Phones scroll one column.
- **The slot number is the one loud element**: a block in the status colour, the number people
  use on the radio ("Bild 2"). Everything else stays quiet: no shadows, gradients or
  hover-only affordances; square corners.
- **Status never by colour alone**: word plus shape — dot = Live, triangle = Kein Signal,
  cross = Gestört/Unbekannt, pulsing ring = Verbinde, dash = Offline. A picture without signal
  gets a diagonal hatch, recognisable from across the room. A drone that is simply not up is
  grey ("Offline"), not a warning.
- **Two colour schemes**, signal colours as the only accents: **Tag** (cool grey ground, white
  strips, near-black text, dark saturated signals — for sunlight) and **Nacht** (deep navy,
  dim text — for the ELW and night operations). Default follows the device; the Tag/Nacht
  switch in the overview stores a choice per device; `?theme=tag|nacht` fixes it for the kiosk.
  `index.html` applies it before the first paint, so page changes do not flash.
- **Type**: system fonts only (product decision; no OFL font files). Personality from a strict
  1.25 scale, heavy weights for number and status, tabular figures everywhere.
- **Touch**: at least 48 px; `?kiosk` raises targets to 56 px and the strip to 72 px for reading
  from a few metres.

## Consequences

- Behaviour, URLs and query parameters are unchanged; new: `?theme=tag|nacht`.
- Latency unchanged (dev PC, two simulated drones, back to back: avg 338 ms / p95 465 ms vs.
  332 / 396 ms before; within run-to-run variation).
- Status words changed slightly: "Gestört" instead of "Verbindung gestört" in the strip,
  "Offline" for drones the registry reports offline (overlay still says "Kein Signal").
- `docs/manual-test.md` has new checks (no-scroll wall, Tag/Nacht outdoors, kiosk reload).
