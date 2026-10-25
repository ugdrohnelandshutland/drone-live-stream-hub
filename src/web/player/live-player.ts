/**
 * The only module that talks to mpegts.js. Plays one drone's FLV-over-WebSocket stream with
 * low-latency settings and recovers on its own: close codes from the server decide how.
 */
import mpegts from "mpegts.js";
import { CloseCode } from "../../shared/close-codes";

export type PlayerStatus =
  | "connecting" // WebSocket opening
  | "waiting" // connected, no picture yet (drone offline or waiting for a keyframe)
  | "playing"
  | "stalled" // was playing, no new frame for a while
  | "offline" // server reported drone-offline, reconnecting
  | "error" // network/player error, retrying with backoff
  | "unknown-drone"
  | "paused" // an admin paused this device (ADR 0012); the page resumes on the SSE event
  | "unsupported";

/** Latency knobs (seconds), overridable for field tuning. */
export interface LatencyTuning {
  /** liveSync: play faster when the buffer exceeds `syncMax`, until it is down to `syncTarget`. */
  syncTarget: number;
  syncMax: number;
  syncRate: number;
  /** Latency chasing: seek when the buffer exceeds `chaseMax`, keeping `chaseMinRemain`. */
  chaseMax: number;
  chaseMinRemain: number;
}

/**
 * Measured on the dev PC (docs/milestone-2.md): ~170 ms average glass-to-glass at 1080p30.
 * Smaller values gave no further gain but more dropped frames. Re-check with the chaos
 * proxy (milestone 4): a small buffer is more sensitive to Wi-Fi jitter.
 */
export const DEFAULT_TUNING: LatencyTuning = {
  syncTarget: 0.08,
  syncMax: 0.15,
  syncRate: 1.1,
  chaseMax: 0.4,
  chaseMinRemain: 0.05,
};

/**
 * "keyframes": the server sends only each keyframe and its follower (data saver for overview
 * tiles, ADR 0009), so a new picture arrives every 1–2 s. The player then waits longer before
 * calling the picture stalled, and jumps straight to the newest picture: the follower of the
 * previous keyframe gets a duration of a whole keyframe interval, playing it would show an old
 * picture until the next one.
 */
export type StreamMode = "full" | "keyframes";

/** What the player's WebSocket receives, for consumers of the raw stream (recording). */
export type StreamEvent =
  | { type: "open" } // a new connection: FLV header, cached GOP, then live tags
  | { type: "data"; chunk: ArrayBuffer } // whole FLV tags
  | { type: "close"; code: number };

export interface LivePlayerOptions {
  video: HTMLVideoElement;
  url: string;
  mode?: StreamMode;
  tuning?: Partial<LatencyTuning>;
  onStatus: (status: PlayerStatus) => void;
  /** Called for every presented frame (requestVideoFrameCallback). */
  onFrame?: (metadata: VideoFrameCallbackMetadata) => void;
  /** Every WebSocket event of the current player; not called for an aborted socket. */
  onStreamEvent?: ((event: StreamEvent) => void) | undefined;
}

export function isLivePlaybackSupported(): boolean {
  return mpegts.getFeatureList().mseLivePlayback;
}

/**
 * Latency first (product decision): no stash buffer, start right away, and keep the live edge
 * close by playing slightly faster (liveSync) or, if far behind, by seeking (latency chasing).
 *
 * Seeking is ours (LivePlayer.chase), not mpegts.js': its chaser seeks to the live edge as soon
 * as the cached GOP arrives, before a single frame is shown, so the browser first has to decode
 * up to a whole GOP (2 s) in the dark. Ours waits for the first frame — the keyframe appears at
 * once, then the picture jumps to live.
 */
const PLAYER_CONFIG: Partial<mpegts.Config> = {
  enableWorker: false,
  enableStashBuffer: false,
  lazyLoad: false,
  deferLoadAfterSourceOpen: false,
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 10,
  autoCleanupMinBackwardDuration: 5,
  liveBufferLatencyChasing: false,
  liveSync: true,
};

function tuningConfig(tuning: LatencyTuning): Partial<mpegts.Config> {
  return {
    liveSyncMaxLatency: tuning.syncMax,
    liveSyncTargetLatency: tuning.syncTarget,
    liveSyncPlaybackRate: tuning.syncRate,
  };
}

