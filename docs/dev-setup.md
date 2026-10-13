# Development setup

## Requirements

- Node.js 24 LTS (`.nvmrc`; the Windows package is tested with the same major)
- ffmpeg **≥ 6.0** (tested with 8.1) — development and tests only, never needed by the service.
  The simulator looks for `ffmpeg` on PATH, or uses `FFMPEG_PATH` if set, and warns if the
  version is older than 6.
- A TrueType font for the overlay. Found automatically on Windows (Consolas/Arial), Linux
  (DejaVu/Liberation) and macOS (Menlo/Arial); otherwise set `SIM_FONT=/path/to/font.ttf`.

## Installing ffmpeg

| Platform | Recommended                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `winget install Gyan.FFmpeg`, or unpack a release build from https://www.gyan.dev/ffmpeg/builds/ or https://github.com/BtbN/FFmpeg-Builds/releases and add its `bin` folder to PATH.                                                                                                                                                              |
| Linux    | Distribution packages are often too old (Ubuntu 22.04 ships 4.4). Use a static build from https://github.com/BtbN/FFmpeg-Builds/releases (`ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz`), unpack it e.g. to `~/.local/opt/` and link `bin/ffmpeg` into `~/.local/bin/` (no root needed). Ubuntu ≥ 24.04 / Debian 13 packages (ffmpeg 6/7) are fine. |
| macOS    | `brew install ffmpeg`                                                                                                                                                                                                                                                                                                                             |

Check: `ffmpeg -version` should print version 6 or newer.

## First run

```sh
npm install
cp config/drones.example.json config/drones.json
npm run dev                   # service + web UI dev server
npm run sim -- --drones 1     # one simulated drone
```
