# Docker: demo and test hosting

Runs the service and three simulated drones on any Docker host, e.g. to show the web UI to
people without a field setup. The production target remains the Windows field PC
(`docs/windows-install.md`); this is for demos and tests.

## Images

One `Dockerfile`, two targets:

| Target | Contents                                                                       | Size    |
| ------ | ------------------------------------------------------------------------------ | ------- |
| `hub`  | the bundled service + web UI (same artifact as the Windows package), no ffmpeg | ~330 MB |
| `sim`  | the simulator with the static ffmpeg 8.1 build                                 | ~1.3 GB |

## Start

```sh
DLSH_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build
```

Open `http://<docker host>:18080/`. `DLSH_COMMIT` only feeds the release line in the footer;
without it the commit shows as unknown.

Settings (environment variables or an `.env` file next to `compose.yaml`):

| Variable          | Default         | Meaning                                                                   |
| ----------------- | --------------- | ------------------------------------------------------------------------- |
| `DLSH_HTTP_PORT`  | `18080`         | Host port for the web UI and video (container port stays 8080)            |
| `DLSH_RTMP_PORT`  | `1935`          | Host port for RTMP, only if the port line in `compose.yaml` is enabled    |
| `DLSH_SIM_DRONES` | `3`             | Number of simulated drones (ids `m30t-01`…; the example config has three) |
| `TZ`              | `Europe/Berlin` | Clock in the simulated video overlay                                      |
| `DLSH_ADMIN_PIN`  | (empty)         | PIN for the admin page `/admin` (4–12 digits); empty keeps it off         |

The simulator streams 720p at 1.5 Mbit/s per drone and switches the camera every 30 s. The
overview plays all drones at once, so each viewer needs about drones × 1.5 Mbit/s;
`?previews=0` turns the previews off. The simulator needs 2–3 CPU cores for three drones; the
service itself needs very little.

The admin page (ADR 0012) keeps device names in `/app/data`; mount a volume there
(`- dlsh-data:/app/data`) to keep them when the container is recreated.

Own drone list: enable the `volumes` lines under `hub` in `compose.yaml` and put a
`config/drones.json` next to it. Real RC Plus: enable the RTMP port line.

Stop: `docker compose down`.

## Behind Nginx Proxy Manager

The web UI has **no login**. On a reachable host, put it behind NPM with an access list.

1. Attach the service to NPM's Docker network (find its name with `docker network ls`; the
   default assumed here is `npm_default`):
   ```sh
   DLSH_PROXY_NETWORK=npm_default DLSH_COMMIT=$(git rev-parse --short HEAD) \
     docker compose -f compose.yaml -f compose.proxy.yaml up -d --build
   ```
   The host port is then optional; NPM reaches the service as `dlsh-hub:8080`.
2. In NPM, add a **Proxy Host**:
   - Domain: e.g. `drohnen.example.de`
   - Scheme `http`, Forward Hostname `dlsh-hub`, Forward Port `8080`
   - **Websockets Support: on** (the video runs over WebSocket)
   - Access List: one with a user/password (Basic Auth). Browsers send the credentials on
     the WebSocket and SSE requests of the page too.
   - SSL tab: certificate as usual, "Force SSL" on. The player switches to `wss://`
     automatically.
3. No custom nginx configuration is needed: the live list (`/api/events`) sends
   `X-Accel-Buffering: no`, so nginx does not buffer it, and WebSocket connections are passed
   through unbuffered. Both send a heartbeat every 15 s, well within nginx's default 60 s read
   timeout.

### NPM on another host

Skip `compose.proxy.yaml`; in NPM forward to `http://<Docker host IP>:<DLSH_HTTP_PORT>`
(Websockets Support on, access list as above). The port is then also reachable directly,
bypassing the access list: bind it to one address with
`DLSH_HTTP_PORT=<internal IP>:18080`, or allow it only from the NPM host in the firewall.

## Portainer

Stacks → Add stack → Repository: URL of this repository, reference `refs/heads/main`, compose
path `compose.yaml`, no authentication needed for the public repository. Set the variables above under
"Environment variables". Portainer builds both images on the target host (needs access to
the Git server, npm and GitHub for ffmpeg). GitOps updates (polling or webhook) rebuild after
each push.
