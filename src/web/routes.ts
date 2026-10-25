/**
 * URLs of the web UI. Views get their options from here and never read `location` themselves.
 * Switching between overview and single view happens in place (navigation.ts, ADR 0007); the
 * options are read once per page load.
 */
import type { LatencyTuning } from "./player/live-player";

export type Route =
  { page: "overview" } | { page: "drone"; droneId: string } | { page: "diagnostics" } | { page: "admin" };

export function parseRoute(pathname: string): Route {
  const drone = /^\/drone\/([^/]+)\/?$/.exec(pathname);
  if (drone?.[1]) {
    try {
      return { page: "drone", droneId: decodeURIComponent(drone[1]) };
    } catch {
      // Malformed escape such as /drone/%E0: show the overview instead of crashing.
      return { page: "overview" };
    }
  }
  if (/^\/diagnose\/?$/.test(pathname)) return { page: "diagnostics" };
  if (/^\/admin\/?$/.test(pathname)) return { page: "admin" };
  return { page: "overview" };
}

export const overviewHref = "/";

export function droneHref(droneId: string): string {
  return `/drone/${encodeURIComponent(droneId)}`;
}

/** `?theme=tag|nacht` fixes the colour scheme (kiosk); read in index.html, see lib/theme.ts. */
export type ThemeChoice = "day" | "night";

export interface PageOptions {
  /** `?kiosk` — fixed touchscreen: no navigation, no file handling, larger targets. */
  kiosk: boolean;
  /** `?stats` — latency panel in the single view (measurement, scripts/measure-latency.ts). */
  stats: boolean;
  /** `?nurlive` — the overview starts with "Nur live" on (kiosk), without storing it. */
  liveOnly: boolean;
  /** `?previews=0` — no live previews in the overview (weak devices). */
  previews: boolean;
  /** `?datensparen=1|0` — "Datensparen" on/off for this page (kiosk), not stored. */
  dataSaver: boolean | undefined;
  /** `?syncTarget=0.15&syncMax=0.3` … — latency tuning for field tests. */
  tuning: Partial<LatencyTuning>;
}

const TUNING_KEYS = ["syncTarget", "syncMax", "syncRate", "chaseMax", "chaseMinRemain"] as const;

/** `?x=1` / `?x` on, `?x=0` off, missing undefined. */
function flagParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value !== "0";
}

export function readPageOptions(search: string): PageOptions {
  const params = new URLSearchParams(search);
  const tuning: Partial<LatencyTuning> = {};
  for (const key of TUNING_KEYS) {
    const value = Number(params.get(key));
    if (params.has(key) && Number.isFinite(value) && value > 0) tuning[key] = value;
  }
  return {
    kiosk: params.has("kiosk"),
    stats: params.has("stats"),
    liveOnly: params.has("nurlive"),
    previews: params.get("previews") !== "0",
    dataSaver: flagParam(params.get("datensparen")),
    tuning,
  };
}
