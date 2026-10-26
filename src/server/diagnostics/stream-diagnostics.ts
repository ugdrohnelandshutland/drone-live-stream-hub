import type { Amf0Value } from "../flv/amf0.js";
import { avcLevelName, avcProfileName, parseAvcDecoderConfig } from "../../shared/flv/avc.js";
import { isMetadataObject, parseScriptTag } from "../flv/script.js";
import type { FlvTag } from "../flv/types.js";
import { checkNalUnits, NAL_PROBLEMS, nalLengthSize, type NalProblem } from "../../shared/flv/nal.js";
import { compositionTimeOffset, isKeyframe, parseVideoTag } from "../../shared/flv/video.js";
import type { IngestAdapter } from "../ingest/types.js";
import type { Logger } from "../logger.js";
import type { DroneRegistry } from "../registry/registry.js";
import type {
  DiagnosticsEvent,
  DiagnosticsEventKind,
  JsonValue,
  PublisherInfo,
  RejectedPublishInfo,
  StreamMeasurements,
  StreamTotals,
  VideoFormatInfo,
} from "../../shared/diagnostics.js";

/** AMF values as JSON: dates become ISO strings, undefined and non-finite numbers null. */
export function amfToJson(value: Amf0Value | unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((v) => amfToJson(v));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, amfToJson(v)]));
  }
  return null;
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  const json = amfToJson(value);
  return json !== null && typeof json === "object" && !Array.isArray(json) ? json : {};
}

/** FLV SoundFormat (upper 4 bits of the audio tag header). */
const AUDIO_FORMATS: Record<number, string> = {
  0: "PCM",
  1: "ADPCM",
  2: "MP3",
  3: "PCM LE",
  7: "G.711 A-law",
  8: "G.711 µ-law",
  9: "Enhanced (FourCC)",
  10: "AAC",
  11: "Speex",
  14: "MP3 8 kHz",
};

/** A timestamp step larger than this (or backwards) counts as a jump. */
const TIMESTAMP_JUMP_MS = 1000;
/** Keyframe intervals are taken over a longer span than rates: GOPs can be several seconds. */
const KEYFRAME_HISTORY_MS = 60_000;
/** After the first malformed frame, at most one event (and warning) per drone this often. */
const MALFORMED_REPORT_MS = 60_000;

interface FrameSample {
  arrival: number;
  bytes: number;
}

interface KeyframeSample {
  dts: number;
  bytes: number;
  arrival: number;
}

interface Session {
  droneId: string;
  publisher: PublisherInfo;
  startedAtMs: number;
  endedAtMs: number | undefined;
  log: Logger;
  metadata: Record<string, JsonValue> | null;
  sequenceHeader: Buffer | undefined;
  /** NAL length field size from the sequence header (AVC/HEVC only). */
  nalLengthSize: number | undefined;
  /** Malformed frames since the last event about them, and when that was. */
  malformedReport: { lastAt: number | undefined; since: number };
  video: VideoFormatInfo | null;
  frames: FrameSample[];
  keyframes: KeyframeSample[];
  lastDts: number | undefined;
  lastArrival: number | undefined;
  bFrames: boolean;
  totals: StreamTotals;
  firstKeyframeLogged: boolean;
  /** Counters for the periodic log line. */
  logWindow: { frames: number; bytes: number; startedAt: number };
}

interface DroneRecord {
  session: Session | undefined;
  events: DiagnosticsEvent[];
}

export interface DroneStreamDiagnostics {
  publisher: PublisherInfo | null;
  live: boolean;
  metadata: Record<string, JsonValue> | null;
  video: VideoFormatInfo | null;
  measurements: StreamMeasurements | null;
  totals: StreamTotals | null;
  events: DiagnosticsEvent[];
}

export interface StreamDiagnosticsOptions {
  ingest: IngestAdapter;
  registry: DroneRegistry;
  logger: Logger;
  /** Periodic "stream stats" log line per live stream; 0 disables it. */
  summaryIntervalMs?: number;
  /** Window for rates (fps, bitrate, arrival gaps). */
  windowMs?: number;
  /** Events kept per drone. */
  maxEvents?: number;
  now?: () => number;
}