/** Without a new frame for this long, the picture counts as stalled; later the player restarts. */
const STALL_LIMITS: Record<StreamMode, { stallAfterMs: number; restartAfterMs: number }> = {
  full: { stallAfterMs: 2000, restartAfterMs: 8000 },
  keyframes: { stallAfterMs: 6000, restartAfterMs: 20_000 },
};

/** Keyframes mode: seek as soon as more than a frame is buffered, to just before its end. */
const KEYFRAME_CHASE: Pick<LatencyTuning, "chaseMax" | "chaseMinRemain"> = {
  chaseMax: 0.1,
  chaseMinRemain: 0.01,
};
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
const UNKNOWN_DRONE_RETRY_MS = 30_000;
/** Paused: the page restarts the player on release; this only covers a lost SSE event. */
const PAUSED_RETRY_MS = 30_000;

interface LoaderEvents {
  onOpen: () => void;
  onClose: (code: number) => void;
  onStream: (event: StreamEvent) => void;
}

/**
 * WebSocket loader for mpegts.js. The built-in one hides the close code, which we need to
 * tell "drone offline" from "stream reset" from network errors.
 */
function createLoaderClass(events: LoaderEvents): mpegts.CustomLoaderConstructor {
  return class DroneWebSocketLoader extends mpegts.BaseLoader {
    private ws: WebSocket | undefined;
    private received = 0;
    private aborted = false;

    constructor() {
      super("drone-websocket-loader");
      this._needStash = false;
    }

    override open(dataSource: mpegts.MediaSegment): void {
      const ws = new WebSocket(dataSource.url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      this._status = mpegts.LoaderStatus.kConnecting;
      ws.onopen = () => {
        this._status = mpegts.LoaderStatus.kBuffering;
        events.onStream({ type: "open" });
        events.onOpen();
      };
      ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const chunk = event.data;
        events.onStream({ type: "data", chunk });
        const byteStart = this.received;
        this.received += chunk.byteLength;
        this.onDataArrival?.(chunk, byteStart, this.received);
      };
      ws.onclose = (event) => {
        if (this.aborted) return;
        this._status = mpegts.LoaderStatus.kComplete;
        events.onStream({ type: "close", code: event.code });
        events.onClose(event.code);
      };
      // An error is always followed by close, which carries the code.
      ws.onerror = () => undefined;
    }

    override abort(): void {
      this.aborted = true;
      const ws = this.ws;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) ws.close();
      this.ws = undefined;
      this._status = mpegts.LoaderStatus.kComplete;
    }

    override destroy(): void {
      if (this.ws) this.abort();
      super.destroy();
    }
  };
}

export class LivePlayer {
  private player: mpegts.Player | undefined;
  private generation = 0;
  private status: PlayerStatus | undefined;
  private backoffMs = MIN_BACKOFF_MS;
  private restartTimer: number | undefined;
  private watchdog: number | undefined;
  private lastFrameAt = 0;
  /** A frame of the current mpegts player was presented; only then chase the live edge. */
  private shownFrame = false;
  private hiddenSince: number | undefined;
  private destroyed = false;
  private removeFrameFallback: (() => void) | undefined;

  constructor(private readonly options: LivePlayerOptions) {}

