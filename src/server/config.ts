import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DRONE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

const droneSchema = z.object({
  id: z.string().regex(DRONE_ID_PATTERN, "must match ^[a-z0-9-]{1,32}$"),
  name: z.string().min(1),
});

const portSchema = z.number().int().min(1).max(65535);
const ADMIN_PIN_PATTERN = /^\d{4,12}$/;
const adminPinSchema = z.string().regex(ADMIN_PIN_PATTERN, "must be 4 to 12 digits, in quotes");

export const configSchema = z
  .object({
    rtmpPort: portSchema.default(1935),
    httpPort: portSchema.default(8080),
    drones: z.array(droneSchema).min(1),
    /** Enables the admin page (ADR 0012). A string, so leading zeros count. */
    adminPin: adminPinSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.drones.forEach((drone, index) => {
      if (seen.has(drone.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["drones", index, "id"],
          message: `duplicate drone id "${drone.id}"`,
        });
      }
      seen.add(drone.id);
    });
  });

export type AppConfig = z.infer<typeof configSchema>;
export type DroneConfig = AppConfig["drones"][number];

export const CONFIG_ENV_VAR = "DLSH_CONFIG";
export const DEFAULT_CONFIG_PATH = path.join("config", "drones.json");
export const DATA_DIR_ENV_VAR = "DLSH_DATA_DIR";
export const ADMIN_PIN_ENV_VAR = "DLSH_ADMIN_PIN";

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** Resolves the config path: `--config <path>` / `--config=<path>`, then env var, then default. */
export function resolveConfigPath(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): string {
  let fromArgs: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      fromArgs = argv[i + 1];
      if (fromArgs === undefined) throw new ConfigError("--config requires a path");
    } else if (arg?.startsWith("--config=")) {
      fromArgs = arg.slice("--config=".length);
    }
  }
  return path.resolve(cwd, fromArgs ?? env[CONFIG_ENV_VAR] ?? DEFAULT_CONFIG_PATH);
}

/**
 * Where the service keeps what it writes at runtime (device names): `--data-dir <path>`, then
 * the env var, then `data` next to the config folder (`<install dir>\data` on Windows).
 */
export function resolveDataDir(argv: readonly string[], env: NodeJS.ProcessEnv, configPath: string): string {
  const index = argv.indexOf("--data-dir");
  const fromArgs = index >= 0 ? argv[index + 1] : argv.find((a) => a.startsWith("--data-dir="))?.slice(11);
  if (index >= 0 && fromArgs === undefined) throw new ConfigError("--data-dir requires a path");
  return path.resolve(fromArgs ?? env[DATA_DIR_ENV_VAR] ?? path.join(path.dirname(configPath), "..", "data"));
}

/** Validates already-parsed JSON. Throws ConfigError with a readable list of problems. */
export function parseConfig(raw: unknown, source = "config"): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration in ${source}:\n${problems}`);
  }
  return result.data;
}

export async function loadConfig(filePath: string): Promise<AppConfig> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const hint =
      code === "ENOENT"
        ? ` Copy config${path.sep}drones.example.json to config${path.sep}drones.json or pass --config <path>.`
        : "";
    throw new ConfigError(`Cannot read config file ${filePath} (${code ?? String(err)}).${hint}`);
  }
  let raw: unknown;
  try {
    // Notepad on older Windows versions saves UTF-8 with a byte order mark.
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new ConfigError(`Config file ${filePath} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw, filePath);
}

export type AdminPinSource = "env" | "config" | undefined;

/**
 * `DLSH_ADMIN_PIN` overrides `adminPin` from the file (Docker: the PIN stays out of the image
 * and needs no mounted config). Empty counts as not set. Same rule as in the file.
 */
export function applyEnvOverrides(
  config: AppConfig,
  env: NodeJS.ProcessEnv,
): { config: AppConfig; adminPinSource: AdminPinSource } {
  const pin = env[ADMIN_PIN_ENV_VAR]?.trim();
  if (pin) {
    if (!ADMIN_PIN_PATTERN.test(pin)) {
      throw new ConfigError(`Invalid ${ADMIN_PIN_ENV_VAR}: must be 4 to 12 digits.`);
    }
    return { config: { ...config, adminPin: pin }, adminPinSource: "env" };
  }
  return { config, adminPinSource: config.adminPin !== undefined ? "config" : undefined };
}
