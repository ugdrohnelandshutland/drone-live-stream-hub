# 0008 – Installed Node.js 24 instead of a bundled runtime

- Status: accepted
- Date: 2026-10-11
- Decided by: product owner
- Supersedes: "Runtime: the official portable `node.exe`" in ADR 0004

## Context

Up to 0.4.0 the Windows package shipped a portable `node.exe` (Node.js 22.23.3): 84 of the
86 MB unpacked, 34 MB zipped, while the service itself is about 1 MB. Node.js 22 is in
maintenance and reaches end of life on 2027-04-30; Node.js 24 is the active LTS (until
2028-04-30).

## Decision

- **Node.js 24 LTS is a prerequisite** on the field PC, installed with the official Windows
  Installer into `C:\Program Files\nodejs`. The package no longer contains Node.js; the ZIP is
  about 2 MB.
- **Development, CI and Docker use Node.js 24** as well (`.nvmrc`, `engines: ^24.21.0`,
  `node:24-trixie` images), so tests run on the major the field PC has.
- **`install-windows.ps1` checks the runtime:** it takes `C:\Program Files\nodejs\node.exe`,
  else `node.exe` on PATH (or `-NodePath`), and stops with download advice if Node.js is
  missing, not 24.x, or inside a user profile (the `LocalService` account cannot read it,
  e.g. nvm-windows). The service and the firewall rules point to that `node.exe`. An update
  removes the `node\` folder of older packages.
- **The service logs a warning** at startup on a different major version and keeps running.
- **The packaging script runs on Node.js 24 only**, so its smoke test uses the same major.

## Consequences

- Smaller package; Node.js security updates come from the Node.js installer and need no new
  release of ours.
- The Node.js version on the field PC is no longer pinned by us. Any 24.x is accepted; a new
  major (26) is rejected by the installer and warned about by the service until a release
  supports it.
- The firewall rules allow the shared `node.exe`, so any Node.js program on the field PC may
  listen on the RTMP and HTTP ports, not only this service. Acceptable on a dedicated field PC.
- Installing on a new PC needs a second file (the Node.js `.msi`) and one more step.
- `THIRD-PARTY-NOTICES.txt` no longer lists Node.js: we do not distribute it.
