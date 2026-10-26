import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { AdminCapture } from "../../shared/admin.js";
import { parseVideoTag } from "../../shared/flv/video.js";
import type { FlvTag } from "../flv/types.js";
import { createFlvHeader, encodeFlvTag } from "../flv/writer.js";
import type { IngestAdapter } from "../ingest/types.js";
import type { Logger } from "../logger.js";

export interface StreamCaptureOptions {
  ingest: IngestAdapter;
  /** Where the FLV files go, e.g. `<dataDir>/captures`. */
  dir: string;
  logger: Logger;
  /** A capture ends early at this size. */
  maxBytes?: number;
  /** Older files beyond this many are deleted. */
  keep?: number;
  now?: () => number;
}

export type CaptureStart = { ok: true; capture: AdminCapture } | { ok: false; error: "offline" | "busy" };

/** "m30t-01_2026-10-26T18-52-18-648Z.flv" */
const FILE_NAME = /^([a-z0-9-]{1,32})_(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z\.flv$/;

interface PublisherSession {
  droneId: string;
  metadata: FlvTag | undefined;
  sequenceHeader: FlvTag | undefined;
}

interface Recording {
  capture: AdminCapture;
  sessionId: string;
  out: WriteStream;
  timer: NodeJS.Timeout;
  log: Logger;
}

/**
 * Records what a publisher sends, for a few seconds, into an FLV file: the cached onMetaData
 * and sequence header first, then every video and script tag as received (timestamps and
 * payloads unchanged; audio is left out like everywhere else). Only for analysing real streams;
 * it observes ingest and never touches delivery. Files are written asynchronously.
 */
export class StreamCapture {
  private readonly sessions = new Map<string, PublisherSession>();
  /** Current session per drone. */
  private readonly live = new Map<string, string>();
  private readonly recordings = new Map<string, Recording>();
  /** Finished captures, newest last. */
  private finished: AdminCapture[] = [];
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => number;

  constructor(private readonly options: StreamCaptureOptions) {
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.keep = options.keep ?? 20;
    this.now = options.now ?? Date.now;
    const { ingest } = options;
    // Registered after the registry: only accepted publishers get here.
    ingest.on("publish", ({ streamKey, sessionId }) => {
      this.sessions.set(sessionId, { droneId: streamKey, metadata: undefined, sequenceHeader: undefined });
      this.live.set(streamKey, sessionId);
      return true;
    });
    ingest.on("metadata", (sessionId, tag) => {
      const session = this.sessions.get(sessionId);
      if (session) session.metadata = tag;
      this.write(sessionId, tag);
    });
    ingest.on("videoTag", (sessionId, tag) => {
      const session = this.sessions.get(sessionId);
      if (session && parseVideoTag(tag.data)?.packetType === "sequence-header") session.sequenceHeader = tag;
      this.write(sessionId, tag);
    });
    ingest.on("unpublish", (sessionId) => {
      const session = this.sessions.get(sessionId);
      this.sessions.delete(sessionId);
      if (!session) return;
      if (this.live.get(session.droneId) === sessionId) this.live.delete(session.droneId);
      const recording = this.recordings.get(session.droneId);
      if (recording?.sessionId === sessionId) this.finish(recording, "offline");
    });
  }

  /** Lists the files of earlier runs. */
  async start(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    const found: AdminCapture[] = [];
    for (const file of await readdir(this.options.dir)) {
      const match = FILE_NAME.exec(file);
      if (!match) continue;
      const [, droneId = "", date, h, m, s, ms] = match;
      try {
        const { size } = await stat(path.join(this.options.dir, file));
        found.push({
          file,
          droneId,
          startedAt: `${date}T${h}:${m}:${s}.${ms}Z`,
          recording: false,
          bytes: size,
        });
      } catch {
        // Deleted in the meantime.
      }
    }
    found.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    this.finished = found;
    await this.prune();
  }

  /** Ends running captures; their files stay. */
  stop(): Promise<void> {
    return Promise.all([...this.recordings.values()].map((r) => this.finish(r, "stopped"))).then(
      () => undefined,
    );
  }

  /** Newest first. */
  list(): AdminCapture[] {
    const running = [...this.recordings.values()].map((r) => ({ ...r.capture }));
    return [...running, ...this.finished.map((c) => ({ ...c })).reverse()];
  }

  /** Full path of a finished capture, or undefined for anything else. */
  filePath(file: string): string | undefined {
    if (!FILE_NAME.test(file) || !this.finished.some((c) => c.file === file)) return undefined;
    return path.join(this.options.dir, file);
  }

  begin(droneId: string, seconds: number): CaptureStart {
    const sessionId = this.live.get(droneId);
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (sessionId === undefined || !session) return { ok: false, error: "offline" };
    if (this.recordings.has(droneId)) return { ok: false, error: "busy" };

    const startedAt = new Date(this.now()).toISOString();
    const file = `${droneId}_${startedAt.replaceAll(":", "-").replace(".", "-")}.flv`;
    const log = this.options.logger.child({ droneId, sessionId });
    const capture: AdminCapture = { file, droneId, startedAt, recording: true, bytes: 0 };
    const out = createWriteStream(path.join(this.options.dir, file), { flags: "wx" });
    const recording: Recording = {
      capture,
      sessionId,
      out,
      log,
      timer: setTimeout(() => void this.finish(recording), seconds * 1000),
    };
    out.on("error", (err) => {
      log.error({ err, file }, "capture write failed");
      void this.finish(recording, "error");
    });
    this.recordings.set(droneId, recording);
    log.info({ file, seconds }, "capture started");

    this.append(recording, createFlvHeader({ audio: false, video: true }));
    for (const tag of [session.metadata, session.sequenceHeader]) {
      if (tag) this.append(recording, encodeFlvTag(tag));
    }
    return { ok: true, capture: { ...capture } };
  }

  private write(sessionId: string, tag: FlvTag): void {
    const droneId = this.sessions.get(sessionId)?.droneId;
    const recording = droneId === undefined ? undefined : this.recordings.get(droneId);
    if (recording?.sessionId === sessionId) this.append(recording, encodeFlvTag(tag));
  }

  private append(recording: Recording, chunk: Buffer): void {
    if (!recording.capture.recording) return;
    if (recording.capture.bytes + chunk.length > this.maxBytes) {
      void this.finish(recording, "size");
      return;
    }
    recording.capture.bytes += chunk.length;
    recording.out.write(chunk);
  }

  private async finish(recording: Recording, cutShort?: AdminCapture["cutShort"]): Promise<void> {
    const { capture } = recording;
    if (!capture.recording) return;
    capture.recording = false;
    if (cutShort) capture.cutShort = cutShort;
    clearTimeout(recording.timer);
    // Listed (and busy) until the file is complete, then downloadable.
    await new Promise<void>((resolve) => {
      if (recording.out.destroyed) resolve();
      else recording.out.end(resolve);
    });
    this.recordings.delete(capture.droneId);
    recording.log.info({ file: capture.file, bytes: capture.bytes, cutShort }, "capture finished");
    this.finished.push({ ...capture });
    await this.prune();
  }

  private async prune(): Promise<void> {
    while (this.finished.length > this.keep) {
      const oldest = this.finished.shift();
      if (!oldest) break;
      try {
        await unlink(path.join(this.options.dir, oldest.file));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          this.options.logger.warn({ err, file: oldest.file }, "cannot delete old capture");
        }
      }
    }
  }
}
