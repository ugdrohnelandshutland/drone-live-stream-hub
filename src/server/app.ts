import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminLoad } from "../shared/admin.js";
import type { DroneState, ServiceInfo } from "../shared/api.js";
import type { DiagnosticsResponse } from "../shared/diagnostics.js";
import { AdminApi } from "./admin/admin-api.js";
import { AdminAuth } from "./admin/admin-auth.js";
import { EventLog } from "./admin/event-log.js";
import { loadBuildInfo } from "./build-info.js";
import { FileClientNames, MemoryClientNames } from "./clients/client-names.js";
import { ClientRegistry } from "./clients/client-registry.js";
import type { AppConfig } from "./config.js";
import { Api } from "./delivery/api.js";
import { DeliveryServer } from "./delivery/http-server.js";
import { LiveHub } from "./delivery/live-hub.js";
import { NmsIngestAdapter } from "./ingest/nms-adapter.js";
import { StreamCapture } from "./diagnostics/stream-capture.js";
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
  /**
   * Device names are kept in `<dataDir>/clients.json`, raw stream captures in
   * `<dataDir>/captures`; without it, names stay in memory and captures are off.
   */
  dataDir?: string;
}

export const RTMP_APP_NAME = "live";
/** How often the registry checks for publishers that stopped sending video. */
const STALL_CHECK_MS = 250;

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
  readonly clients: ClientRegistry;
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

  // Admin page (ADR 0012): devices, pausing, event log.
  const events = new EventLog();
  const names = options.dataDir
    ? new FileClientNames(options.dataDir, logger.child({ module: "clients" }))
    : new MemoryClientNames();
  const clients = new ClientRegistry({ names, onEvent: (event) => events.add(event) });
  const droneStates = new Map<string, DroneState>();
  registry.on("drone-updated", (status) => {
    const before = droneStates.get(status.id) ?? "offline";
    droneStates.set(status.id, status.state);
    if (status.state !== before) {
      events.add({ kind: status.state === "live" ? "drone-live" : "drone-offline", droneId: status.id });
    }
  });
  registry.on("publish-rejected", ({ streamKey, remoteAddress }) =>
    events.add({ kind: "publish-rejected", detail: streamKey, address: remoteAddress }),
  );

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
    (droneId, reason) => events.add({ kind: "stream-reset", droneId, detail: reason }),
  );
  // Observes accepted publishers (registered after the registry) for GET /api/diagnostics
  // and the per-stream log lines.
  const diagnostics = new StreamDiagnostics({
    ingest,
    registry,
    logger: logger.child({ module: "probe" }),
    summaryIntervalMs: options.probeIntervalMs ?? 30_000,
  });
  // Raw FLV captures for analysing real streams, started from the admin page.
  const captures = options.dataDir
    ? new StreamCapture({
        ingest,
        dir: path.join(options.dataDir, "captures"),
        logger: logger.child({ module: "capture" }),
      })
    : undefined;
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
    clients,
    logger: logger.child({ module: "api" }),
  });

  let cpuSample = { at: process.hrtime.bigint(), usage: process.cpuUsage(), percent: null as number | null };
  const cpuPercent = (): number | null => {
    const at = process.hrtime.bigint();
    const elapsedUs = Number(at - cpuSample.at) / 1000;
    // Polled every second by the page; shorter intervals give noisy values, reuse the last one.
    if (elapsedUs < 900_000) return cpuSample.percent;
    const used = process.cpuUsage(cpuSample.usage);
    cpuSample = {
      at,
      usage: process.cpuUsage(),
      percent: Math.round(((used.user + used.system) / elapsedUs) * 100),
    };
    return cpuSample.percent;
  };
  const adminLoad = (): AdminLoad => {
    const memory = process.memoryUsage();
    const delivery = hub.stats();
    const drones = registry.list().map((drone) => ({
      id: drone.id,
      name: drone.name,
      live: drone.state === "live",
      inKbps: drone.state === "live" ? (diagnostics.snapshot(drone.id)?.measurements?.kbps ?? null) : null,
      viewers: delivery[drone.id]?.viewers ?? 0,
    }));
    return {
      drones,
      outKbps: clients.outKbps(),
      viewers: drones.reduce((sum, d) => sum + d.viewers, 0),
      devices: clients.onlineCount,
      service: {
        version: info.version,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        cpuPercent: cpuPercent(),
      },
    };
  };
  const admin = new AdminApi({
    auth: config.adminPin !== undefined ? new AdminAuth({ pin: config.adminPin }) : undefined,
    clients,
    events,
    load: adminLoad,
    ...(captures ? { captures } : {}),
    logger: logger.child({ module: "admin" }),
  });

  const delivery: DeliveryServer = new DeliveryServer({
    port: options.httpPort ?? config.httpPort,
    ...(options.host !== undefined ? { host: options.host } : {}),
    staticDir: options.staticDir ?? defaultStaticDir(),
    hub,
    api,
    admin,
    clients,
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

  let stallWatch: NodeJS.Timeout | undefined;

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
    clients,
    async start() {
      if (names instanceof FileClientNames) await names.load();
      await captures?.start();
      await ingest.start();
      await delivery.start();
      diagnostics.start();
      stallWatch = setInterval(() => registry.checkStalls(), STALL_CHECK_MS);
    },
    async stop() {
      clearInterval(stallWatch);
      diagnostics.stop();
      await ingest.stop();
      await captures?.stop();
      await delivery.stop();
      clients.stop();
      if (names instanceof FileClientNames) await names.flush();
    },
  };
}
