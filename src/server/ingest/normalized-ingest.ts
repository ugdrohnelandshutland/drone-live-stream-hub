import type { FlvTag } from "../flv/types.js";
import type { Logger } from "../logger.js";
import { checkNalUnits, nalLengthSize } from "../../shared/flv/nal.js";
import { compositionTimeOffset, parseVideoTag, type VideoTagInfo } from "../../shared/flv/video.js";
import { TimestampSmoother } from "./timestamp-smoother.js";
import type { IngestAdapter, IngestEvents } from "./types.js";

interface Session {
  droneId: string;
  smoother: TimestampSmoother;
  /** NAL length field size from the latest sequence header. */
  lengthSize: number;
  droppedEmpty: number;
}

/**
 * What viewers get from a publisher, tidied up (ADR 0013): video timestamps evened out and
 * coded frames without any NAL unit dropped (Pilot 2 sends one every few seconds; strict
 * parsers such as the virtual camera app fail on it). The bytes of every other tag stay as
 * they are. Wraps the real ingest for the delivery side only: the registry, diagnostics and
 * raw captures keep listening to the real one.
 */
export class NormalizedIngest implements IngestAdapter {
  private readonly listeners: { [E in keyof IngestEvents]: IngestEvents[E][] } = {
    publish: [],
    videoTag: [],
    audioTag: [],
    metadata: [],
    unpublish: [],
  };
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly inner: IngestAdapter,
    private readonly logger: Logger,
  ) {
    inner.on("publish", (request) => {
      const accepted = this.listeners.publish.every((cb) => cb(request));
      if (accepted) {
        this.sessions.set(request.sessionId, {
          droneId: request.streamKey,
          smoother: new TimestampSmoother(),
          lengthSize: 4,
          droppedEmpty: 0,
        });
      }
      return accepted;
    });
    inner.on("videoTag", (sessionId, tag) => {
      const out = this.normalize(sessionId, tag);
      if (out) for (const cb of this.listeners.videoTag) cb(sessionId, out);
    });
    inner.on("audioTag", (sessionId, tag) => {
      for (const cb of this.listeners.audioTag) cb(sessionId, tag);
    });
    inner.on("metadata", (sessionId, tag) => {
      for (const cb of this.listeners.metadata) cb(sessionId, tag);
    });
    inner.on("unpublish", (sessionId) => {
      this.ended(sessionId);
      for (const cb of this.listeners.unpublish) cb(sessionId);
    });
  }

  get port(): number {
    return this.inner.port;
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  on<E extends keyof IngestEvents>(event: E, cb: IngestEvents[E]): void {
    this.listeners[event].push(cb);
  }

  disconnect(sessionId: string): void {
    this.inner.disconnect(sessionId);
  }

  private normalize(sessionId: string, tag: FlvTag): FlvTag | undefined {
    const session = this.sessions.get(sessionId);
    const info = parseVideoTag(tag.data);
    if (!session || !info) return tag;

    if (info.packetType === "sequence-header") {
      if (info.codec === "avc" || info.codec === "hevc") {
        session.lengthSize = nalLengthSize(tag.data.subarray(info.payloadOffset), info.codec) ?? 4;
      }
      return this.retimed(tag, session.smoother.other(tag.timestamp));
    }
    if (info.packetType !== "coded-frame" || (info.codec !== "avc" && info.codec !== "hevc")) {
      return this.retimed(tag, session.smoother.other(tag.timestamp));
    }

    const content = frameContent(tag.data, info, session.lengthSize);
    if (content === "empty") {
      session.droppedEmpty++;
      return undefined;
    }
    const timestamp =
      content === "picture"
        ? session.smoother.picture(tag.timestamp, compositionTimeOffset(tag.data, info))
        : session.smoother.other(tag.timestamp);
    return this.retimed(tag, timestamp);
  }

  private retimed(tag: FlvTag, timestamp: number): FlvTag {
    return timestamp === tag.timestamp ? tag : { ...tag, timestamp };
  }

  private ended(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const { resyncs, maxDeviationMs } = session.smoother.stats;
    this.logger.info(
      { droneId: session.droneId, sessionId, droppedEmpty: session.droppedEmpty, resyncs, maxDeviationMs },
      "timestamp smoothing summary",
    );
  }
}

/**
 * - `empty`: no NAL unit at all (no payload, or a first length field of 0).
 * - `no-picture`: only non-picture NAL units such as SEI.
 * - `picture`: picture data, or a structure that cannot be read (then treated like a picture,
 *   so nothing is lost).
 */
function frameContent(
  data: Buffer,
  info: VideoTagInfo,
  lengthSize: number,
): "empty" | "no-picture" | "picture" {
  const payload = data.subarray(info.payloadOffset);
  const check = checkNalUnits(payload, lengthSize);
  if (check.units === 0 && (payload.length === 0 || check.problem === "zero-length")) return "empty";
  if (check.problem !== undefined) return "picture";
  let offset = 0;
  for (let i = 0; i < check.units; i++) {
    let length = 0;
    for (let b = 0; b < lengthSize; b++) length = length * 256 + (payload[offset + b] ?? 0);
    const header = payload[offset + lengthSize] ?? 0;
    // AVC: types 1–5 are slices; HEVC: types 0–31 are VCL units.
    const picture = info.codec === "avc" ? (header & 0x1f) >= 1 && (header & 0x1f) <= 5 : header >> 1 < 32;
    if (picture) return "picture";
    offset += lengthSize + length;
  }
  return "no-picture";
}