/**
 * Records what each publisher actually sends: connect data, metadata, video format, rates,
 * keyframe spacing, B-frames, timestamp jumps, audio. Feeds GET /api/diagnostics and the
 * stream log lines. Observes ingest only; never touches delivery.
 */
export class StreamDiagnostics {
  private readonly bySession = new Map<string, Session>();
  private readonly drones = new Map<string, DroneRecord>();
  private readonly rejected = new Map<string, RejectedPublishInfo>();
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: StreamDiagnosticsOptions) {
    this.windowMs = options.windowMs ?? 10_000;
    this.maxEvents = options.maxEvents ?? 30;
    this.now = options.now ?? Date.now;
    const { ingest, registry } = options;
    // Registered after the registry: only accepted publishers get here.
    ingest.on("publish", ({ streamKey, sessionId, remoteAddress, connect }) => {
      this.onPublish(streamKey, sessionId, remoteAddress, connect);
      return true;
    });
    ingest.on("metadata", (sessionId, tag) => this.onMetadata(sessionId, tag));
    ingest.on("videoTag", (sessionId, tag) => this.onVideo(sessionId, tag));
    ingest.on("audioTag", (sessionId, tag) => this.onAudio(sessionId, tag));
    ingest.on("unpublish", (sessionId) => this.onUnpublish(sessionId));
    registry.on("publish-rejected", ({ streamKey, remoteAddress, at }) => {
      const remoteHost = hostOf(remoteAddress);
      const key = `${streamKey}\n${remoteHost}`;
      const entry = this.rejected.get(key);
      const iso = at.toISOString();
      // Re-insert so the map stays ordered by the latest attempt.
      this.rejected.delete(key);
      this.rejected.set(
        key,
        entry
          ? { ...entry, attempts: entry.attempts + 1, lastAt: iso }
          : { streamKey, remoteHost, attempts: 1, firstAt: iso, lastAt: iso },
      );
      if (this.rejected.size > this.maxEvents) {
        const oldest = this.rejected.keys().next().value;
        if (oldest !== undefined) this.rejected.delete(oldest);
      }
    });
  }

  start(): void {
    const interval = this.options.summaryIntervalMs ?? 30_000;
    if (interval <= 0) return;
    this.timer = setInterval(() => this.logSummaries(), interval);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Per drone id; drones that never published are absent. */
  snapshot(droneId: string): DroneStreamDiagnostics | undefined {
    const record = this.drones.get(droneId);
    if (!record) return undefined;
    const session = record.session;
    return {
      publisher: session ? { ...session.publisher } : null,
      live: session !== undefined && session.endedAtMs === undefined,
      metadata: session?.metadata ?? null,
      video: session?.video ?? null,
      measurements: session ? this.measure(session) : null,
      totals: session ? { ...session.totals } : null,
      events: [...record.events],
    };
  }

  /** Most recent attempt first. */
  rejectedPublishes(): RejectedPublishInfo[] {
    return [...this.rejected.values()].reverse();
  }

  // --- ingest events --------------------------------------------------------

  private onPublish(
    droneId: string,
    sessionId: string,
    remoteAddress: string,
    connect: Record<string, unknown>,
  ): void {
    const record = this.record(droneId);
    const previous = record.session;
    if (previous && previous.endedAtMs === undefined) {
      this.event(
        record,
        "replaced",
        `session from ${previous.publisher.remoteAddress} replaced by ${remoteAddress}`,
      );
    }
    const now = this.now();
    const connectJson = jsonObject(connect);
    const session: Session = {
      droneId,
      publisher: {
        sessionId,
        remoteAddress,
        startedAt: new Date(now).toISOString(),
        endedAt: null,
        connect: connectJson,
      },
      startedAtMs: now,
      endedAtMs: undefined,
      log: this.options.logger.child({ droneId, sessionId }),
      metadata: null,
      sequenceHeader: undefined,
      nalLengthSize: undefined,
      malformedReport: { lastAt: undefined, since: 0 },
      video: null,
      frames: [],
      keyframes: [],
      lastDts: undefined,
      lastArrival: undefined,
      bFrames: false,
      totals: {
        frames: 0,
        keyframes: 0,
        bytes: 0,
        sequenceHeaders: 0,
        timestampJumps: 0,
        malformedFrames: 0,
        nalProblems: Object.fromEntries(NAL_PROBLEMS.map((p) => [p, 0])) as Record<NalProblem, number>,
        audioTags: 0,
        audioCodec: null,
      },
      firstKeyframeLogged: false,
      logWindow: { frames: 0, bytes: 0, startedAt: now },
    };
    record.session = session;
    this.bySession.set(sessionId, session);
    const encoder = typeof connectJson["flashVer"] === "string" ? connectJson["flashVer"] : "unknown encoder";
    this.event(record, "publish", `publish from ${remoteAddress} (${encoder})`);
  }

  private onUnpublish(sessionId: string): void {
    const session = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    if (!session || session.endedAtMs !== undefined) return;
    session.endedAtMs = this.now();
    session.publisher.endedAt = new Date(session.endedAtMs).toISOString();
    const record = this.drones.get(session.droneId);
    if (record && record.session === session) {
      const seconds = Math.round((session.endedAtMs - session.startedAtMs) / 1000);
      this.event(record, "unpublish", `publish ended after ${seconds} s (${session.totals.frames} frames)`);
    }
  }

  private onMetadata(sessionId: string, tag: FlvTag): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    try {
      const script = parseScriptTag(tag.data);
      if (!script || !isMetadataObject(script.value)) {
        session.log.warn({ name: script?.name }, "unexpected script tag");
        return;
      }
      const metadata = jsonObject(script.value);
      const changed =
        session.metadata !== null && JSON.stringify(session.metadata) !== JSON.stringify(metadata);
      const first = session.metadata === null;
      session.metadata = metadata;
      const { width, height, framerate, videocodecid, videodatarate, encoder, audiocodecid } = metadata;
      session.log.info(
        { name: script.name, width, height, framerate, videocodecid, videodatarate, encoder, audiocodecid },
        "metadata received",
      );
      if (first || changed) {
        const record = this.drones.get(session.droneId);
        const summary = [
          width !== undefined && height !== undefined ? `${String(width)}x${String(height)}` : undefined,
          framerate !== undefined ? `${String(framerate)} fps` : undefined,
          typeof encoder === "string" ? encoder : undefined,
        ]
          .filter(Boolean)
          .join(", ");
        if (record)
          this.event(
            record,
            "metadata",
            `${changed ? "metadata changed" : "metadata"}: ${summary || "no common fields"}`,
          );
      }
    } catch (err) {
      session.log.warn({ err }, "cannot decode metadata");
    }
  }

  private onVideo(sessionId: string, tag: FlvTag): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    const info = parseVideoTag(tag.data);
    if (!info) {
      session.log.warn({ size: tag.data.length }, "malformed video tag");
      return;
    }

    if (info.packetType === "sequence-header") {
      session.totals.sequenceHeaders++;
      const first = session.sequenceHeader === undefined;
      const changed = !first && !session.sequenceHeader?.equals(tag.data);
      if (!first && !changed) return;
      const before = session.video;
      session.sequenceHeader = tag.data;
      session.nalLengthSize =
        info.codec === "avc" || info.codec === "hevc"
          ? nalLengthSize(tag.data.subarray(info.payloadOffset), info.codec)
          : undefined;
      session.video = describeFormat(tag.data, info.codec, info.payloadOffset);
      session.log.info(
        { ...session.video, enhanced: info.enhanced, timestamp: tag.timestamp, changed },
        changed ? "video sequence header changed" : "video sequence header received",
      );
      const record = this.drones.get(session.droneId);
      if (record) {
        this.event(
          record,
          "sequence-header",
          changed
            ? `sequence header changed: ${formatVideo(before)} → ${formatVideo(session.video)}`
            : `sequence header: ${formatVideo(session.video)}`,
        );
      }
      return;
    }
    if (info.packetType !== "coded-frame") return;

    const now = this.now();
    const bytes = tag.data.length;
    session.totals.frames++;
    session.totals.bytes += bytes;
    session.logWindow.frames++;
    session.logWindow.bytes += bytes;
    session.frames.push({ arrival: now, bytes });
    if (compositionTimeOffset(tag.data, info) !== 0) session.bFrames = true;
    if (session.nalLengthSize !== undefined && (info.codec === "avc" || info.codec === "hevc")) {
      this.checkNal(session, tag, info.payloadOffset, isKeyframe(info), now);
    }

    if (session.lastDts !== undefined) {
      const step = tag.timestamp - session.lastDts;
      if (step < 0 || step > TIMESTAMP_JUMP_MS) {
        session.totals.timestampJumps++;
        const record = this.drones.get(session.droneId);
        if (record)
          this.event(record, "timestamp-jump", `timestamp jump ${session.lastDts} → ${tag.timestamp} ms`);
      }
    }
    session.lastDts = tag.timestamp;
    session.lastArrival = now;

    if (isKeyframe(info)) {
      session.totals.keyframes++;
      session.keyframes.push({ dts: tag.timestamp, bytes, arrival: now });
      if (!session.firstKeyframeLogged) {
        session.firstKeyframeLogged = true;
        session.log.info({ timestamp: tag.timestamp, size: bytes }, "first keyframe received");
      }
    }
    this.prune(session, now);
  }

  /**
   * Counts frames whose NAL length fields do not add up. Browsers (mpegts.js) drop the rest of
   * such a frame; stricter receivers may give up on the stream. The first one is reported at
   * once, later ones summed up at most every MALFORMED_REPORT_MS.
   */
  private checkNal(session: Session, tag: FlvTag, payloadOffset: number, key: boolean, now: number): void {
    const payload = tag.data.subarray(payloadOffset);
    const check = checkNalUnits(payload, session.nalLengthSize ?? 4);
    if (!check.problem) return;
    session.totals.malformedFrames++;
    session.totals.nalProblems[check.problem]++;
    const report = session.malformedReport;
    report.since++;
    if (report.lastAt !== undefined && now - report.lastAt < MALFORMED_REPORT_MS) return;
    const detail = {
      problem: check.problem,
      keyframe: key,
      offset: check.offset,
      payloadBytes: payload.length,
      unitsBefore: check.units,
      lengthSize: session.nalLengthSize,
      timestamp: tag.timestamp,
      total: session.totals.malformedFrames,
    };
    const where = `${check.problem} at byte ${check.offset ?? 0} of ${payload.length} in ${key ? "a keyframe" : "an inter frame"}`;
    const text =
      report.lastAt === undefined
        ? `malformed NAL units: ${where}`
        : `${report.since} malformed frames in ${Math.round((now - report.lastAt) / 1000)} s, last: ${where}`;
    session.log.warn({ ...detail, sinceLastReport: report.since }, "malformed NAL units");
    const record = this.drones.get(session.droneId);
    if (record) this.event(record, "malformed-nal", text);
    session.malformedReport = { lastAt: now, since: 0 };
  }

  private onAudio(sessionId: string, tag: FlvTag): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    session.totals.audioTags++;
    const first = tag.data[0];
    if (session.totals.audioCodec === null && first !== undefined) {
      const format = first >> 4;
      session.totals.audioCodec = AUDIO_FORMATS[format] ?? `format ${format}`;
    }
  }

  // --- measurements ---------------------------------------------------------

  private prune(session: Session, now: number): void {
    const frameCutoff = now - this.windowMs;
    let drop = 0;
    while (drop < session.frames.length && (session.frames[drop]?.arrival ?? now) < frameCutoff) drop++;
    if (drop > 0) session.frames.splice(0, drop);
    const keyCutoff = now - KEYFRAME_HISTORY_MS;
    drop = 0;
    while (drop < session.keyframes.length && (session.keyframes[drop]?.arrival ?? now) < keyCutoff) drop++;
    if (drop > 0) session.keyframes.splice(0, drop);
  }

  private measure(session: Session): StreamMeasurements {
    // A finished session keeps the values from its last moments.
    const now = session.endedAtMs ?? this.now();
    if (session.endedAtMs === undefined) this.prune(session, now);
    const frames = session.frames.filter((f) => f.arrival >= now - this.windowMs);
    const spanMs = Math.min(this.windowMs, now - session.startedAtMs);
    const seconds = spanMs / 1000;

    let maxGap: number | null = null;
    for (let i = 1; i < frames.length; i++) {
      const gap = (frames[i]?.arrival ?? 0) - (frames[i - 1]?.arrival ?? 0);
      maxGap = maxGap === null ? gap : Math.max(maxGap, gap);
    }
    // A stream that stopped arriving shows as a growing gap.
    if (session.endedAtMs === undefined && session.lastArrival !== undefined) {
      const sinceLast = now - session.lastArrival;
      maxGap = maxGap === null ? sinceLast : Math.max(maxGap, sinceLast);
    }

    const intervals: number[] = [];
    for (let i = 1; i < session.keyframes.length; i++) {
      const step = (session.keyframes[i]?.dts ?? 0) - (session.keyframes[i - 1]?.dts ?? 0);
      if (step > 0 && step < KEYFRAME_HISTORY_MS) intervals.push(step);
    }
    const keyBytes = session.keyframes.map((k) => k.bytes);

    return {
      windowSec: Math.round(seconds * 10) / 10,
      fps: seconds > 0 ? Math.round((frames.length / seconds) * 10) / 10 : null,
      kbps:
        seconds > 0 ? Math.round((frames.reduce((sum, f) => sum + f.bytes, 0) * 8) / seconds / 1000) : null,
      keyframeIntervalMs: intervals.length
        ? {
            avg: Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length),
            min: Math.min(...intervals),
            max: Math.max(...intervals),
          }
        : null,
      avgKeyframeBytes: keyBytes.length
        ? Math.round(keyBytes.reduce((a, b) => a + b, 0) / keyBytes.length)
        : null,
      maxArrivalGapMs: maxGap,
      bFrames: session.bFrames,
    };
  }

  private logSummaries(): void {
    const now = this.now();
    for (const session of this.bySession.values()) {
      const seconds = (now - session.logWindow.startedAt) / 1000;
      if (seconds <= 0) continue;
      const m = this.measure(session);
      session.log.info(
        {
          ...session.video,
          fps: Math.round((session.logWindow.frames / seconds) * 10) / 10,
          kbps: Math.round((session.logWindow.bytes * 8) / seconds / 1000),
          keyframeIntervalMs: m.keyframeIntervalMs?.avg,
          bFrames: m.bFrames,
          totalFrames: session.totals.frames,
          totalKeyframes: session.totals.keyframes,
          malformedFrames: session.totals.malformedFrames,
        },
        "stream stats",
      );
      session.logWindow = { frames: 0, bytes: 0, startedAt: now };
    }
  }

  // --- helpers --------------------------------------------------------------

  private record(droneId: string): DroneRecord {
    let record = this.drones.get(droneId);
    if (!record) {
      record = { session: undefined, events: [] };
      this.drones.set(droneId, record);
    }
    return record;
  }

  private event(record: DroneRecord, kind: DiagnosticsEventKind, text: string): void {
    record.events.unshift({ at: new Date(this.now()).toISOString(), kind, text });
    record.events.length = Math.min(record.events.length, this.maxEvents);
  }
}

