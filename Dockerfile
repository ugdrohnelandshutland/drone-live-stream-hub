# Two images from one build:
#   hub  - the service (bundled server + web UI, no ffmpeg, no node_modules), as in the field
#   sim  - simulated drones (ffmpeg 8.1) for demos and tests
# Usage: see docs/docker.md (docker compose up -d --build).

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# No .git in the build context: pass the commit for the release info (footer, /api/info).
ARG DLSH_COMMIT=""
ENV DLSH_COMMIT=${DLSH_COMMIT}
RUN npm run build && npm run bundle

FROM node:24-trixie-slim AS hub
WORKDIR /app
COPY --from=build /app/dist/bundle/ ./
COPY config/drones.example.json config/drones.example.json
COPY config/drones.example.json config/drones.json
ENV NODE_ENV=production
USER node
EXPOSE 8080 1935
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.mjs", "--config", "/app/config/drones.json"]

FROM node:24-trixie-slim AS sim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils fonts-dejavu-core tzdata \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/ci/install-ffmpeg.sh /usr/local/bin/install-ffmpeg.sh
RUN FFMPEG_DIR=/opt/ffmpeg install-ffmpeg.sh && ln -s /opt/ffmpeg/ffmpeg-*/bin/ffmpeg /usr/local/bin/ffmpeg
WORKDIR /app
COPY --from=build /app ./
USER node
CMD ["npx", "tsx", "src/sim/cli.ts", "--host", "hub", "--drones", "3"]
