# ADR 0011: Video recording in the browser

- Status: accepted
- Date: 2026-10-18
- Decided by: product owner (start/stop in the single view, download right after stop, in the
  browser and not part of the server, MP4, no authorisation)
- Amends: CLAUDE.md §1 non-goals (recording)

## Context

Users want to keep a piece of a drone's picture, like the still image, but as video. The
service forwards FLV unchanged and must not transcode. A recording on the field PC would
survive a locked tablet, but the product owner wants it on the device that presses the
button, with no files or storage management on the server.

## Decision

- **Recorded from the stream the player already receives.** `LivePlayer` reports every
  WebSocket event of its current socket (`onStreamEvent`: open, data, close code).
  `StreamRecorder` (`src/web/recording/`, framework-free) reads the FLV tags along and writes
  the H.264 samples unchanged into MP4. No second connection, no extra load on server or Wi-Fi,
  no re-encoding (MediaRecorder would re-encode: lower quality, hot tablets, unreliable on
  iPad).
- **Plain MP4** (ftyp, moov in front, mdat; one chunk per GOP), own writer
  (`mp4-writer.ts`). The file is built only at stop, so fragmented MP4's crash safety buys
  nothing, while some players show no duration or cannot seek in fragmented files. The FLV
  timestamps are kept as the time base (1 ms).
- **Parts.** A file always starts at a keyframe. A new part (and download) when
  - the sequence header changes (camera switch: other resolution — many players mishandle a
    size change inside one file),
  - a part reaches 10 minutes or 512 MB (memory on tablets: the recording lives in the
    browser until it is downloaded), split at the next keyframe so no frame is lost.
    Names: `<start>_<droneId>.mp4`, then `…_teil2.mp4`, `…_teil3.mp4` (start of the recording).
- **Interruptions.**
  - Socket lost and reopened (Wi-Fi, stall restart): the server repeats its cached GOP; frames
    up to the last recorded timestamp are skipped. If frames are missing, recording resumes at
    the next keyframe.
  - Drone offline / publisher replaced (close 4000/4001): timestamps start anew; the file
    continues if the decoder config is unchanged.
  - A gap or a jump back in the timestamps gives the frame before it a normal frame duration:
    the video cuts instead of showing a frozen picture.
  - H.265 (sequence header not AVC): recording refused with a message; a stream that changes
    to H.265 while recording ends the recording, the part so far is kept.
- **Lifecycle.** The recording ends and the last part is downloaded on "Aufnahme beenden",
  when the page becomes hidden (screen locked, other app or tab — the device may suspend the
  page at any moment then), when going back to the overview, and on unmount.
- **UI.** Button "Aufnahme" / "Aufnahme beenden" next to "Standbild" in the single view only
  (always the full stream; data-saver tiles get keyframes only). Not in kiosk mode (no file
  handling there, as for the still image). A badge on the picture: "REC 03:12 · 180 MB"
  (time of all parts, size of the current part), "REC – warte auf Bild" until the first
  keyframe. Only this device shows it; there is no server state.
- **No authorisation** (product owner); nothing on the server changes.

## Consequences

- `src/shared/flv/video.ts` and `avc.ts` moved from `src/server/flv/` and work on
  `Uint8Array`, so server and browser share the FLV and SPS parsing.
- Memory: up to one part in the browser (2–8 Mbit/s → 15–60 MB per minute, at most 512 MB).
  Chrome keeps large blobs on disk; the finished chunks are held as `Blob`s for that reason.
- If the server drops frames for a slow viewer (backpressure), the recording has the same
  short artefacts as the picture until the next keyframe.
- Tests: `test/web/stream-recorder.test.ts` (start at keyframe, parts, reconnect, cuts,
  limits, H.265), `test/web/recording-ffmpeg.test.ts` (real H.264 from ffmpeg → MP4, checked
  with ffprobe and a full decode). Checked in headless Chrome against the simulator with
  `--switch-every 8`: four parts (1080p, 720p, 640×512, 1080p), 30 fps, all decode without
  errors.
- Open: playback on iPad (Dateien app) and Android, and the download behaviour on iPadOS
  (confirmation per file) — `docs/manual-test.md`.
