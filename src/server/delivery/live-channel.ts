import { CloseCode, CloseReason } from "../../shared/close-codes.js";
import { createFlvHeader, encodeFlvTag } from "../flv/writer.js";
import type { FlvTag } from "../flv/types.js";
import { GopCache } from "../gop-cache/gop-cache.js";
import type { Logger } from "../logger.js";

/** Transport-independent view of one viewer connection (a WebSocket in production). */
export interface ViewerConnection {
  readonly id: string;
  /** Bytes queued but not yet written to the network. */
  readonly bufferedAmount: number;
  send(data: Buffer): void;
  close(code: number, reason: string): void;
}

export interface LiveChannelOptions {
  maxGopBytes: number;
  /** Above this many queued bytes, drop frames for the viewer until the next keyframe. */
  softBufferBytes: number;
  /** Above this many queued bytes, close the viewer with 4008. */
  hardBufferBytes: number;
  /** Close the viewer with 4008 if it stays congested this long. */
  maxCongestionMs: number;
}

/**
 * What a viewer receives. "keyframes" (data saver for overview tiles) gets each keyframe and
 * the frame right after it. That frame matters: mpegts.js holds back the newest frame until the
 * next one arrives (it needs the next timestamp for the duration), so with keyframes alone
 * every picture would appear one keyframe interval late. The follower decodes from the
 * keyframe just sent, so nothing is ever decoded against a missing reference.
 */
export type ViewerMode = "full" | "keyframes";

/** Frames per GOP a "keyframes" viewer gets: the keyframe and its follower. */
const KEYFRAME_MODE_TAGS = 2;

interface Viewer {
  conn: ViewerConnection;
  mode: ViewerMode;
  /** waiting: connected, nothing sent yet (drone offline or no keyframe yet). */
  state: "waiting" | "streaming";
  skipUntilKeyframe: boolean;
  congestedSince: number | undefined;
  droppedTags: number;
  /**
   * Size of the start snapshot (cached GOP) while it is still draining. It is added to both
   * limits: a 2 s GOP at 6 Mbit/s is up to 1.5 MB, so without this every viewer joining late
   * in a GOP counted as congested and lost frames until the next keyframe.
   */
  startupBytes: number;
}

const FLV_HEADER = createFlvHeader({ audio: false, video: true });

export interface ChannelStats {
  live: boolean;
  sessionId: string | undefined;
  viewers: number;
  waitingViewers: number;
  keyframeViewers: number;
  cacheBytes: number;
  gopTags: number;
  gopOverflows: number;
  slowViewerClosures: number;
  /** Tags not sent to congested viewers since start. */
  droppedTags: number;
}

/**
 * Fan-out of one drone's stream to its viewers. Viewers that connect while the drone is
 * offline stay connected (state "waiting") and start receiving at the next keyframe.
 */
export class LiveChannel {
  private readonly cache: GopCache;
  private readonly viewers = new Map<string, Viewer>();
  private currentSessionId: string | undefined;
  private slowViewerClosures = 0;
  private droppedTags = 0;
  private notifiedViewerCount = 0;
  /** Position of the latest video tag in its GOP (0 = keyframe); -1 before the first keyframe. */
  private gopIndex = -1;

  constructor(
    readonly droneId: string,
    private readonly options: LiveChannelOptions,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
    private readonly onViewerCount: (count: number) => void = () => undefined,
  ) {
    this.cache = new GopCache({ maxGopBytes: options.maxGopBytes });
  }

