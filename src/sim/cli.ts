import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, resolveConfigPath } from "../server/config.js";
import { createLogger } from "../server/logger.js";
import { SimulatedDrone } from "./drone.js";
import { MIN_FFMPEG_MAJOR, findFontFile, parseFfmpegMajor, probeFfmpeg } from "./ffmpeg.js";
import { ScenarioReporter, summarize } from "./report.js";
import { ScenarioRunner, loadScenario, scenarioDurationMs } from "./scenarios.js";
import { CAMERA_MODES, PROFILES, colourForIndex, isCameraMode, type CameraMode } from "./profiles.js";

const USAGE = `Usage: npm run sim -- [options]

  --drones <n>          number of simulated drones (default 1)
  --ids <a,b,...>       explicit drone ids (default: first n ids from the config, then m30t-NN)
  --host <host>         RTMP host (default 127.0.0.1)
  --port <port>         RTMP port (default: rtmpPort from the config, else 1935)
  --config <path>       config file used for ids and port (default config/drones.json)
  --profile <name>      ${Object.keys(PROFILES).join(" | ")} (default 1080p30)
  --camera <mode>       ${CAMERA_MODES.join(" | ")} (default wide)
  --gop <seconds>       keyframe interval override
  --bitrate <kbps>      video bitrate override
  --audio               add an AAC track (the service must drop it)
  --source <file>       loop a local video file instead of the test pattern
  --switch-every <s>    cycle wide → zoom → thermal every s seconds
  --unknown-key         add one drone with a key that is not in the config (must be rejected)
  --duration <s>        stop after s seconds
  --scenario <file>     run a scripted scenario (sim/scenarios/*.json); drones come from the file
  --report              with --scenario: watch the service (one viewer per drone, /healthz)
                        and write a report to sim/reports/
`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function positiveNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
  return n;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      drones: { type: "string" },
      ids: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string" },
      config: { type: "string" },
      profile: { type: "string", default: "1080p30" },
      camera: { type: "string", default: "wide" },
      gop: { type: "string" },
      bitrate: { type: "string" },
      audio: { type: "boolean", default: false },
      source: { type: "string" },
      "switch-every": { type: "string" },
      duration: { type: "string" },
      "unknown-key": { type: "boolean", default: false },
      scenario: { type: "string" },
      report: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const logger = createLogger({ name: "sim" });

  const ffmpegVersion = await probeFfmpeg();
  if (!ffmpegVersion) {
    fail("ffmpeg not found. Install ffmpeg (see docs/dev-setup.md) and put it on PATH, or set FFMPEG_PATH.");
  }
  const ffmpegMajor = parseFfmpegMajor(ffmpegVersion);
  if (ffmpegMajor !== undefined && ffmpegMajor < MIN_FFMPEG_MAJOR) {
    logger.warn(
      { ffmpeg: ffmpegVersion, minimum: MIN_FFMPEG_MAJOR },
      "ffmpeg is older than the tested minimum; overlay filters may fail. See docs/dev-setup.md.",
    );
  }
  const fontFile = await findFontFile();
  if (!fontFile) fail("No font file found for the overlay. Set SIM_FONT to a .ttf file.");

  const baseProfile = PROFILES[values.profile];
  if (!baseProfile) fail(`unknown profile "${values.profile}"`);
  const gop = positiveNumber(values.gop, "gop");
  const bitrate = positiveNumber(values.bitrate, "bitrate");
  const profile = {
    ...baseProfile,
    ...(gop !== undefined ? { keyframeIntervalSec: gop } : {}),
    ...(bitrate !== undefined ? { bitrateKbps: bitrate } : {}),
  };
  if (!isCameraMode(values.camera)) fail(`unknown camera "${values.camera}"`);
  const camera: CameraMode = values.camera;

  const configPath = resolveConfigPath(values.config ? ["--config", values.config] : [], process.env);
  const config = existsSync(configPath) ? await loadConfig(configPath) : undefined;

  if (values.scenario) {
    const scenario = await loadScenario(values.scenario);
    const port = positiveNumber(values.port, "port") ?? config?.rtmpPort ?? 1935;
    const known = new Set(config?.drones.map((d) => d.id) ?? []);
    const unknown = scenario.drones.map((d) => d.id).filter((id) => config && !known.has(id));
    logger.info(
      {
        scenario: scenario.name,
        drones: scenario.drones.map((d) => d.id),
        actions: scenario.timeline.length,
        durationSec: Math.round(scenarioDurationMs(scenario) / 1000),
        notInConfig: unknown.length ? unknown : undefined,
      },
      scenario.description ?? "running scenario",
    );
    const runner = new ScenarioRunner({ scenario, host: values.host, port, fontFile, logger });
    const reporter = values.report
      ? new ScenarioReporter(
          `http://${values.host}:${config?.httpPort ?? 8080}`,
          scenario.drones.map((d) => d.id),
          logger,
        )
      : undefined;
    runner.on("event", (event) => reporter?.recordAction(event));
    const finish = async () => {
      if (!reporter) return;
      const { file, report } = await reporter.finish(scenario.name, path.join("sim", "reports"));
      console.log(`\n${summarize(report)}\n\nReport: ${file}`);
    };
    const stop = () =>
      void runner
        .stop()
        .then(finish)
        .then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    reporter?.start();
    const endTimer = setTimeout(() => reporter?.markEnd(), Math.max(0, scenarioDurationMs(scenario) - 1500));
    await runner.run();
    clearTimeout(endTimer);
    logger.info({ scenario: scenario.name }, "scenario finished");
    await finish();
    process.exit(0);
  }

  let ids: string[];
  if (values.ids) {
    ids = values.ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const count = positiveNumber(values.drones, "drones") ?? 1;
    const fromConfig = config?.drones.map((d) => d.id) ?? [];
    ids = Array.from({ length: count }, (_, i) => fromConfig[i] ?? `m30t-${String(i + 1).padStart(2, "0")}`);
  }
  if (values["unknown-key"]) ids.push("unknown-01");
  const port = positiveNumber(values.port, "port") ?? config?.rtmpPort ?? 1935;

  if (config) {
    const known = new Set(config.drones.map((d) => d.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      logger.warn(
        { unknown, configPath },
        "these ids are not in the config; the service will reject them (add them to the config to stream)",
      );
    }
  }

  logger.info(
    { ffmpeg: ffmpegVersion, ids, host: values.host, port, profile: profile.name, camera, fontFile },
    "starting simulated drones",
  );

  const drones = ids.map(
    (id, i) =>
      new SimulatedDrone({
        id,
        host: values.host,
        port,
        profile,
        camera,
        colour: colourForIndex(i),
        fontFile,
        audio: values.audio,
        ...(values.source !== undefined ? { source: values.source } : {}),
        logger,
      }),
  );
  await Promise.all(drones.map((d) => d.start()));

  const timers: NodeJS.Timeout[] = [];
  const switchEvery = positiveNumber(values["switch-every"], "switch-every");
  if (switchEvery) {
    timers.push(
      setInterval(() => {
        for (const drone of drones) {
          const next = CAMERA_MODES[(CAMERA_MODES.indexOf(drone.camera) + 1) % CAMERA_MODES.length] ?? "wide";
          void drone.switchCamera(next);
        }
      }, switchEvery * 1000),
    );
  }

  let stopping = false;
  const shutdown = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    timers.forEach(clearInterval);
    logger.info({ reason }, "stopping simulated drones");
    await Promise.all(drones.map((d) => d.stop()));
    process.exit(0);
  };
  const duration = positiveNumber(values.duration, "duration");
  if (duration) timers.push(setTimeout(() => void shutdown("duration elapsed"), duration * 1000));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
