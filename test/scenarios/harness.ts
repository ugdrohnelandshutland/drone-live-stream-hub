import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createService, type Service, type ServiceOptions } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import { createLogger, type Logger } from "../../src/server/logger.js";
import type { DroneStatus } from "../../src/shared/api.js";
import { findFontFile, simulatorSkipReason } from "../../src/sim/ffmpeg.js";
import {
  ScenarioRunner,
  parseScenario,
  scenarioDurationMs,
  type ScenarioEvent,
} from "../../src/sim/scenarios.js";
import { ReconnectingViewer } from "../../src/sim/viewer-client.js";
import { SseClient } from "../helpers/sse.js";

export const skipReason = await simulatorSkipReason();
export const fontFile = (await findFontFile()) ?? "";
if (skipReason) console.warn(`Skipping scenario tests: ${skipReason}`);

export const CONFIG: AppConfig = {
  rtmpPort: 1935,
  httpPort: 8080,
  drones: [
    { id: "m30t-01", name: "Drohne 1" },
    { id: "m30t-02", name: "Drohne 2" },
    { id: "m30t-03", name: "Drohne 3" },
  ],
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function heapUsedAfterGc(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  return process.memoryUsage().heapUsed;
}

export interface ScenarioResult {
  events: ScenarioEvent[];
  viewers: Map<string, ReconnectingViewer>;
  /** Whether each viewer had a picture when the scenario ended. */
  playingAtEnd: Map<string, boolean>;
  /** drone-updated events per drone, in order. */
  updates: Map<string, DroneStatus[]>;
  /** Heap after GC at the first and last sample, and the maximum of all samples. */
  heap: { first: number; last: number; max: number };
  maxCacheBytes: number;
  /** Registry state shortly before the end (before the drones are stopped). */
  final: DroneStatus[];
  service: Service;
  logger: Logger;
}

export interface RunOptions {
  /** Scenario JSON (short version). */
  scenario: unknown;
  /** Headless viewers per drone id. */
  viewersPerDrone?: Record<string, number>;
  service?: ServiceOptions;
  /** Inspect state while the scenario runs (e.g. at a given time). */
  during?: (ctx: { service: Service; viewers: Map<string, ReconnectingViewer> }) => Promise<void>;
}

/**
 * Starts a service on random ports, plays the scenario, watches it with reconnecting
 * headless viewers and an SSE client, samples memory, and stops everything.
 */
export async function runScenario(options: RunOptions): Promise<ScenarioResult> {
  const logger = createLogger({ name: "scenario", level: process.env["LOG_LEVEL"] ?? "silent" });
  const scenario = parseScenario(options.scenario);
  const service = createService(CONFIG, logger, {
    rtmpPort: 0,
    httpPort: 0,
    host: "127.0.0.1",
    staticDir: await mkdtemp(path.join(os.tmpdir(), "dlsh-web-")),
    probeIntervalMs: 0,
    ...options.service,
  });
  await service.start();
  const base = `127.0.0.1:${service.httpPort}`;
  const sse = new SseClient(`http://${base}/api/events`);
  const viewers = new Map<string, ReconnectingViewer>();
  for (const [droneId, count] of Object.entries(options.viewersPerDrone ?? {})) {
    for (let i = 0; i < count; i++) {
      viewers.set(`${droneId}#${i}`, new ReconnectingViewer({ baseUrl: `ws://${base}`, droneId }).start());
    }
  }

  const runner = new ScenarioRunner({
    scenario,
    host: "127.0.0.1",
    port: service.rtmpPort,
    fontFile: fontFile ?? "",
    logger,
  });
  const events: ScenarioEvent[] = [];
  runner.on("event", (e: ScenarioEvent) => events.push(e));

  const heapSamples: number[] = [];
  const playingAtEnd = new Map<string, boolean>();
  let final: DroneStatus[] = [];
  let maxCacheBytes = 0;
  const sampler = setInterval(() => {
    heapSamples.push(heapUsedAfterGc());
    for (const stats of Object.values(service.hub.stats()))
      maxCacheBytes = Math.max(maxCacheBytes, stats.cacheBytes);
  }, 2000);

  try {
    const during = options.during?.({ service, viewers });
    const finishing = new Promise<void>((resolve) =>
      runner.on("event", (e: ScenarioEvent) => {
        if (e.action === "finished") resolve();
      }),
    );
    // Capture viewer state just before the runner stops the drones.
    const total = scenarioDurationMs(scenario);
    // Freeze the observed end state before the runner tears the drones down.
    const snapshotTimer = setTimeout(() => {
      for (const [key, viewer] of viewers) {
        playingAtEnd.set(key, viewer.playing);
        viewer.stop();
      }
      final = service.registry.list();
    }, total - 200);
    await runner.run();
    clearTimeout(snapshotTimer);
    await finishing;
    await during;
    heapSamples.push(heapUsedAfterGc());
  } finally {
    clearInterval(sampler);
    for (const viewer of viewers.values()) viewer.stop();
    sse.close();
    await runner.stop();
  }
  await service.stop();

  const updates = new Map<string, DroneStatus[]>();
  for (const event of sse.events) {
    if (event.event !== "drone-updated") continue;
    const status = JSON.parse(event.data) as DroneStatus;
    updates.set(status.id, [...(updates.get(status.id) ?? []), status]);
  }
  // Skip the first sample: ffmpeg/WebSocket warm-up allocations.
  const steady = heapSamples.slice(1);
  return {
    events,
    viewers,
    playingAtEnd,
    updates,
    heap: { first: steady[0] ?? 0, last: steady.at(-1) ?? 0, max: Math.max(0, ...steady) },
    maxCacheBytes,
    final,
    service,
    logger,
  };
}

/**
 * State changes of a drone from its first "live" on (earlier updates are viewer-count
 * changes while it was still offline).
 */
export function stateChanges(updates: DroneStatus[] | undefined): string[] {
  const states = (updates ?? []).map((u) => u.state);
  const first = states.indexOf("live");
  return first < 0 ? [] : transitions(states.slice(first));
}

/** Distinct values in order, without consecutive repeats. */
export function transitions<T>(values: T[]): T[] {
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
}

export function closeCodes(viewer: ReconnectingViewer | undefined): number[] {
  return viewer?.metrics.closes.map((c) => c.code) ?? [];
}
