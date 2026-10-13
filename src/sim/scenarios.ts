import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { z } from "zod";
import type { Logger } from "../server/logger.js";
import { ChaosProxy } from "./chaos-proxy.js";
import { SimulatedDrone } from "./drone.js";
import { CAMERA_MODES, PROFILES, colourForIndex } from "./profiles.js";

// --- format ---------------------------------------------------------------

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** "250ms", "5s", "1.5m", "2h" → milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text.trim());
  if (!match?.[1] || !match[2]) throw new Error(`invalid duration "${text}" (use e.g. 500ms, 5s, 2m)`);
  return Math.round(Number(match[1]) * (UNITS[match[2]] ?? 0));
}

const duration = z.string().transform((text, ctx) => {
  try {
    return parseDuration(text);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});
const camera = z.enum(CAMERA_MODES);
const target = z.string().min(1); // drone id or "*"

const base = { at: duration, drone: target };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("start"), camera: camera.optional() }).strict(),
  z.object({ ...base, action: z.literal("stop") }).strict(),
  /** Publisher crashes (process killed); with `for`, it starts again afterwards. */
  z.object({ ...base, action: z.literal("drop"), for: duration.optional() }).strict(),
  z.object({ ...base, action: z.literal("switchCamera"), camera }).strict(),
  /** A second publisher with the same key; with `for`, it stops again. */
  z.object({ ...base, action: z.literal("duplicate"), for: duration.optional() }).strict(),
  z
    .object({
      ...base,
      action: z.literal("network"),
      latencyMs: z.number().min(0).optional(),
      jitterMs: z.number().min(0).optional(),
      bandwidthKbps: z.number().min(0).optional(),
    })
    .strict(),
  /** Traffic freezes without closing the connection. */
  z.object({ ...base, action: z.literal("stall"), for: duration }).strict(),
  /** Hard connection loss; with `for`, reconnects fail for that long (out of range). */
  z.object({ ...base, action: z.literal("cut"), for: duration.optional() }).strict(),
  z.object({ ...base, action: z.literal("heal") }).strict(),
]);
export type ScenarioAction = z.infer<typeof actionSchema>;

const NETWORK_ACTIONS = new Set(["network", "stall", "cut", "heal"]);

export const scenarioSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    /** Total run time; default: last action + 15 s. */
    duration: duration.optional(),
    drones: z
      .array(
        z
          .object({
            id: z.string().min(1),
            profile: z.string().default("1080p30"),
            camera: camera.default("wide"),
            audio: z.boolean().default(false),
            switchMode: z.enum(["inline", "restart"]).default("inline"),
          })
          .strict(),
      )
      .min(1),
    timeline: z.array(actionSchema),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const ids = new Set(scenario.drones.map((d) => d.id));
    scenario.drones.forEach((drone, i) => {
      if (!PROFILES[drone.profile]) {
        ctx.addIssue({
          code: "custom",
          path: ["drones", i, "profile"],
          message: `unknown profile "${drone.profile}"`,
        });
      }
    });
    scenario.timeline.forEach((action, i) => {
      if (action.drone !== "*" && !ids.has(action.drone)) {
        ctx.addIssue({
          code: "custom",
          path: ["timeline", i, "drone"],
          message: `unknown drone "${action.drone}"`,
        });
      }
    });
  });
export type Scenario = z.infer<typeof scenarioSchema>;

