import { createService } from "./app.js";
import { loadBuildInfo } from "./build-info.js";
import { ConfigError, loadConfig, resolveConfigPath } from "./config.js";
import { createLogger } from "./logger.js";

/**
 * Exit codes. The Windows service wrapper restarts the process after a crash, but not
 * after a configuration error: retrying cannot fix a broken drones.json.
 */
const EXIT_CONFIG_ERROR = 2;
const EXIT_FATAL = 1;
/** The Node.js major releases are built and tested with (ADR 0008); the field PC installs it. */
const TESTED_NODE_MAJOR = 24;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const info = loadBuildInfo();
  if (argv.includes("--version")) {
    console.log(
      `${info.name} ${info.version} (commit ${info.commit ?? "unknown"}, built ${info.builtAt ?? "from source"})`,
    );
    return;
  }
  const configPath = resolveConfigPath(argv, process.env);
  const config = await loadConfig(configPath);

  if (argv.includes("--check-config")) {
    console.log(
      `Configuration OK: ${configPath}\n` +
        `  RTMP port ${config.rtmpPort}, HTTP port ${config.httpPort}\n` +
        `  Drones: ${config.drones.map((d) => `${d.id} (${d.name})`).join(", ")}`,
    );
    return;
  }

  const logger = createLogger({ name: "drone-live-stream-hub" });
  logger.info(
    { configPath, drones: config.drones.map((d) => d.id), pid: process.pid },
    "configuration loaded",
  );
  if (Number(process.versions.node.split(".")[0]) !== TESTED_NODE_MAJOR) {
    // Keep running: the picture matters more than the version, but the log should say why.
    logger.warn(
      { node: process.versions.node, tested: `${TESTED_NODE_MAJOR}.x` },
      "running on an untested Node.js version",
    );
  }

  // `--host 127.0.0.1` binds to loopback only (testing); default: all interfaces.
  const hostIndex = argv.indexOf("--host");
  const host = hostIndex >= 0 ? argv[hostIndex + 1] : undefined;
  const service = createService(config, logger, { info, ...(host !== undefined ? { host } : {}) });
  await service.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    await service.stop();
    process.exit(0);
  };
  // The Windows service wrapper stops the process with a Ctrl+C event (SIGINT).
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(EXIT_CONFIG_ERROR);
  }
  console.error("Fatal error during startup:", err);
  process.exit(EXIT_FATAL);
});
