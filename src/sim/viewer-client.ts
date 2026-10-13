import { EventEmitter } from "node:events";
import { describeSequenceHeader } from "../server/flv/describe.js";
import { FlvTagType } from "../server/flv/types.js";
import { isKeyframe, parseVideoTag } from "../server/flv/video.js";
import { CloseCode } from "../shared/close-codes.js";
import { FlvViewer, type ViewerTag } from "./flv-viewer.js";

export interface ViewerMetrics {
  connects: number;
  closes: { code: number; atMs: number }[];
  /** Per connection that got a picture: connect → first keyframe. */
  timeToFirstKeyframeMs: number[];
  videoTags: number;
  bytes: number;
  /** Gaps between video tags (while streaming) longer than the stall threshold. */
  stalls: { atMs: number; gapMs: number }[];
  maxGapMs: number;
  /** Resolutions seen in sequence headers, in order. */
  resolutions: string[];
  /** Video timestamps going backwards within one connection (must stay 0). */
  timestampRegressions: number;
}

export interface ReconnectingViewerOptions {
  /** e.g. ws://127.0.0.1:8080 */
  baseUrl: string;
  droneId: string;
  stallThresholdMs?: number;
}

/**
 * Headless viewer with the same reconnect rules as the browser player (src/web/player/live-player.ts):
 * 4000 → reconnect after 250 ms, 4001 → at once, 4004 → after 30 s, 4008 → after 1 s,
 * anything else → backoff 0.5 → 10 s. Records metrics for scenario tests.
 */
export class ReconnectingViewer extends EventEmitter {
  readonly metrics: ViewerMetrics = {
    connects: 0,
    closes: [],
    timeToFirstKeyframeMs: [],
    videoTags: 0,
    bytes: 0,
    stalls: [],
    maxGapMs: 0,
    resolutions: [],
    timestampRegressions: 0,
  };
  private viewer: FlvViewer | undefined;
  private timer: NodeJS.Timeout | undefined;
  private backoffMs = 500;
  private stopped = false;
  private readonly startedAt = Date.now();
  /** True after the first keyframe of the current connection. */
  playing = false;

  constructor(private readonly options: ReconnectingViewerOptions) {
    super();
  }

  get url(): string {
    return `${this.options.baseUrl}/ws/live/${encodeURIComponent(this.options.droneId)}`;
  }

  start(): this {
    this.connect();
    return this;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.viewer?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const viewer = new FlvViewer(this.url);
    viewer.recordTags = false;
    this.viewer = viewer;
    this.metrics.connects++;
    this.playing = false;
    const connectedAt = Date.now();
    let lastVideoAt: number | undefined;
    let lastTimestamp = -1;

    viewer.on("tag", (tag: ViewerTag) => {
      this.metrics.bytes += tag.data.length;
      if (tag.type !== FlvTagType.Video) return;
      const resolution = describeSequenceHeader(tag.data);
      if (resolution) {
        this.metrics.resolutions.push(`${resolution.width ?? "?"}x${resolution.height ?? "?"}`);
        return;
      }
      const info = parseVideoTag(tag.data);
      if (!this.playing) {
        if (!info || !isKeyframe(info)) return;
        this.playing = true;
        this.backoffMs = 500;
        this.metrics.timeToFirstKeyframeMs.push(tag.receivedAt - connectedAt);
        this.emit("playing");
      }
      this.metrics.videoTags++;
      if (tag.timestamp < lastTimestamp) this.metrics.timestampRegressions++;
      lastTimestamp = tag.timestamp;
      if (lastVideoAt !== undefined) {
        const gap = tag.receivedAt - lastVideoAt;
        this.metrics.maxGapMs = Math.max(this.metrics.maxGapMs, gap);
        if (gap > (this.options.stallThresholdMs ?? 1000)) {
          this.metrics.stalls.push({ atMs: tag.receivedAt - this.startedAt, gapMs: gap });
        }
      }
      lastVideoAt = tag.receivedAt;
    });
    viewer.on("error", () => undefined); // a close always follows
    viewer.on("close", (code: number) => {
      this.playing = false;
      if (this.stopped) return; // our own stop() is not a server close
      this.metrics.closes.push({ code, atMs: Date.now() - this.startedAt });
      this.emit("closed", code);
      this.timer = setTimeout(() => this.connect(), this.delayFor(code));
    });
    viewer.connect();
  }

  private delayFor(code: number): number {
    switch (code) {
      case CloseCode.DroneOffline:
        return 250;
      case CloseCode.StreamReset:
        return 0;
      case CloseCode.UnknownDrone:
        return 30_000;
      case CloseCode.ViewerTooSlow:
        return 1000;
      default: {
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
        return delay;
      }
    }
  }
}
