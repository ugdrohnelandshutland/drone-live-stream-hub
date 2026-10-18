/**
 * Records the FLV stream a player already receives into MP4 files, in the browser (ADR 0011).
 * Framework-free: fed with the player's WebSocket events (LivePlayerOptions.onStreamEvent).
 *
 * - Starts at the next keyframe, so every file opens with a picture.
 * - A new part (file) at a camera switch (new sequence header: other resolution) and after
 *   `maxPartDurationMs` / `maxPartBytes` — split at a keyframe, so no frame is lost.
 * - Reconnects: frames the server sends again (its cached GOP) are skipped; a gap in the
 *   stream (Wi-Fi, drone offline) becomes a cut in the video, not a frozen picture.
 */
import { CloseCode } from "../../shared/close-codes";
import { parseAvcDecoderConfig } from "../../shared/flv/avc";
import { compositionTimeOffset, isKeyframe, parseVideoTag } from "../../shared/flv/video";
import type { StreamEvent } from "../player/live-player";
import { FlvTagReader } from "./flv-tag-reader";
import { Mp4Writer } from "./mp4-writer";

export interface RecorderLimits {
  maxPartDurationMs: number;
  maxPartBytes: number;
  /** A larger step between two frames is a gap: the frame before it gets a normal duration. */
  maxFrameGapMs: number;
}

export const DEFAULT_LIMITS: RecorderLimits = {
  maxPartDurationMs: 10 * 60_000,
  maxPartBytes: 512 * 1024 * 1024,
  maxFrameGapMs: 1000,
};

export type PartReason = "stopped" | "limit" | "camera-switch";

export interface RecordingPart {
  blob: Blob;
  /** 1-based number of the part within the recording. */
  index: number;
  durationMs: number;
  reason: PartReason;
}

export type RecorderState =
  | "idle"
  | "waiting" // recording, but no picture yet (waiting for a keyframe)
  | "recording";

export interface RecorderProgress {
  state: RecorderState;
  /** Video recorded so far, all parts. */
  durationMs: number;
  /** Size of the current part. */
  bytes: number;
}

export interface RecorderListener {
  onPart(part: RecordingPart): void;
  /** The stream cannot be recorded (not H.264); the recording has stopped. */
  onUnsupported(): void;
}

const VIDEO_TAG = 9;
/** Frame duration until two frames have been seen (30 fps). */
const DEFAULT_FRAME_MS = 33;
/** After a reconnect, frames up to this far behind the last recorded one count as repeats. */
const REPEAT_WINDOW_MS = 10_000;

interface PendingFrame {
  data: Uint8Array<ArrayBuffer>;
  timestamp: number;
  compositionOffset: number;
  keyframe: boolean;
}

export class StreamRecorder {
  private readonly reader = new FlvTagReader();
  private listener: RecorderListener | undefined;
  private sequenceHeader: { config: Uint8Array<ArrayBuffer>; width: number; height: number } | undefined;
  private unsupported = false;

  private active = false;
  private writer: Mp4Writer | undefined;
  /** The newest frame; written once the next one tells its duration. */
  private pending: PendingFrame | undefined;
  private partIndex = 0;
  private finishedDuration = 0;
  private needKeyframe = true;
  private lastTimestamp: number | undefined;
  private frameMs = DEFAULT_FRAME_MS;

  /** Set on a new connection: the first frame decides whether the stream continues. */
  private reconnected = false;
  private lastCloseCode: number | undefined;
  private skipUntil: number | undefined;

  constructor(private readonly limits: RecorderLimits = DEFAULT_LIMITS) {}

  setListener(listener: RecorderListener | undefined): void {
    this.listener = listener;
  }

  get state(): RecorderState {
    if (!this.active) return "idle";
    return this.writer ? "recording" : "waiting";
  }

  progress(): RecorderProgress {
    return {
      state: this.state,
      durationMs: this.finishedDuration + (this.writer?.duration ?? 0),
      bytes: this.writer?.byteLength ?? 0,
    };
  }

  /** False if the current stream cannot be recorded (H.265). */
  get supported(): boolean {
    return !this.unsupported;
  }

  start(): void {
    if (this.active) return;
    if (this.unsupported) {
      this.listener?.onUnsupported();
      return;
    }
    this.active = true;
    this.partIndex = 0;
    this.finishedDuration = 0;
    this.needKeyframe = true;
    this.lastTimestamp = undefined;
    this.skipUntil = undefined;
    this.frameMs = DEFAULT_FRAME_MS;
  }

  /** Ends the recording; the last part goes to the listener. */
  stop(): void {
    if (!this.active) return;
    this.finishPart("stopped");
    this.active = false;
  }

