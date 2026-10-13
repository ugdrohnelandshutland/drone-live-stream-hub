# ADR 0009: "Datensparen" — keyframe-only previews in the overview

- Status: accepted
- Date: 2026-10-12
- Decided by: product owner ("Datensparmodus in der Übersicht, initial aktiv, pro Gerät gespeichert")
- Amends: ADR 0007 (seamless switch only while "Datensparen" is off)

## Context

Each overview tile played the full stream: 2–8 Mbit/s per live drone, the same as the single
view, on every tablet in the field Wi-Fi. A low-resolution preview stream would need
transcoding (non-goal), and Pilot 2 pushes only one stream.

## Decision

- **Server:** `/ws/live/<id>?keyframes=1` makes the viewer a "keyframes" viewer
  (`LiveChannel`, `ViewerMode`). It gets FLV header, metadata, sequence header, and per GOP only
  the keyframe **and the frame right after it** — from the start snapshot and live. Nothing is
  transcoded or remuxed; timestamps stay as received. Close codes and backpressure are
  unchanged.
- **Why the follower frame:** mpegts.js' remuxer holds back the newest sample until the next
  one arrives, because it needs the next timestamp for the sample duration. With keyframes
  alone every picture would appear one keyframe interval late. The follower decodes against the
  keyframe sent just before it, so nothing is decoded against a missing reference.
- **Player:** `LivePlayer` mode `"keyframes"`: no `liveSync`, seek to just before the buffer end
  as soon as more than one frame is buffered (otherwise the follower, which now lasts a whole
  keyframe interval, would show the old picture), and stall limits of 6 s / 20 s instead of
  2 s / 8 s.
- **UI:** switch "Datensparen" in the wall header next to "Nur live". **On** until the device
  makes a choice, which is then stored (`dlsh.dataSaver`); `?datensparen=0|1` fixes it for one
  page without storing it. Hidden with `?previews=0`. The single view always gets the full
  stream, so a direct `/drone/<id>` (kiosk) is never affected.

## Consequences

- Measured with the simulator (1080p30, 6 Mbit/s, keyframe every 2 s), headless Windows Chrome:
  - Bandwidth per tile **6.1 → 0.3 Mbit/s (−95 %)**. The test pattern compresses unusually well
    between keyframes; with real footage the share of keyframes is larger, so expect less.
  - One new picture per keyframe interval (here every 2 s), sharp, with **~100–270 ms**
    latency at the moment it appears (median 122 ms) — the follower trick removes the extra
    interval. Before the jump the previous picture is presented for ~25 ms (not visible).
  - Camera switches (4001) recover as with the full stream; the status stays "Live".
- Tapping a tile with "Datensparen" on rebuilds the player on the same `<video>` with the full
  stream: first frame **~220 ms** after the tap, then the usual ~180 ms latency. Returning to the
  overview rebuilds it in keyframe mode. With "Datensparen" off, ADR 0007 applies unchanged.
- WebKit: verified by the product owner on an iPhone on 2026-10-12 (Managed Media Source with
  keyframes only works). iPad uses the same engine; still listed in `docs/manual-test.md`.
