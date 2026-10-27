/** JSON shapes of the HTTP API, shared by server and web UI. */

export type DroneState = "offline" | "live";

export interface DroneVideoInfo {
  codec: string;
  /** RFC 6381 codec string, e.g. "avc1.640028", when known. */
  codecString?: string;
  width?: number;
  height?: number;
}

export interface DroneStatus {
  id: string;
  name: string;
  state: DroneState;
  /** ISO time of the last state change; null if the drone has not been live since the service started. */
  since: string | null;
  sessionId: string | null;
  /**
   * Live, but the publisher has sent no video for a while (the RC drops frames or its link
   * stalls): ISO time of its last video tag. null while frames arrive and while offline.
   * Lets the web UI tell "the drone sends nothing" from "this device's connection is weak".
   */
  stalledSince: string | null;
  viewerCount: number;
  video: DroneVideoInfo | null;
}

/** GET /api/drones */
export interface DronesResponse {
  drones: DroneStatus[];
}

/** SSE event names on GET /api/events. `snapshot` carries DronesResponse, `drone-updated` a DroneStatus. */
export const SSE_SNAPSHOT = "snapshot";
export const SSE_DRONE_UPDATED = "drone-updated";
/**
 * Sent only to the device concerned (ADR 0012): an admin paused or released its picture, or
 * asked it to reload. `client-paused` also arrives right after connecting while paused.
 */
export const SSE_CLIENT_PAUSED = "client-paused";
export const SSE_CLIENT_RESUMED = "client-resumed";
export const SSE_CLIENT_RELOAD = "client-reload";

/** GET /api/info — which release is running. */
export interface ServiceInfo {
  name: string;
  version: string;
  /** Short git commit, "-dirty" if built from uncommitted changes; null if unknown. */
  commit: string | null;
  /** ISO time of the package build; null when running from source. */
  builtAt: string | null;
}