  start(): void {
    if (!isLivePlaybackSupported()) {
      this.setStatus("unsupported");
      return;
    }
    const { video } = this.options;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    // Required by WebKit's ManagedMediaSource (iPadOS) unless an AirPlay alternative exists.
    video.disableRemotePlayback = true;
    this.watchFrames();
    this.watchdog = window.setInterval(() => this.checkStall(), 500);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.createPlayer();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.restartTimer);
    window.clearInterval(this.watchdog);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    // The video element may outlive this player (React reuses it for the next one).
    this.removeFrameFallback?.();
    this.teardownPlayer();
  }

  /** Recreate the player now (e.g. after a stream reset). */
  restart(delayMs = 0): void {
    if (this.destroyed) return;
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => this.createPlayer(), delayMs);
  }

  private setStatus(status: PlayerStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus(status);
  }

  private createPlayer(): void {
    if (this.destroyed) return;
    this.teardownPlayer();
    const generation = ++this.generation;
    const current = () => generation === this.generation && !this.destroyed;
    this.shownFrame = false;

    const Loader = createLoaderClass({
      onOpen: () => {
        if (current()) this.setStatus("waiting");
      },
      onClose: (code) => {
        if (current()) this.handleClose(code);
      },
      onStream: (event) => {
        if (current()) this.options.onStreamEvent?.(event);
      },
    });
    const player = mpegts.createPlayer(
      { type: "flv", isLive: true, url: this.options.url, hasAudio: false, hasVideo: true },
      {
        ...PLAYER_CONFIG,
        ...tuningConfig(this.tuning),
        // Pictures 1–2 s apart: our seeking keeps the live edge, faster playback cannot help.
        ...(this.mode === "keyframes" && { liveSync: false }),
        customLoader: Loader,
      },
    );
    player.on(mpegts.Events.ERROR, (type: string, details: string) => {
      if (!current()) return;
      console.warn("player error", type, details);
      this.setStatus("error");
      this.restartWithBackoff();
    });
    this.player = player;
    this.setStatus("connecting");
    player.attachMediaElement(this.options.video);
    player.load();
    const playing = player.play();
    if (playing instanceof Promise) playing.catch(() => undefined); // muted autoplay; retried below
  }

  private teardownPlayer(): void {
    const player = this.player;
    this.player = undefined;
    if (!player) return;
    try {
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    } catch (err) {
      console.warn("player teardown failed", err);
    }
  }

  private handleClose(code: number): void {
    switch (code) {
      case CloseCode.DroneOffline:
        // The server keeps a new socket open until the drone is back, so reconnect at once.
        this.setStatus("offline");
        this.restart(250);
        return;
      case CloseCode.StreamReset:
        this.restart(0);
        return;
      case CloseCode.Paused:
        this.setStatus("paused");
        this.restart(PAUSED_RETRY_MS);
        return;
      case CloseCode.UnknownDrone:
        this.setStatus("unknown-drone");
        this.restart(UNKNOWN_DRONE_RETRY_MS);
        return;
      case CloseCode.ViewerTooSlow:
        this.setStatus("error");
        this.restart(1000);
        return;
      default:
        this.setStatus("error");
        this.restartWithBackoff();
    }
  }

  private restartWithBackoff(): void {
    this.restart(this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private watchFrames(): void {
    const { video } = this.options;
    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (this.destroyed) return;
      this.onPresented();
      this.options.onFrame?.(metadata);
      video.requestVideoFrameCallback(onFrame);
    };
    // Missing in older WebKit; the DOM typings assume it always exists.
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(onFrame);
    } else {
      // Fallback: treat currentTime progress as frames.
      let lastTime = -1;
      const onTimeUpdate = () => {
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          this.onPresented();
        }
      };
      video.addEventListener("timeupdate", onTimeUpdate);
      this.removeFrameFallback = () => video.removeEventListener("timeupdate", onTimeUpdate);
    }
  }

  private onPresented(): void {
    this.lastFrameAt = performance.now();
    this.backoffMs = MIN_BACKOFF_MS;
    if (!this.player) return;
    this.setStatus("playing");
    this.shownFrame = true;
    this.chase();
  }

  /** Far behind the live edge (cached GOP, Wi-Fi hiccup): jump forward instead of crawling. */
  private chase(): void {
    const { video } = this.options;
    if (!this.shownFrame || video.seeking || video.buffered.length === 0) return;
    const { chaseMax, chaseMinRemain } = this.tuning;
    const end = video.buffered.end(video.buffered.length - 1);
    if (end - video.currentTime > chaseMax) video.currentTime = end - chaseMinRemain;
  }

  private get mode(): StreamMode {
    return this.options.mode ?? "full";
  }

  private get tuning(): LatencyTuning {
    const tuning = { ...DEFAULT_TUNING, ...this.options.tuning };
    return this.mode === "keyframes" ? { ...tuning, ...KEYFRAME_CHASE } : tuning;
  }

  private checkStall(): void {
    if (document.visibilityState !== "visible") return;
    const { video } = this.options;
    if (video.paused && this.status === "playing") void video.play().catch(() => undefined);
    const sinceFrame = performance.now() - this.lastFrameAt;
    const { stallAfterMs, restartAfterMs } = STALL_LIMITS[this.mode];
    if (this.status === "playing" && sinceFrame > stallAfterMs) this.setStatus("stalled");
    if (this.status === "stalled" && sinceFrame > restartAfterMs) {
      this.lastFrameAt = performance.now(); // one restart per stall period
      this.restart(0);
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.hiddenSince = performance.now();
    } else if (this.hiddenSince !== undefined) {
      // After a while in the background the buffer is stale; jump back to the live edge.
      if (performance.now() - this.hiddenSince > 3000) this.restart(0);
      this.hiddenSince = undefined;
    }
  };
}
