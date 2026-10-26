import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Logger } from "../server/logger.js";
import { TIMECODE_BITS, TIMECODE_CELLS, timecodeLayout } from "../shared/timecode.js";
import { ffmpegBinary, quoteFilterPath } from "./ffmpeg.js";
import { FlvSplicer } from "./flv-splicer.js";
import { resolutionFor, type CameraMode, type StreamProfile } from "./profiles.js";

export interface DroneStreamOptions {
  id: string;
  /** RTMP URL, or "pipe:1" to write FLV to stdout (inline camera switching). */
  output: string;
  profile: StreamProfile;
  camera: CameraMode;
  /** Background/header colour as 0xRRGGBB. */
  colour: string;
  fontFile: string;
  overlayTextFile: string;
  /** Add an AAC sine track (to verify that the service drops audio). */
  audio: boolean;
  /** Loop this video file instead of the test pattern. */
  source?: string;
}

/**
 * Overlay text with drawtext expansions. The frame pts is the wall clock (set via
 * `setpts=RTCTIME`), so `t` is epoch seconds and the clock shows when the frame was generated.
 */
export function overlayText(id: string, camera: CameraMode, width: number, height: number): string {
  return [
    `${id.toUpperCase()}   ${camera.toUpperCase()}   ${width}x${height}`,
    "Frame %{frame_num}   %{pts:localtime:0:%H\\:%M\\:%S}.%{eif:mod(floor(t*1000),1000):d:3}",
    "",
  ].join("\n");
}

function cameraChain(camera: CameraMode, width: number, height: number, fps: number, colour: string): string {
  switch (camera) {
    case "wide": {
      // Moving pattern on the drone's own background colour.
      const pw = Math.round((width * 0.7) / 2) * 2;
      const ph = Math.round((height * 0.7) / 2) * 2;
      return (
        `color=c=${colour}:s=${width}x${height}:r=${fps}[bg];` +
        `testsrc2=s=${pw}x${ph}:r=${fps}[pat];` +
        `[bg][pat]overlay=x=(W-w)/2:y=(H-h)*0.6:shortest=1`
      );
    }
    case "zoom":
      // Cropped centre of the pattern, scaled up: looks "zoomed in".
      return `testsrc2=s=${width}x${height}:r=${fps},crop=iw/3:ih/3,scale=${width}:${height}:flags=neighbor`;
    case "thermal":
      return `testsrc2=s=${width}x${height}:r=${fps},hue=s=0,pseudocolor=p=inferno`;
  }
}

/**
 * drawbox filters that paint the timecode strip (src/shared/timecode.ts). Must run while the
 * frame pts is the wall clock, so `t` is epoch seconds. Each data cell is enabled when its bit
 * of round(t * 1000) is set; the last cell is the even parity of the data bits.
 */
export function timecodeFilters(width: number, height: number): string {
  const { cell, x, y } = timecodeLayout(width, height);
  const bit = (k: number) => `mod(floor((t*1000+0.5)/${2 ** k}),2)`;
  const box = (index: number, enable?: string) =>
    `drawbox=x=${x + index * cell}:y=${y}:w=${cell}:h=${cell}:color=white:t=fill` +
    (enable ? `:enable='${enable}'` : "");
  const filters = [`drawbox=x=${x}:y=${y}:w=${TIMECODE_CELLS * cell}:h=${cell}:color=black:t=fill`, box(0)];
  const bits: string[] = [];
  for (let k = 0; k < TIMECODE_BITS; k++) {
    bits.push(bit(k));
    filters.push(box(2 + k, bit(k)));
  }
  filters.push(box(2 + TIMECODE_BITS, `mod(${bits.join("+")},2)`));
  return filters.join(",");
}

