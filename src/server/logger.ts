import { pino, type Logger } from "pino";

export type { Logger };

export interface LoggerOptions {
  name: string;
  level?: string;
}

/**
 * Creates the root logger: structured JSON to stdout. As a Windows service, the wrapper
 * (shawl) writes this output to rotating files under <install dir>\logs (ADR 0004).
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: options.name,
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