  get live(): boolean {
    return this.currentSessionId !== undefined;
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  stats(): ChannelStats {
    let waiting = 0;
    let keyframeViewers = 0;
    for (const v of this.viewers.values()) {
      if (v.state === "waiting") waiting++;
      if (v.mode === "keyframes") keyframeViewers++;
    }
    return {
      live: this.live,
      sessionId: this.currentSessionId,
      viewers: this.viewers.size,
      waitingViewers: waiting,
      keyframeViewers,
      cacheBytes: this.cache.byteSize,
      gopTags: this.cache.gopLength,
      gopOverflows: this.cache.gopOverflows,
      slowViewerClosures: this.slowViewerClosures,
      droppedTags: this.droppedTags,
    };
  }

  // --- publisher side -------------------------------------------------------

  publish(sessionId: string): void {
    if (this.currentSessionId !== undefined) {
      this.logger.info(
        { droneId: this.droneId, sessionId, replacedSessionId: this.currentSessionId },
        "publisher replaced",
      );
      this.closeStreaming(CloseCode.StreamReset);
    }
    this.cache.clear();
    this.gopIndex = -1;
    this.currentSessionId = sessionId;
  }

  unpublish(sessionId: string): void {
    if (sessionId !== this.currentSessionId) return; // a replaced session ending late
    this.currentSessionId = undefined;
    this.cache.clear();
    this.gopIndex = -1;
    this.closeStreaming(CloseCode.DroneOffline);
  }

  metadata(sessionId: string, tag: FlvTag): void {
    if (sessionId !== this.currentSessionId) return;
    this.cache.setMetadata(tag);
    this.broadcast(encodeFlvTag(tag), false, true);
  }

  videoTag(sessionId: string, tag: FlvTag): void {
    if (sessionId !== this.currentSessionId) return;
    const result = this.cache.addVideoTag(tag);
    switch (result.kind) {
      case "sequence-header":
        if (result.changed) {
          this.logger.info(
            { droneId: this.droneId, sessionId },
            "sequence header changed, resetting viewers",
          );
          this.closeStreaming(CloseCode.StreamReset);
        }
        return;
      case "keyframe":
        // Streaming viewers get the keyframe first; waiting viewers then get a snapshot that
        // already starts with it.
        this.gopIndex = 0;
        this.broadcast(encodeFlvTag(tag), true);
        this.attachWaiting();
        return;
      case "frame":
        if (this.gopIndex >= 0) this.gopIndex++;
        this.broadcast(encodeFlvTag(tag), false);
        return;
      case "invalid":
        this.logger.warn(
          { droneId: this.droneId, sessionId, size: tag.data.length },
          "dropping malformed video tag",
        );
        return;
      case "other":
        return;
    }
  }

  // --- viewer side ----------------------------------------------------------

  addViewer(conn: ViewerConnection, mode: ViewerMode = "full"): void {
    const viewer: Viewer = {
      conn,
      mode,
      state: "waiting",
      skipUntilKeyframe: false,
      congestedSince: undefined,
      droppedTags: 0,
      startupBytes: 0,
    };
    this.viewers.set(conn.id, viewer);
    if (this.live && this.cache.ready) this.startViewer(viewer);
    this.notifyViewerCount();
  }

  removeViewer(id: string): void {
    this.viewers.delete(id);
    this.notifyViewerCount();
  }

  /** Closes everyone (service shutdown). */
  closeAll(code: number, reason: string): void {
    for (const viewer of this.viewers.values()) viewer.conn.close(code, reason);
    this.viewers.clear();
    this.notifyViewerCount();
  }

  private notifyViewerCount(): void {
    if (this.viewers.size === this.notifiedViewerCount) return;
    this.notifiedViewerCount = this.viewers.size;
    this.onViewerCount(this.viewers.size);
  }

  private startViewer(viewer: Viewer): void {
    const gopTags = viewer.mode === "keyframes" ? KEYFRAME_MODE_TAGS : Infinity;
    const snapshot = Buffer.concat([FLV_HEADER, ...this.cache.snapshot(gopTags).map(encodeFlvTag)]);
    viewer.state = "streaming";
    viewer.startupBytes = snapshot.length;
    viewer.conn.send(snapshot);
  }

  /** Called on a keyframe, after it was cached: waiting viewers get header + snapshot. */
  private attachWaiting(): void {
    for (const viewer of this.viewers.values()) {
      if (viewer.state === "waiting") this.startViewer(viewer);
    }
  }

  private broadcast(data: Buffer, keyframe: boolean, essential = false): void {
    const now = this.now();
    const forKeyframeViewers = essential || (this.gopIndex >= 0 && this.gopIndex < KEYFRAME_MODE_TAGS);
    for (const viewer of this.viewers.values()) {
      if (viewer.state !== "streaming") continue;
      if (viewer.mode === "keyframes" && !forKeyframeViewers) continue;
      this.deliver(viewer, data, keyframe, essential, now);
    }
  }

  private deliver(viewer: Viewer, data: Buffer, keyframe: boolean, essential: boolean, now: number): void {
    const buffered = viewer.conn.bufferedAmount;
    if (viewer.startupBytes > 0 && buffered <= this.options.softBufferBytes) viewer.startupBytes = 0;
    if (buffered > this.options.hardBufferBytes + viewer.startupBytes) {
      this.closeSlow(viewer, buffered);
      return;
    }
    if (buffered > this.options.softBufferBytes + viewer.startupBytes) {
      viewer.congestedSince ??= now;
      if (now - viewer.congestedSince > this.options.maxCongestionMs) {
        this.closeSlow(viewer, buffered);
        return;
      }
      if (!essential) {
        viewer.skipUntilKeyframe = true;
        viewer.droppedTags++;
        this.droppedTags++;
        return;
      }
    } else {
      viewer.congestedSince = undefined;
    }
    if (viewer.skipUntilKeyframe && !essential) {
      if (!keyframe) {
        viewer.droppedTags++;
        this.droppedTags++;
        return;
      }
      viewer.skipUntilKeyframe = false;
    }
    viewer.conn.send(data);
  }

  private closeSlow(viewer: Viewer, buffered: number): void {
    this.logger.warn(
      { droneId: this.droneId, viewerId: viewer.conn.id, buffered, droppedTags: viewer.droppedTags },
      "closing slow viewer",
    );
    this.slowViewerClosures++;
    this.viewers.delete(viewer.conn.id);
    viewer.conn.close(CloseCode.ViewerTooSlow, CloseReason[CloseCode.ViewerTooSlow]);
    this.notifyViewerCount();
  }

  private closeStreaming(code: CloseCode): void {
    for (const viewer of [...this.viewers.values()]) {
      if (viewer.state !== "streaming") continue;
      this.viewers.delete(viewer.conn.id);
      viewer.conn.close(code, CloseReason[code]);
    }
    this.notifyViewerCount();
  }
}