/** "10.0.0.7:50000" → "10.0.0.7", "[fe80::1]:5" / "fe80::1:5" style → address without port. */
function hostOf(remoteAddress: string): string {
  const bracketed = /^\[(.+)\]:\d+$/.exec(remoteAddress);
  if (bracketed?.[1]) return bracketed[1];
  const index = remoteAddress.lastIndexOf(":");
  return index > 0 ? remoteAddress.slice(0, index) : remoteAddress;
}

function describeFormat(data: Buffer, codec: string, payloadOffset: number): VideoFormatInfo {
  const format: VideoFormatInfo = {
    codec,
    codecString: null,
    profile: null,
    level: null,
    width: null,
    height: null,
  };
  if (codec !== "avc") return format;
  try {
    const avc = parseAvcDecoderConfig(data.subarray(payloadOffset));
    return {
      ...format,
      codecString: avc.codecString,
      profile: avcProfileName(avc.profileIdc),
      level: avcLevelName(avc.levelIdc),
      width: avc.width,
      height: avc.height,
    };
  } catch {
    return format;
  }
}

function formatVideo(video: VideoFormatInfo | null): string {
  if (!video) return "unknown";
  const size = video.width && video.height ? ` ${video.width}x${video.height}` : "";
  const profile = video.profile ? ` ${video.profile}${video.level ? ` ${video.level}` : ""}` : "";
  return `${video.codec.toUpperCase()}${profile}${size}`;
}
