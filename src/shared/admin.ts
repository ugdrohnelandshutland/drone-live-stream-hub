/** JSON shapes of the admin API (ADR 0012), shared by server and web UI. */

/** One open video socket of a device. */
export interface AdminStream {
  droneId: string;
  /** "keyframes": data saver tile (ADR 0009). */
  mode: "full" | "keyframes";
  /** ISO time the socket opened. */
  since: string;
}

/** Counts over the last 10 minutes; bandwidth over the last seconds. */
export interface AdminQuality {
  kbps: number;
  droppedFrames: number;
  /** Closed by the server because the device could not keep up (4008). */
  slowClosures: number;
  /** Connections that broke off (no answer to ping, network gone). */
  aborts: number;
}

export interface AdminClient {
  /** Client id from the device's cookie; for devices without one "anon:<address>". */
  id: string;
  /** No cookie (scripts, simulated viewers): listed by address, cannot be paused or named. */
  anonymous: boolean;
  name: string | null;
  /** Browser and system from the user agent, e.g. "Chrome · Android"; empty if unknown. */
  device: string;
  address: string;
  online: boolean;
  paused: boolean;
  /** ISO time the device came (back) online; null while offline. */
  onlineSince: string | null;
  lastSeen: string;
  streams: AdminStream[];
  quality: AdminQuality;
}

export interface AdminDroneLoad {
  id: string;
  name: string;
  live: boolean;
  /** Incoming bitrate from the RC; null while offline or not yet measured. */
  inKbps: number | null;
  viewers: number;
}

export interface AdminLoad {
  drones: AdminDroneLoad[];
  outKbps: number;
  viewers: number;
  /** Devices online right now. */
  devices: number;
  service: {
    version: string;
    uptimeSec: number;
    rssBytes: number;
    heapUsedBytes: number;
    /** Share of one CPU core since the previous sample, 0–100 (more with several threads). */
    cpuPercent: number | null;
  };
}

export type AdminEventKind =
  | "drone-live"
  | "drone-offline"
  /** Camera switch (sequence header changed) or a new publisher session replaced the old one. */
  | "stream-reset"
  | "publish-rejected"
  | "client-online"
  | "client-offline"
  | "client-paused"
  | "client-resumed"
  | "client-reload"
  | "client-renamed";

export interface AdminEvent {
  /** Increasing number; GET /api/admin/state?eventsAfter=<seq> returns only newer ones. */
  seq: number;
  at: string;
  kind: AdminEventKind;
  droneId?: string;
  clientId?: string;
  /** Name or device label of the client at the time of the event. */
  client?: string;
  address?: string;
  /** stream-reset: "camera" | "publisher"; publish-rejected: the stream key; client-renamed: the new name. */
  detail?: string;
}

/**
 * A raw recording of what one publisher sent, as an FLV file in `<dataDir>/captures` (for
 * analysing real Pilot 2 streams). Download: GET /api/admin/captures/<file>.
 */
export interface AdminCapture {
  /** File name, e.g. "m30t-01_2026-10-26T18-52-18-648Z.flv". */
  file: string;
  droneId: string;
  startedAt: string;
  recording: boolean;
  bytes: number;
  /** Set when it ended before the planned length. */
  cutShort?: "offline" | "size" | "error" | "stopped";
}

/** POST /api/admin/captures answers 409 with this. */
export interface AdminCaptureError {
  error: "offline" | "busy";
}

/** Length of one capture: long enough to catch a few rare stream errors. */
export const CAPTURE_SECONDS = 30;

/** GET /api/admin/state */
export interface AdminState {
  generatedAt: string;
  clients: AdminClient[];
  load: AdminLoad;
  /** Changes when the service restarts: the event numbers start again, so drop the old list. */
  eventsEpoch: string;
  /** Newest last; only those after `eventsAfter`. */
  events: AdminEvent[];
  /** Newest first; null when the service has no data directory (captures off). */
  captures: AdminCapture[] | null;
}

/** POST /api/admin/login answers 401 with this, or 429 while the address is locked out. */
export interface AdminLoginError {
  error: "wrong-pin" | "locked" | "bad-request";
  retryAfterSec?: number;
}

/** Most events the server keeps (and the page shows). */
export const ADMIN_EVENT_LIMIT = 500;
/** Longest device name. */
export const ADMIN_NAME_MAX = 40;
