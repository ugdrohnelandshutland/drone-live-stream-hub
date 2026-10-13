# ADR 0005: React for the web UI

- Status: accepted; layout section superseded by ADR 0006
- Date: 2026-10-10
- Decided by: product owner

## Context

Until v0.2.0 the web UI was plain DOM (CLAUDE.md §3: "prefer no framework unless it clearly
helps"). With the diagnostics page, the single-view toolbar and the still image, the views had
grown to about 600 lines of HTML strings in `innerHTML`, lookups via `querySelector` and
hand-written update functions that copied every field into the DOM. That is the part a
framework does for us, and it was the main obstacle for a developer new to the code.

## Decision

- **React 19** with TypeScript, built by Vite (`@vitejs/plugin-react`). React is the framework
  most frontend developers know, MIT-licensed and actively maintained.
- **No further libraries.** No router (three routes, resolved once per page load in
  `src/web/app.tsx`; links stay plain `<a href>`, so the kiosk URL works on its own), no state
  library (`useDrones()` wraps the SSE subscription), no CSS framework (`styles.css` and its
  class names are unchanged).
- **The player stays framework-free.** `player.ts` (mpegts.js, reconnect, latency chasing) is
  unchanged except for one cleanup fix. `hooks/use-live-player.ts` is the only bridge: it starts
  a `LivePlayer` in an effect and destroys it in the cleanup. The player is recreated only when
  the URL or the tuning changes, never because a callback changed.
- **StrictMode is on.** It mounts every component twice in development, which proves that no
  mpegts.js instance or WebSocket survives an unmount. `test/web/views.test.tsx` checks this
  with a fake player (jsdom + Testing Library).
- **Lint:** `eslint-plugin-react-hooks` (recommended rules, including the React Compiler checks).

## Layout

```
src/web/
├─ main.tsx              # createRoot + StrictMode
├─ app.tsx               # route by pathname
├─ hooks/                # use-drones, use-live-player, use-service-info, use-document-title
├─ views/                # overview.tsx, single-view.tsx, diagnostics.tsx
└─ player.ts, format.ts, latency.ts, snapshot.ts, diagnostics-checks.ts, drones-client.ts
                         # framework-free modules, unchanged
```

## Consequences

- Two runtime dependencies more (`react`, `react-dom`); the bundle grows by about 60 kB gzip
  to 140 kB gzip in total, loaded once over the local Wi-Fi.
- Latency is unchanged: measured back to back on the dev PC with two simulated drones,
  old UI avg 370 ms / p95 434 ms, React UI avg 332 ms / p95 396 ms (same machine load; the
  170 ms from milestone 2 were measured with one drone on a quieter machine).
- Behaviour, URLs, query parameters (`?kiosk`, `?stats`, `?previews=0`, latency tuning) and the
  `#stats` data attributes used by `scripts/measure-latency.ts` are unchanged.
- The manual checklist (`docs/manual-test.md`) should be run once on the tablets, iPad first.
- CLAUDE.md §3 "Web UI" is superseded by this record.
