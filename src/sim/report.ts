import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../server/logger.js";
import type { ScenarioEvent } from "./scenarios.js";
import { ReconnectingViewer, type ViewerMetrics } from "./viewer-client.js";

interface HealthSample {
  atSec: number;
  rssMb: number;
  heapUsedMb: number;
  viewers: number;
  live: string[];
  cacheBytes: number;
}

export interface ScenarioReport {
  scenario: string;
  startedAt: string;
  durationSec: number;
  actions: ScenarioEvent[];
  health: HealthSample[];
  memory: { rssStartMb: number; rssEndMb: number; rssMaxMb: number; heapStartMb: number; heapEndMb: number };
  viewers: Record<string, ViewerMetrics & { playingAtEnd: boolean }>;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Watches a running service during a scenario (`npm run sim -- --scenario … --report`):
 * one reconnecting headless viewer per drone and /healthz samples every 10 s.
 */
export class ScenarioReporter {
  private readonly viewers = new Map<string, ReconnectingViewer>();
  private readonly health: HealthSample[] = [];
  private readonly actions: ScenarioEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private readonly startedAt = Date.now();
  private playingAtEnd: Map<string, boolean> | undefined;

  constructor(
    private readonly httpBase: string,
    private readonly droneIds: string[],
    private readonly logger: Logger,
  ) {}

  start(): void {
    for (const id of this.droneIds) {
      this.viewers.set(
        id,
        new ReconnectingViewer({ baseUrl: this.httpBase.replace(/^http/, "ws"), droneId: id }).start(),
      );
    }
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 10_000);
  }

  /** Call shortly before the scenario stops its drones: freezes "playing at end". */
  markEnd(): void {
    this.playingAtEnd = new Map([...this.viewers].map(([id, viewer]) => [id, viewer.playing]));
    // Stop watching now, so the teardown of the drones does not count as an outage.
    for (const viewer of this.viewers.values()) viewer.stop();
  }

  recordAction(event: ScenarioEvent): void {
    this.actions.push(event);
  }

  private async sample(): Promise<void> {
    try {
      const res = await fetch(`${this.httpBase}/healthz`);
      const body = (await res.json()) as {
        memory: { rss: number; heapUsed: number };
        viewers: number;
        drones: Record<string, { live: boolean; cacheBytes: number }>;
      };
      this.health.push({
        atSec: Math.round((Date.now() - this.startedAt) / 1000),
        rssMb: mb(body.memory.rss),
        heapUsedMb: mb(body.memory.heapUsed),
        viewers: body.viewers,
        live: Object.entries(body.drones)
          .filter(([, d]) => d.live)
          .map(([id]) => id),
        cacheBytes: Object.values(body.drones).reduce((sum, d) => sum + d.cacheBytes, 0),
      });
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, "health sample failed");
    }
  }

  /** Stops watching and writes the report; returns its path. */
  async finish(scenario: string, dir: string): Promise<{ file: string; report: ScenarioReport }> {
    clearInterval(this.timer);
    await this.sample();
    const viewers: ScenarioReport["viewers"] = {};
    for (const [id, viewer] of this.viewers) {
      viewers[id] = { ...viewer.metrics, playingAtEnd: this.playingAtEnd?.get(id) ?? viewer.playing };
      viewer.stop();
    }
    const steady = this.health.slice(1);
    const report: ScenarioReport = {
      scenario,
      startedAt: new Date(this.startedAt).toISOString(),
      durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      actions: this.actions,
      health: this.health,
      memory: {
        rssStartMb: steady[0]?.rssMb ?? 0,
        rssEndMb: steady.at(-1)?.rssMb ?? 0,
        rssMaxMb: Math.max(0, ...steady.map((h) => h.rssMb)),
        heapStartMb: steady[0]?.heapUsedMb ?? 0,
        heapEndMb: steady.at(-1)?.heapUsedMb ?? 0,
      },
      viewers,
    };
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    return { file, report };
  }
}

/** Human-readable summary table for the console. */
export function summarize(report: ScenarioReport): string {
  const rows = Object.entries(report.viewers).map(([id, m]) => {
    const codes = m.closes.reduce<Record<number, number>>(
      (acc, c) => ({ ...acc, [c.code]: (acc[c.code] ?? 0) + 1 }),
      {},
    );
    return [
      id.padEnd(10),
      String(m.connects).padStart(8),
      JSON.stringify(codes).padEnd(28),
      String(m.stalls.length).padStart(6),
      String(m.maxGapMs).padStart(9),
      String(m.timestampRegressions).padStart(5),
      m.playingAtEnd ? "yes" : "NO",
    ].join("  ");
  });
  return [
    `Scenario ${report.scenario}: ${report.durationSec} s, ${report.actions.length} actions`,
    `Service memory: RSS ${report.memory.rssStartMb} → ${report.memory.rssEndMb} MB (max ${report.memory.rssMaxMb}), heap ${report.memory.heapStartMb} → ${report.memory.heapEndMb} MB`,
    "",
    "drone       connects  close codes                   stalls  max gap  ts↓  playing at end",
    ...rows,
  ].join("\n");
}
