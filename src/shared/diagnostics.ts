/** JSON shapes of GET /api/diagnostics: what each publisher actually sends (dev/field tests). */
import type { ServiceInfo } from "./api.js";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type DiagnosticsEventKind =
  "publish" | "unpublish" | "replaced" | "sequence-header" | "metadata" | "timestamp-jump" | "rejected";

export interface DiagnosticsEvent {
  /** ISO time. */
  at: string;
  kind: DiagnosticsEventKind;
  /** English, for logs and bug reports; the page shows it as is. */
  text: string;
}

export interface PublisherInfo {
  sessionId: string;
  remoteAddress: string;
  startedAt: string;
  /** Set once the session has ended; the last session stays visible. */
  endedAt: string | null;
  /** The RTMP connect command object (flashVer, tcUrl, capabilities, …) as sent. */
  connect: Record<string, JsonValue>;
}

export interface VideoFormatInfo {
  codec: string;
  codecString: string | null;
  /** e.g. "High" (H.264 only). */
  profile: string | null;
  /** e.g. "4.0" (H.264 only). */
  level: string | null;
  width: number | null;
  height: number | null;
}

export interface StreamMeasurements {
  /** Length of the window the rates are computed over. */
  windowSec: number;
  fps: number | null;
  kbps: number | null;
  /** From the stream timestamps of the recent keyframes. */
  keyframeIntervalMs: { avg: number; min: number; max: number } | null;
  avgKeyframeBytes: number | null;
  /** Longest pause between two arriving frames (network between RC and PC). */
  maxArrivalGapMs: number | null;
  /** Non-zero composition time offsets seen, i.e. the encoder uses B-frames. */
  bFrames: boolean;
}

export interface StreamTotals {
  frames: number;
  keyframes: number;
  bytes: number;
  sequenceHeaders: number;
  timestampJumps: number;
  audioTags: number;
  /** e.g. "AAC"; audio is dropped by the service. */
  audioCodec: string | null;
}

export interface DeliveryInfo {
  viewers: number;
  droppedTags: number;
  slowViewerClosures: number;
  cacheBytes: number;
}

export interface DroneDiagnostics {
  id: string;
  name: string;
  live: boolean;
  /** Current or, when offline, the last publisher; null if none since the service started. */
  publisher: PublisherInfo | null;
  /** Raw onMetaData fields. */
  metadata: Record<string, JsonValue> | null;
  video: VideoFormatInfo | null;
  measurements: StreamMeasurements | null;
  totals: StreamTotals | null;
  delivery: DeliveryInfo | null;
  /** Newest first. */
  events: DiagnosticsEvent[];
}

/** Publish attempts with a stream key that is not configured, grouped by key and host. */
export interface RejectedPublishInfo {
  streamKey: string;
  /** IP address without port (an RC retrying uses a new port each time). */
  remoteHost: string;
  attempts: number;
  firstAt: string;
  lastAt: string;
}

export interface DiagnosticsResponse {
  generatedAt: string;
  service: ServiceInfo & { uptimeSec: number };
  drones: DroneDiagnostics[];
  /** Unknown stream keys, most recent attempt first. */
  rejected: RejectedPublishInfo[];
}
