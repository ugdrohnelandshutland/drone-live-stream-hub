import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceInfo } from "../shared/api.js";

export const SERVICE_NAME = "Drone Live Stream Hub";

/** Replaced with a literal by the packaging script (scripts/package-windows.ts). */
declare const __DLSH_BUILD_INFO__: ServiceInfo | undefined;

/** Short commit of `cwd`, with "-dirty" for uncommitted changes; null without git. */
export function readGitCommit(cwd: string): string | null {
  try {
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    const commit = git(["rev-parse", "--short", "HEAD"]);
    return git(["status", "--porcelain"]) === "" ? commit : `${commit}-dirty`;
  } catch {
    return null;
  }
}

/**
 * Release information. The Windows package has it baked in; from source (tsx or the tsc
 * build) it is read from package.json and git once at startup.
 */
export function loadBuildInfo(): ServiceInfo {
  if (typeof __DLSH_BUILD_INFO__ !== "undefined") return __DLSH_BUILD_INFO__;
  // <repo>/package.json, from src/server and dist/server alike.
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let version = "unknown";
  try {
    version = (JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    // keep "unknown"
  }
  return { name: SERVICE_NAME, version, commit: readGitCommit(repo), builtAt: null };
}
