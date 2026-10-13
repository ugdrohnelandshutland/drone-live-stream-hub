# ADR 0003: Scope changes after milestone 3

- Status: accepted
- Date: 2026-10-09
- Decided by: product owner

## Decisions

1. **No load test.** Milestone 5 (headless viewer load test, limit finding, bandwidth report,
   `npm run sim:viewers`) is dropped. The number of drones and viewers in the field is small.
   The reconnecting headless viewer (`src/sim/viewer-client.ts`) still exists as a measuring
   instrument for scenario tests and `npm run sim -- --scenario … --report`.
2. **No login in the first release.** Everyone in the field Wi-Fi can watch. A login may come
   later; the HTTP layer (`DeliveryServer`) routes all requests through one handler, so an
   authentication check can be added there without touching ingest or delivery logic.

## Consequences

- Next after milestone 4 is milestone 6 (Windows packaging).
- CLAUDE.md §7 and §9 still mention `sim:viewers` and milestone 5; they are superseded by
  this record.
