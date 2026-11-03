# ADR 0013: Even out video timestamps and drop empty frames for viewers

- Status: accepted
- Date: 2026-11-03
- Decided by: product owner, after the measurements below
- Amends: CLAUDE.md §4 ("timestamps kept as received"), ADR 0009 (same sentence)

## Context

Captures from a real RC Plus (second field test, 2026-11-03) show how Pilot 2 packs the
stream:

- Pictures are stamped **2–37 ms apart** instead of every 33 ms. The RTMP timestamps come from
  the same clock as Pilot 2's own SEI time, so the unevenness is made on the RC, not in the
  network.
- Each picture comes as 2–3 video tags with the same timestamp: an SEI-only tag, the picture,
  often a second SEI-only tag. This explains the 66–73 video tags per second of the first
  field test (about 27–30 real pictures per second).
- Every 4–5 s a coded frame without any NAL unit (`27 01 000000 00000000`, one length field of
  0). The virtual camera app's FLV parser fails on it ("Ungültige NAL-Länge").

Measured locally (captures replayed with ffmpeg `-c copy` into the hub, Windows Chrome with
the D3D11 hardware decoder, 60 s each; the captures stay outside the repository):

| Timestamps        | Send timing       | Pictures shown/s | Dropped frames |
| ----------------- | ----------------- | ---------------- | -------------- |
| as sent by the RC | as sent by the RC | 17.4             | 653            |
| as sent by the RC | even              | 17.9             | 654            |
| even              | as sent by the RC | 25.2             | 102            |
| even              | even              | 27.4             | 3              |

Removing the SEI-only and empty tags alone changed nothing in Chrome. The timestamps are the
cause: when two pictures fall into one screen refresh, Chrome shows only the last one, so
about a third of the pictures are never shown and movement stutters.

## Decision

- **`NormalizedIngest`** (`src/server/ingest/normalized-ingest.ts`) wraps the real ingest for the
  delivery side only (`LiveHub`, so the GOP cache and every viewer). The registry, stream
  diagnostics and admin captures keep observing the stream exactly as sent.
- **`TimestampSmoother`**, per publisher session, tag by tag without lookahead (no added
  latency):
  - Pictures go on an even grid at the measured frame rate (mean of the last 60 picture
    intervals, 16–50 ms; 33.3 ms until 10 are known) and follow the RC's clock by 5 % of the
    deviation per picture. Pictures are never closer than half an interval.
  - A gap longer than 8 intervals is a real pause and keeps its length; more than 300 ms off the
    RC's clock starts again from it; a jump back is passed on as before. Output never goes
    backwards otherwise.
  - Non-picture tags (sequence header, SEI-only frames) get the time of the last picture.
  - With B-frames (composition time ≠ 0, never seen from Pilot 2) timestamps are only shifted by
    the current offset, so dts/pts order stays intact.
- **Coded frames without any NAL unit are dropped.** All other tags, SEI-only ones included,
  are forwarded byte for byte. A frame whose NAL structure cannot be read counts as a picture.
- At unpublish the service logs `timestamp smoothing summary` with dropped empty frames,
  restarts and the largest deviation.
- Simulator: profile `pilot2-real` gets synthetic `quirks` (±15 ms timestamp jitter, an SEI-only
  tag per picture with dummy content, an empty frame every 4.5 s) in inline mode. No content of
  real captures goes into the repository (GPS positions, serial numbers, pictures).

## Consequences

- Same captures, smoothed timestamps, send timing as recorded: **16.9 → 24.8** pictures shown
  per second and **582 → 97** dropped frames per minute (capture with a camera switch:
  15.2 → 21.0/s). Output stayed within 35–145 ms (p95) of the RC's clock, at most 240 ms.
- The remaining drops come from data arriving in bursts; only a larger player buffer (more
  latency) would absorb them. Not changed.
- Recordings in the browser (ADR 0011) get the even timestamps too.
- The `pilot2-real` scenario test asserts that viewers get no timestamps closer than 10 ms and
  no empty frames, while diagnostics still count the empty frames as malformed.
- Measured in Chrome on Windows only; iPad (Managed Media Source) and Android are listed in
  `docs/manual-test.md`.