export function parseScenario(raw: unknown, source = "scenario"): Scenario {
  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid scenario ${source}:\n${problems}`);
  }
  return result.data;
}

export async function loadScenario(file: string): Promise<Scenario> {
  return parseScenario(JSON.parse(await readFile(file, "utf8")), file);
}

export function scenarioDurationMs(scenario: Scenario): number {
  if (scenario.duration !== undefined) return scenario.duration;
  const lastAction = Math.max(0, ...scenario.timeline.map((a) => a.at + ("for" in a && a.for ? a.for : 0)));
  return lastAction + 15_000;
}

export function usesNetworkChaos(scenario: Scenario): boolean {
  return scenario.timeline.some((a) => NETWORK_ACTIONS.has(a.action));
}

// --- runner ---------------------------------------------------------------

export interface ScenarioRunnerOptions {
  scenario: Scenario;
  /** Ingest address of the service. */
  host: string;
  port: number;
  fontFile: string;
  logger: Logger;
  /** Simulated drones reconnect after failures (default true, like an RC Plus). */
  autoReconnect?: boolean;
}

export interface ScenarioEvent {
  atMs: number;
  drone: string;
  action: ScenarioAction["action"] | "restart" | "duplicate-end" | "finished";
}

/**
 * Plays a scenario timeline against a running service. Drones go through their own chaos
 * proxy when the scenario uses network actions. Emits `event` (ScenarioEvent).
 */
export class ScenarioRunner extends EventEmitter {
  readonly drones = new Map<string, SimulatedDrone>();
  readonly proxies = new Map<string, ChaosProxy>();
  private readonly duplicates = new Set<SimulatedDrone>();
  private readonly timers: NodeJS.Timeout[] = [];
  /** Actions on one drone run one after another. */
  private readonly queues = new Map<string, Promise<void>>();
  private startedAt = 0;
  private stopped = false;

  constructor(private readonly options: ScenarioRunnerOptions) {
    super();
  }

  /** Runs the whole scenario; resolves when it is finished and everything is stopped. */
  async run(): Promise<void> {
    await this.setup();
    const total = scenarioDurationMs(this.options.scenario);
    this.startedAt = Date.now();
    for (const action of [...this.options.scenario.timeline].sort((a, b) => a.at - b.at)) {
      this.timers.push(setTimeout(() => this.dispatch(action), action.at));
    }
    await new Promise<void>((resolve) => this.timers.push(setTimeout(resolve, total)));
    await this.stop();
    this.record("*", "finished");
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    await Promise.allSettled([...this.queues.values()]);
    await Promise.all([...this.drones.values(), ...this.duplicates].map((d) => d.stop()));
    await Promise.all([...this.proxies.values()].map((p) => p.stop()));
  }

  private async setup(): Promise<void> {
    const { scenario, host, port, fontFile, logger } = this.options;
    const chaos = usesNetworkChaos(scenario);
    for (const [index, spec] of scenario.drones.entries()) {
      let droneHost = host;
      let dronePort = port;
      if (chaos) {
        const proxy = new ChaosProxy({ name: spec.id, targetHost: host, targetPort: port, logger });
        await proxy.start();
        this.proxies.set(spec.id, proxy);
        droneHost = "127.0.0.1";
        dronePort = proxy.port;
      }
      const profile = PROFILES[spec.profile];
      if (!profile) throw new Error(`unknown profile ${spec.profile}`);
      this.drones.set(
        spec.id,
        new SimulatedDrone({
          id: spec.id,
          host: droneHost,
          port: dronePort,
          profile,
          camera: spec.camera,
          colour: colourForIndex(index),
          fontFile,
          audio: spec.audio,
          switchMode: spec.switchMode,
          autoReconnect: this.options.autoReconnect ?? true,
          logger,
        }),
      );
    }
  }

  private record(drone: string, action: ScenarioEvent["action"]): void {
    const event: ScenarioEvent = { atMs: Date.now() - this.startedAt, drone, action };
    this.options.logger.info({ scenario: this.options.scenario.name, ...event }, "scenario action");
    this.emit("event", event);
  }

  private dispatch(action: ScenarioAction): void {
    const ids = action.drone === "*" ? [...this.drones.keys()] : [action.drone];
    for (const id of ids) {
      const previous = this.queues.get(id) ?? Promise.resolve();
      const next = previous
        .then(() => (this.stopped ? undefined : this.apply(id, action)))
        .catch((err: unknown) => this.options.logger.error({ droneId: id, err }, "scenario action failed"));
      this.queues.set(id, next);
    }
  }

  private async apply(id: string, action: ScenarioAction): Promise<void> {
    const drone = this.drones.get(id);
    const proxy = this.proxies.get(id);
    if (!drone) return;
    this.record(id, action.action);
    switch (action.action) {
      case "start":
        await drone.start(action.camera);
        return;
      case "stop":
        await drone.stop();
        return;
      case "drop":
        await drone.kill();
        if (action.for !== undefined) this.later(action.for, id, "restart", () => drone.start());
        return;
      case "switchCamera":
        await drone.switchCamera(action.camera);
        return;
      case "duplicate": {
        const duplicate = this.createDuplicate(drone, id);
        await duplicate.start();
        if (action.for !== undefined) {
          this.later(action.for, id, "duplicate-end", async () => {
            await duplicate.stop();
            this.duplicates.delete(duplicate);
          });
        }
        return;
      }
      case "network":
        proxy?.setConditions({
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
          ...(action.jitterMs !== undefined ? { jitterMs: action.jitterMs } : {}),
          ...(action.bandwidthKbps !== undefined ? { bandwidthKbps: action.bandwidthKbps } : {}),
        });
        return;
      case "stall":
        proxy?.stall(action.for);
        return;
      case "cut":
        proxy?.cut(action.for ?? 0);
        return;
      case "heal":
        proxy?.heal();
        return;
    }
  }

  private createDuplicate(original: SimulatedDrone, id: string): SimulatedDrone {
    const proxy = this.proxies.get(id);
    const duplicate = new SimulatedDrone({
      id,
      host: proxy ? "127.0.0.1" : this.options.host,
      port: proxy ? proxy.port : this.options.port,
      profile: original.profile,
      camera: original.camera === "thermal" ? "wide" : "thermal", // visibly different
      colour: "0x444444",
      fontFile: this.options.fontFile,
      // The duplicate does not fight back; the original (an RC Plus) does reconnect.
      autoReconnect: false,
      logger: this.options.logger,
    });
    this.duplicates.add(duplicate);
    return duplicate;
  }

  private later(ms: number, id: string, label: ScenarioEvent["action"], fn: () => Promise<void>): void {
    this.timers.push(
      setTimeout(() => {
        const previous = this.queues.get(id) ?? Promise.resolve();
        this.queues.set(
          id,
          previous.then(async () => {
            if (this.stopped) return;
            this.record(id, label);
            await fn();
          }),
        );
      }, ms),
    );
  }
}