  handle(event: StreamEvent): void {
    switch (event.type) {
      case "open":
        this.reader.reset();
        this.reconnected = true;
        return;
      case "close":
        this.lastCloseCode = event.code;
        return;
      case "data":
        for (const tag of this.reader.push(new Uint8Array(event.chunk))) {
          if (tag.type === VIDEO_TAG) this.onVideoTag(tag.timestamp, tag.body);
        }
    }
  }

  private onVideoTag(timestamp: number, body: Uint8Array): void {
    const info = parseVideoTag(body);
    if (!info) return;
    if (info.packetType === "sequence-header") {
      this.onSequenceHeader(info.codec === "avc" ? body.subarray(info.payloadOffset) : undefined);
      return;
    }
    if (info.packetType !== "coded-frame" || !this.active || !this.sequenceHeader) return;
    this.onFrame({
      data: body.slice(info.payloadOffset),
      timestamp,
      compositionOffset: compositionTimeOffset(body, info),
      keyframe: isKeyframe(info),
    });
  }

  private onSequenceHeader(config: Uint8Array | undefined): void {
    let parsed: { width: number; height: number } | undefined;
    try {
      parsed = config && parseAvcDecoderConfig(config);
    } catch {
      parsed = undefined;
    }
    if (!config || !parsed) {
      this.sequenceHeader = undefined;
      this.unsupported = true;
      if (this.active) {
        this.stop();
        this.listener?.onUnsupported();
      }
      return;
    }
    this.unsupported = false;
    const current = this.writer?.track.avcConfig;
    if (current && !sameBytes(current, config)) {
      // Camera switch: other resolution or encoder settings, so a new file.
      this.finishPart("camera-switch");
      this.needKeyframe = true;
    }
    this.sequenceHeader = { config: config.slice(), width: parsed.width, height: parsed.height };
  }

  private onFrame(frame: PendingFrame): void {
    if (this.reconnected) {
      this.reconnected = false;
      this.resync(frame);
    }
    if (this.skipUntil !== undefined) {
      if (frame.timestamp <= this.skipUntil) return;
      this.skipUntil = undefined;
    }
    if (this.needKeyframe && !frame.keyframe) return;
    this.needKeyframe = false;

    if (this.pending) this.writePending(frame.timestamp);
    const writer = this.writer;
    if (
      frame.keyframe &&
      writer &&
      (writer.duration >= this.limits.maxPartDurationMs || writer.byteLength >= this.limits.maxPartBytes)
    ) {
      this.finishPart("limit");
    }
    if (!this.writer && this.sequenceHeader) {
      const { config, width, height } = this.sequenceHeader;
      this.writer = new Mp4Writer({ avcConfig: config, width, height });
      this.partIndex++;
    }
    this.pending = frame;
    this.lastTimestamp = frame.timestamp;
  }

  /**
   * First frame after a reconnect. The server starts every connection with its cached GOP, so
   * after a short network loss the first frames are ones already recorded: skip them. After the
   * drone itself was gone (drone-offline, stream-reset) its timestamps start anew: a cut.
   */
  private resync(frame: PendingFrame): void {
    const closeCode = this.lastCloseCode;
    this.lastCloseCode = undefined;
    const last = this.lastTimestamp;
    const newSession = closeCode === CloseCode.DroneOffline || closeCode === CloseCode.StreamReset;
    if (
      !newSession &&
      last !== undefined &&
      frame.timestamp <= last &&
      last - frame.timestamp <= REPEAT_WINDOW_MS
    ) {
      this.skipUntil = last;
      return;
    }
    // Frames are missing between the last recorded one and this one: start again at a keyframe.
    this.needKeyframe = true;
  }

  /**
   * Writes the pending frame, its duration taken from the next frame's timestamp. A gap or a
   * jump back becomes one normal frame step: a cut instead of a frozen picture.
   */
  private writePending(nextTimestamp: number | undefined): void {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || !this.writer) return;
    if (nextTimestamp !== undefined) {
      const step = nextTimestamp - pending.timestamp;
      if (step > 0 && step <= this.limits.maxFrameGapMs) this.frameMs = step;
    }
    this.writer.addSample({
      data: pending.data,
      duration: this.frameMs,
      compositionOffset: pending.compositionOffset,
      keyframe: pending.keyframe,
    });
  }

  private finishPart(reason: PartReason): void {
    this.writePending(undefined);
    const writer = this.writer;
    this.writer = undefined;
    if (!writer || writer.sampleCount === 0) return;
    this.finishedDuration += writer.duration;
    this.listener?.onPart({
      blob: writer.finish(),
      index: this.partIndex,
      durationMs: writer.duration,
      reason,
    });
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
