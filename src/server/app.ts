import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceInfo } from "../shared/api.js";
import type { DiagnosticsResponse } from "../shared/diagnostics.js";
import { loadBuildInfo } from "./build-info.js";
import type { AppConfig } from "./config.js";
import { Api } from "./delivery/api.js";
import { DeliveryServer } from "./delivery/http-server.js";
import { LiveHub } from "./delivery/live-hub.js";
import { NmsIngestAdapter } from "./ingest/nms-adapter.js";
import { StreamDiagnostics } from "./diagnostics/stream-diagnostics.js";
import type { Logger } from "./logger.js";
import { DroneRegistry } from "./registry/registry.js";

/** Tunables with defaults; tests and the scenario runner override them. */
export interface ServiceOptions {
  /** Overrides config ports (0 = random, for tests). */
  rtmpPort?: number;
  httpPort?: number;
  host?: string;
  staticDir?: string;
  ingestIdleTimeoutMs?: number;
  maxGopBytes?: number;
  softBufferBytes?: number;
  hardBufferBytes?: number;
  maxCongestionMs?: number;
  /** Release information (default: baked in by the package build, or package.json + git). */
  info?: ServiceInfo;
  /** Periodic per-stream stats in the log (fps, kbit/s, keyframe interval); 0 disables the log line. */
  probeIntervalMs?: number;
}

export const RTMP_APP_NAME = "live";

/**
 * `web/` next to the bundled server (Windows package), otherwise <repo>/dist/web, both
 * from src/server (tsx) and dist/server (built). Checked once at startup.
 */
function defaultStaticDir(): string {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.join(serverDir, "web");
  if (existsSync(path.join(packaged, "index.html"))) return packaged;
  return path.resolve(serverDir, "..", "..", "dist", "web");
}

export interface Service {
  readonly info: ServiceInfo;
  readonly rtmpPort: number;
  readonly httpPort: number;
  readonly hub: LiveHub;
  readonly registry: DroneRegistry;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Composition root: wires ingest → live hub → delivery. */
export function createService(config: AppConfig, logger: Logger, options: ServiceOptions = {}): Service {
  const startedAt = Date.now();
  const info = options.info ?? loadBuildInfo();
  const ingest = new NmsIngestAdapter({
    port: options.rtmpPort ?? config.rtmpPort,
    ...(options.host !== undefined ? { host: options.host } : {}),
    appName: RTMP_APP_NAME,
    idleTimeoutMs: options.ingestIdleTimeoutMs ?? 10_000,
    logger: logger.child({ module: "ingest" }),
  });

  // Registered first: rejects unknown stream keys before any observer sees the session.
  const registry = new DroneRegistry(config.drones, logger.child({ module: "registry" }));
  registry.attach(ingest);

  const hub = new LiveHub(
    config.drones.map((d) => d.id),
    ingest,
    {
      maxGopBytes: options.maxGopBytes ?? 16 * 1024 * 1024,
      softBufferBytes: options.softBufferBytes ?? 1024 * 1024,
      hardBufferBytes: options.hardBufferBytes ?? 8 * 1024 * 1024,
      maxCongestionMs: options.maxCongestionMs ?? 10_000,
    },
    logger.child({ module: "delivery" }),
    (droneId, count) => registry.setViewerCount(droneId, count),
  );
  // Observes accepted publishers (registered after the registry) for GET /api/diagnostics
  // and the per-stream log lines.
  const diagnostics = new StreamDiagnostics({
    ingest,
    registry,
    logger: logger.child({ module: "probe" }),
    summaryIntervalMs: options.probeIntervalMs ?? 30_000,
  });
  const diagnosticsReport = (): DiagnosticsResponse => {
    const delivery = hub.stats();
    return {
      generatedAt: new Date().toISOString(),
      service: { ...info, uptimeSec: Math.round((Date.now() - startedAt) / 1000) },
      drones: registry.list().map((drone) => {
        const stream = diagnostics.snapshot(drone.id);
        const channel = delivery[drone.id];
        return {
          id: drone.id,
          name: drone.name,
          live: drone.state === "live",
          publisher: stream?.publisher ?? null,
          metadata: stream?.metadata ?? null,
          video: stream?.video ?? null,
          measurements: stream?.measurements ?? null,
          totals: stream?.totals ?? null,
          delivery: channel
            ? {
                viewers: channel.viewers,
                droppedTags: channel.droppedTags,
                slowViewerClosures: channel.slowViewerClosures,
                cacheBytes: channel.cacheBytes,
              }
            : null,
          events: stream?.events ?? [],
        };
      }),
      rejected: diagnostics.rejectedPublishes(),
    };
  };
  const api = new Api({
    registry,
    info,
    diagnostics: diagnosticsReport,
    logger: logger.child({ module: "api" }),
  });

  const delivery: DeliveryServer = new DeliveryServer({
    port: options.httpPort ?? config.httpPort,
    ...(options.host !== undefined ? { host: options.host } : {}),
    staticDir: options.staticDir ?? defaultStaticDir(),
    hub,
    api,
    logger: logger.child({ module: "http" }),
    health: (): object => {
      const memory = process.memoryUsage();
      return {
        status: "ok",
        version: info,
        time: Date.now(),
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        memory: { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
        cpu: process.cpuUsage(),
        viewers: delivery.viewerCount,
        sseClients: api.sseClientCount,
        drones: hub.stats(),
      };
    },
  });

  return {
    info,
    get rtmpPort() {
      return ingest.port;
    },
    get httpPort() {
      return delivery.port;
    },
    hub,
    registry,
    async start() {
      await ingest.start();
      await delivery.start();
      diagnostics.start();
    },
    async stop() {
      diagnostics.stop();
      await ingest.stop();
      await delivery.stop();
    },
  };
}
