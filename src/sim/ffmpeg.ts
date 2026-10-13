import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

/** ffmpeg binary: `FFMPEG_PATH` if set, otherwise `ffmpeg` from PATH. */
export function ffmpegBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env["FFMPEG_PATH"] ?? "ffmpeg";
}

/** Returns the ffmpeg version line, or undefined if ffmpeg cannot be run. */
export function probeFfmpeg(binary = ffmpegBinary()): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(binary, ["-hide_banner", "-version"], { timeout: 10_000 }, (err, stdout) => {
      resolve(err ? undefined : stdout.split(/\r?\n/)[0]);
    });
  });
}

/** Lists what the simulator needs from ffmpeg but this build lacks (e.g. drawtext without freetype). */
export function missingFfmpegFeatures(binary = ffmpegBinary()): Promise<string[]> {
  const list = (kind: "-filters" | "-encoders") =>
    new Promise<string>((resolve) => {
      execFile(
        binary,
        ["-hide_banner", kind],
        { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => resolve(err ? "" : stdout),
      );
    });
  return Promise.all([list("-filters"), list("-encoders")]).then(([filters, encoders]) => {
    const missing: string[] = [];
    if (!/\sdrawtext\s/.test(filters)) missing.push("drawtext filter");
    if (!/\slibx264\s/.test(encoders)) missing.push("libx264 encoder");
    return missing;
  });
}

/**
 * Why tests that run simulated drones cannot run here, or "" if they can. With
 * REQUIRE_FFMPEG=1 (CI) a missing prerequisite throws instead, so tests are never skipped
 * silently.
 */
export async function simulatorSkipReason(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  let reason = "";
  const version = await probeFfmpeg(ffmpegBinary(env));
  if (!version) {
    reason = "ffmpeg not found on PATH (or FFMPEG_PATH)";
  } else {
    const missing = await missingFfmpegFeatures(ffmpegBinary(env));
    if (missing.length > 0) reason = `${version} lacks ${missing.join(" and ")}`;
    else if (!(await findFontFile(env))) reason = "no font file for the overlay (set SIM_FONT)";
  }
  if (reason && env["REQUIRE_FFMPEG"] === "1") throw new Error(`Simulator prerequisites missing: ${reason}`);
  return reason;
}

/** Oldest ffmpeg major version the simulator is expected to work with (tested with 8.1). */
export const MIN_FFMPEG_MAJOR = 6;

/**
 * Extracts the major version from an `ffmpeg -version` line, e.g. "ffmpeg version n8.1.3-…",
 * "ffmpeg version 4.4.2-0ubuntu0.22.04.1". Git snapshot builds ("N-12345-g…") return undefined.
 */
export function parseFfmpegMajor(versionLine: string): number | undefined {
  const match = /^ffmpeg version n?(\d+)\.\d+/.exec(versionLine);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

const FONT_CANDIDATES: Record<string, string[]> = {
  win32: ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/arial.ttf"],
  darwin: ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"],
  linux: [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
  ],
};

/**
 * drawtext needs a font file. Static ffmpeg builds often have no working fontconfig,
 * so we pass an explicit file: `SIM_FONT` if set, otherwise a known system font.
 */
export async function findFontFile(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const candidates = [
    env["SIM_FONT"],
    ...(FONT_CANDIDATES[process.platform] ?? FONT_CANDIDATES["linux"] ?? []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

/**
 * Quotes a file path for use as a filter option value inside -filter_complex.
 * Forward slashes avoid backslash escaping; `:` must be escaped for the option parser
 * (e.g. Windows drive letters), and the whole value is single-quoted for the graph parser.
 */
export function quoteFilterPath(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/").replaceAll("\\", "/");
  return `'${normalized.replaceAll("'", "'\\''").replaceAll(":", "\\:")}'`;
}