/** Builds the encoder argument list for one simulated drone. Pure function, unit-tested. */
export function buildFfmpegArgs(options: DroneStreamOptions): string[] {
  const { profile, camera, colour } = options;
  const { width, height } = resolutionFor(profile, camera);
  const fps = profile.fps;
  const gop = Math.max(1, Math.round(profile.keyframeIntervalSec * fps));
  const kbps = profile.bitrateKbps;
  const toStdout = options.output === "pipe:1";

  const args = ["-hide_banner", "-loglevel", "warning", "-nostats"];
  // Progress goes to stdout when stdout is free; with FLV on stdout the pusher reports it.
  if (!toStdout) args.push("-progress", "pipe:1");
  let source: string;
  if (options.source) {
    args.push("-re", "-stream_loop", "-1", "-i", options.source);
    source =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${colour},setsar=1,fps=${fps}`;
  } else {
    source = `${cameraChain(camera, width, height, fps, colour)},setsar=1,realtime`;
  }

  const overlay =
    `drawbox=x=0:y=0:w=iw:h=ih*0.13:color=${colour}@1:t=fill,` +
    `drawbox=x=0:y=0:w=iw:h=ih*0.13:color=black@0.35:t=fill,` +
    `drawtext=fontfile=${quoteFilterPath(options.fontFile)}:textfile=${quoteFilterPath(options.overlayTextFile)}` +
    `:fontcolor=white:fontsize=h/26:x=h/50:y=h/60:line_spacing=${Math.round(height / 90)}`;

  const timecode = timecodeFilters(width, height);
  // The frame rate as a number: ffmpeg 7 has no FRAME_RATE after settb and drops every frame.
  let graph =
    `${source},settb=1/1000,setpts=RTCTIME/1000,${overlay},${timecode},` +
    `setpts=N/${fps}/TB,format=yuv420p[v]`;
  if (options.audio) graph += ";sine=frequency=1000:sample_rate=48000,arealtime[a]";

  args.push("-filter_complex", graph, "-map", "[v]");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "high",
    "-bf",
    "0",
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    "-b:v",
    `${kbps}k`,
    "-maxrate",
    `${kbps}k`,
    "-bufsize",
    `${kbps}k`,
    "-r",
    String(fps),
  );
  if (options.audio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000");
  else args.push("-an");
  if (toStdout) args.push("-flush_packets", "1");
  args.push("-f", "flv", "-flvflags", "no_duration_filesize", options.output);
  return args;
}

/**
 * The pusher holds the one RTMP connection in inline mode: it copies FLV from stdin to RTMP.
 * Minimal probing so it starts sending immediately.
 */
export function buildPusherArgs(rtmpUrl: string): string[] {
  return [
    "-hide_banner",
    // "warning" would report "not enough frames to estimate rate" on every segment.
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
    // No "-fflags nobuffer": it drops the packets read while probing, i.e. the first keyframe.
    "-probesize",
    "32768",
    "-analyzeduration",
    "0",
    "-f",
    "flv",
    "-i",
    "pipe:0",
    "-c",
    "copy",
    "-f",
    "flv",
    "-flvflags",
    "no_duration_filesize",
    rtmpUrl,
  ];
}

export type DroneState = "idle" | "connecting" | "streaming" | "reconnecting" | "stopped";

/**
 * How a camera switch reaches the service:
 * - "inline": the RTMP session stays open, a new sequence header arrives inside it
 *   (expected Pilot 2 behaviour; option (b) of CLAUDE.md §10.1).
 * - "restart": the publisher disconnects and reconnects on the same key (option (a)).
 */
export type SwitchMode = "inline" | "restart";

export interface SimulatedDroneOptions {
  id: string;
  host: string;
  port: number;
  app?: string;
  profile: StreamProfile;
  camera: CameraMode;
  colour: string;
  fontFile: string;
  audio?: boolean;
  source?: string;
  switchMode?: SwitchMode;
  /** Restart ffmpeg with backoff after an unexpected exit, like an RC Plus would reconnect. */
  autoReconnect?: boolean;
  logger: Logger;
}

const STOP_GRACE_MS = 3000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10_000;
/** A run must last this long before the reconnect backoff resets (a rejected key still sends a few frames). */
const STABLE_RUN_MS = 10_000;

type Proc = ChildProcessWithoutNullStreams;

/**
 * One simulated drone. Restart mode: one ffmpeg process encodes and pushes RTMP.
 * Inline mode: an encoder per camera writes FLV to stdout, FlvSplicer joins the segments,
 * and a pusher ffmpeg holds the RTMP connection.
 *
 * Events: `state` (DroneState), `exit` ({ code, signal, expected }) when the RTMP-writing
 * process ends.
 */
export class SimulatedDrone extends EventEmitter {
  private encoder: Proc | undefined;
  private pusher: Proc | undefined;
  private splicer: FlvSplicer | undefined;
  private readonly expected = new WeakSet<Proc>();
  /** The process that holds the RTMP connection (pusher, or the only ffmpeg in restart mode). */
  private readonly rtmpWriters = new WeakSet<Proc>();
  private _state: DroneState = "idle";
  private _camera: CameraMode;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private runStartedAt = 0;
  framesSent = 0;
  cameraSwitches = 0;

  constructor(private readonly options: SimulatedDroneOptions) {
    super();
    this._camera = options.camera;
  }

  get id(): string {
    return this.options.id;
  }

  get state(): DroneState {
    return this._state;
  }

  get camera(): CameraMode {
    return this._camera;
  }

  get profile(): StreamProfile {
    return this.options.profile;
  }

  get switchMode(): SwitchMode {
    return this.options.switchMode ?? "inline";
  }

  get rtmpUrl(): string {
    const { host, port, app = "live", id } = this.options;
    return `rtmp://${host}:${port}/${app}/${id}`;
  }

  private setState(state: DroneState): void {
    if (state === this._state) return;
    this._state = state;
    this.options.logger.info({ droneId: this.id, state, camera: this._camera }, "drone state");
    this.emit("state", state);
  }

  async start(camera: CameraMode = this._camera): Promise<void> {
    clearTimeout(this.reconnectTimer);
    await this.terminate("graceful");
    this._camera = camera;
    await this.spawnPipeline();
  }

  /** Graceful stop: the stream is finished cleanly (FCUnpublish / deleteStream), then the socket closes. */
  async stop(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    await this.terminate("graceful");
    this.setState("stopped");
  }

  /** Abrupt stop: kill ffmpeg without a clean RTMP shutdown (publisher drop). */
  async kill(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    await this.terminate("kill");
    this.setState("stopped");
  }

  async switchCamera(camera: CameraMode): Promise<void> {
    this.options.logger.info(
      { droneId: this.id, from: this._camera, to: camera, mode: this.switchMode },
      "switching camera",
    );
    this.cameraSwitches++;
    if (this.switchMode === "inline" && this.pusher && this.encoder) {
      const old = this.encoder;
      this.encoder = undefined;
      await this.stopProcess(old, "kill");
      this._camera = camera;
      await this.spawnEncoder();
      return;
    }
    await this.start(camera);
  }

  /**
   * Leaves out all frames for `ms` while the RTMP session stays open, like the pauses of a
   * real RC Plus. Inline switch mode only (the splicer sits between encoder and pusher).
   */
  dropout(ms: number): void {
    if (!this.splicer) {
      this.options.logger.warn(
        { droneId: this.id, mode: this.switchMode },
        "dropout needs a running inline drone",
      );
      return;
    }
    this.options.logger.info({ droneId: this.id, ms }, "dropout");
    this.splicer.dropFor(ms);
  }

  private async overlayFile(): Promise<string> {
    const { width, height } = resolutionFor(this.options.profile, this._camera);
    const dir = path.join(os.tmpdir(), "drone-live-stream-hub-sim");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${this.id}-${this._camera}.txt`);
    await writeFile(file, overlayText(this.id, this._camera, width, height));
    return file;
  }

  private async encoderArgs(output: string): Promise<string[]> {
    const { profile, colour, fontFile, audio = false, source } = this.options;
    return buildFfmpegArgs({
      id: this.id,
      output,
      profile,
      camera: this._camera,
      colour,
      fontFile,
      overlayTextFile: await this.overlayFile(),
      audio,
      ...(source !== undefined ? { source } : {}),
    });
  }

  private async spawnPipeline(): Promise<void> {
    this.setState("connecting");
    this.runStartedAt = Date.now();
    if (this.switchMode === "restart") {
      const proc = this.spawnProcess("ffmpeg", await this.encoderArgs(this.rtmpUrl));
      this.rtmpWriters.add(proc);
      this.encoder = proc;
      this.watchProgress(proc);
      return;
    }
    const pusher = this.spawnProcess("pusher", buildPusherArgs(this.rtmpUrl));
    this.rtmpWriters.add(pusher);
    this.pusher = pusher;
    this.watchProgress(pusher);
    pusher.stdin.on("error", () => undefined); // EPIPE when the pusher dies; handled via exit
    this.splicer = new FlvSplicer(
      (chunk) => pusher.stdin.write(chunk),
      this.options.audio ?? false,
      1000 / this.options.profile.fps,
    );
    await this.spawnEncoder();
  }

  private async spawnEncoder(): Promise<void> {
    const pusher = this.pusher;
    const splicer = this.splicer;
    if (!pusher || !splicer) return;
    const encoder = this.spawnProcess("encoder", await this.encoderArgs("pipe:1"));
    this.encoder = encoder;
    splicer.beginSegment();
    encoder.stdout.on("data", (chunk: Buffer) => {
      if (this.encoder !== encoder) return; // output of a replaced encoder
      if (!splicer.push(chunk)) {
        encoder.stdout.pause();
        pusher.stdin.once("drain", () => encoder.stdout.resume());
      }
    });
  }

  private spawnProcess(role: string, args: string[]): Proc {
    const { logger } = this.options;
    logger.debug({ droneId: this.id, role, args }, "spawning ffmpeg");
    const proc = spawn(ffmpegBinary(), args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    createInterface({ input: proc.stderr }).on("line", (line) => {
      if (line.trim()) logger.warn({ droneId: this.id, role, ffmpeg: line }, "ffmpeg");
    });
    proc.on("error", (err) =>
      logger.error({ droneId: this.id, role, err: err.message }, "cannot start ffmpeg"),
    );
    proc.on("exit", (code, signal) => {
      const expected = this.expected.has(proc);
      if (this.rtmpWriters.has(proc)) this.emit("exit", { code, signal, expected });
      if (expected || (proc !== this.encoder && proc !== this.pusher)) return;
      logger.warn({ droneId: this.id, role, code, signal }, "ffmpeg exited unexpectedly");
      void this.handleFailure();
    });
    return proc;
  }

  private watchProgress(proc: Proc): void {
    createInterface({ input: proc.stdout }).on("line", (line) => {
      // -progress output: key=value lines, one block per update.
      if (line.startsWith("frame=")) {
        this.framesSent = Number(line.slice(6)) || this.framesSent;
        if (this.framesSent > 0 && this._state === "connecting") this.setState("streaming");
      }
    });
  }

  private async handleFailure(): Promise<void> {
    await this.terminate("kill");
    if (!(this.options.autoReconnect ?? true)) {
      this.setState("stopped");
      return;
    }
    if (Date.now() - this.runStartedAt >= STABLE_RUN_MS) this.backoffMs = MIN_BACKOFF_MS;
    this.setState("reconnecting");
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => void this.spawnPipeline(), delay);
  }

  /** Stops the whole pipeline. Graceful lets the RTMP writer finish the stream properly. */
  private async terminate(mode: "graceful" | "kill"): Promise<void> {
    const { encoder, pusher } = this;
    this.encoder = undefined;
    this.pusher = undefined;
    this.splicer = undefined;
    if (pusher) {
      // Inline: the encoder can just die; ending the pusher's input finishes the RTMP stream.
      await Promise.all([
        encoder ? this.stopProcess(encoder, "kill") : undefined,
        this.stopProcess(pusher, mode, "end-stdin"),
      ]);
    } else if (encoder) {
      await this.stopProcess(encoder, mode, "quit-key");
    }
  }

  private stopProcess(
    proc: Proc,
    mode: "graceful" | "kill",
    graceful: "quit-key" | "end-stdin" = "quit-key",
  ): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    this.expected.add(proc);
    return new Promise((resolve) => {
      const timer = setTimeout(() => proc.kill("SIGKILL"), STOP_GRACE_MS);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (mode === "graceful" && proc.stdin.writable) {
        if (graceful === "quit-key") proc.stdin.write("q");
        proc.stdin.end();
      } else {
        proc.kill("SIGKILL");
      }
    });
  }
}
