# 0004 – Windows service and packaging

- Status: accepted; the runtime decision is superseded by ADR 0008 (installed Node.js 24)
- Date: 2026-10-10

## Context

The service runs on a Windows field PC without internet access. It must start at boot without
anyone logging in, recover from crashes, write logs with rotation, need no admin rights at
runtime, and be installable by a non-developer. CLAUDE.md §8 asks to evaluate `node-windows`
and a Node.js Single Executable Application (SEA) with a service wrapper.

`node.exe` cannot be registered as a service directly: a service process must talk to the
Service Control Manager (SCM). Something has to sit in between.

## Options

| Option             | License       | Maintenance (Oct 2026)                                              | Notes                                                                                                                                                                                                  |
| ------------------ | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **node-windows**   | MIT           | last release 1.0.0-beta.8 (2024), still beta                        | Generates a WinSW config at install time from a Node script, adds its own restart wrapper in Node. Two layers, and installing needs npm/Node logic on the target.                                      |
| **WinSW** (direct) | MIT           | v2.12.0 (Jan 2023) is the last stable; v3 has been alpha since 2020 | Proven, XML config, log rotation. .NET Framework build or a 17 MB self-contained build. No stable release in almost 4 years.                                                                           |
| **NSSM**           | Public domain | last release 2.24 (2014), pre-release 2017                          | Widely used, but unmaintained and often flagged by antivirus software.                                                                                                                                 |
| **shawl**          | MIT           | v1.9.0 (May 2026), active                                           | Rust, single 1.3 MB exe, no runtime. Registered with plain `sc`/`New-Service`; no install step of its own. Sends Ctrl+C on stop, restarts on non-zero exit, log files with rotation, `--cwd`, `--env`. |
| **SEA**            | (Node.js)     | experimental in Node 22                                             | Replaces `node.exe` + script with one exe, but still needs a service wrapper. CommonJS only in Node 22, needs `postject`. Adds build complexity, solves nothing the folder layout does not.            |

## Decision

- **Service wrapper: shawl 1.9.0**, bundled as `shawl\shawl.exe`. The service is registered
  by `install-windows.ps1` with `New-Service`/`Win32_Service.Change`:
  `shawl.exe run --name DroneLiveStreamHub --cwd <dir> --stop-timeout 10000 --restart-delay 2000
--restart-if-not 0,2 --log-dir <dir>\logs --log-as wrapper --log-cmd-as service
--log-rotate bytes=10485760 --log-retain 9 -- node.exe app\server.mjs --config config\drones.json`.
- **Runtime: the official portable `node.exe`** (Node.js 22 LTS, pinned in
  `scripts/package-windows.ts`, verified against the release's `SHASUMS256.txt`). No Node.js
  installation on the field PC; updating Node means bumping the pin and building a new package.
- **Server: bundled into one file** (`app\server.mjs`) with rolldown (already used by Vite).
  The package has no `node_modules`, so unused dependencies of node-media-server (Express, JWT,
  ...) are not shipped. The bundle is platform independent; packaging works on Linux, macOS and
  Windows. The packaging script smoke-tests the bundle (`/healthz`, `/api/drones`, web UI).
- **Logs: written by the wrapper.** The service logs JSON lines to stdout as before (console when
  run by hand). shawl writes them to `logs\service_rCURRENT.log`, rotated at 10 MB, 9 old files
  kept (≤ 100 MB), and its own start/stop/restart messages to `logs\wrapper_rCURRENT.log`. This
  also captures crash output that happens before or outside the logger, and keeps synchronous
  file I/O out of the service.
- **Account: `NT AUTHORITY\LocalService`.** It may read the install directory and write only
  `logs\`. Windows has no privileged ports, so 1935/8080 need no extra rights.
- **Restarts:** shawl restarts node.exe after any non-zero exit except **2 (configuration
  error)**: retrying cannot fix a broken `drones.json`, and a stopped service with a clear log
  line is easier to diagnose than a restart loop. Windows recovery actions restart the wrapper
  itself if it dies.
- **Install location:** `C:\Program Files\DroneLiveStreamHub` by default. Not a folder that
  normal users can write to, because the service executes files from it.
- **Firewall:** inbound TCP rules for the configured RTMP and HTTP ports, **private profile
  only**, restricted to the bundled `node.exe`. The installer warns about networks classified as
  public instead of changing them.
- **Distribution:** one ZIP (~34 MB) with `install.cmd` (double-click, asks for elevation).
  The ZIP is written by a small own writer (`scripts/lib/zip.ts`) so packaging needs no external
  tools.

## Consequences

- A Node.js security update requires a new package (bump `NODE_VERSION`). The field PC is
  offline, so this is a deliberate, manual step anyway.
- shawl has a smaller user base than WinSW. Its interface to us is small (command line, Ctrl+C,
  exit codes); switching to WinSW later only touches `install-windows.ps1` and the packaging
  script.
- Changing ports in `drones.json` requires running the installer again (firewall rules).
- Installing the service and the firewall rules needs administrator rights once; nothing at
  runtime does.
