import { EventEmitter } from "node:events";
import type { DroneConfig } from "../config.js";
import { describeSequenceHeader } from "../flv/describe.js";
import { isMetadataObject, parseScriptTag } from "../flv/script.js";
import type { IngestAdapter } from "../ingest/types.js";
import type { Logger } from "../logger.js";
import type { DroneStatus, DroneVideoInfo } from "../../shared/api.js";

interface DroneEntry {
  status: DroneStatus;
  /** Times of recent publisher replacements, to detect two publishers using one key. */
  replacements: number[];
  /** Size from onMetaData, used when the sequence header does not reveal it (e.g. HEVC). */
  metadataSize: { width: number; height: number } | undefined;
  /** Time (ms) of the last video tag, or of the publish while none has arrived yet. */
  lastVideoAt: number;
}

export interface RejectedPublish {
  streamKey: string;
  remoteAddress: string;
  at: Date;
}

export interface RegistryEvents {
  "drone-updated": [DroneStatus];
  /** A publisher used a stream key that is not configured (e.g. a typo on the RC). */
  "publish-rejected": [RejectedPublish];
}

/**
 * Source of truth for which drones exist and whether they are live. Validates stream keys
 * at publish time; must be the first `publish` listener on the ingest adapter.
 */
/** This many replacements within the window means two publishers fight over one key. */
const FLAPPING_REPLACEMENTS = 3;
const FLAPPING_WINDOW_MS = 60_000;
/**
 * Live without a video tag for this long counts as stalled. Real RC Plus streams have gaps of
 * 1–4.5 s (field test 2026-10-26); at 30 fps a normal gap is 33 ms. Short enough that the web
 * UI knows the cause before its own stall detection (2 s) fires.
 */
export const PUBLISHER_STALL_MS = 1000;

export class DroneRegistry extends EventEmitter<RegistryEvents> {
  private readonly drones = new Map<string, DroneEntry>();
  private readonly sessions = new Map<string, string>();
  private ingest: IngestAdapter | undefined;

  constructor(
    drones: readonly DroneConfig[],
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
    for (const drone of drones) {
      this.drones.set(drone.id, {
        status: {
          id: drone.id,
          name: drone.name,
          state: "offline",
          since: null,
          sessionId: null,
          stalledSince: null,
          viewerCount: 0,
          video: null,
        },
        metadataSize: undefined,
        lastVideoAt: 0,
        replacements: [],
      });
    }
  }

  /** Wires the registry to the ingest adapter. Call before any other `publish` listener. */
  attach(ingest: IngestAdapter): void {
    this.ingest = ingest;
    ingest.on("publish", ({ streamKey, sessionId, remoteAddress }) => {
      if (!this.drones.has(streamKey)) {
        this.logger.warn({ streamKey, sessionId, remoteAddress }, "rejected publish with unknown stream key");
        this.emit("publish-rejected", { streamKey, remoteAddress, at: this.now() });
        return false;
      }
      this.publishStarted(streamKey, sessionId, remoteAddress);
      return true;
    });
    ingest.on("unpublish", (sessionId) => this.publishEnded(sessionId));
    ingest.on("videoTag", (sessionId, tag) => {
      this.videoArrived(sessionId);
      // Cheap check of the first two bytes before parsing: sequence headers only.
      const info = describeSequenceHeader(tag.data);
      if (info) this.videoInfo(sessionId, info);
    });
    ingest.on("metadata", (sessionId, tag) => this.metadata(sessionId, tag.data));
  }

  list(): DroneStatus[] {
    return [...this.drones.values()].map((entry) => ({ ...entry.status }));
  }

  get(id: string): DroneStatus | undefined {
    const entry = this.drones.get(id);
    return entry ? { ...entry.status } : undefined;
  }

  has(id: string): boolean {
    return this.drones.has(id);
  }

  /**
   * A publish for a live drone replaces the old session (an RC Plus reconnecting before its
   * old TCP connection timed out). The old connection is closed.
   */
  publishStarted(droneId: string, sessionId: string, remoteAddress?: string): void {
    const entry = this.drones.get(droneId);
    if (!entry) return;
    const previous = entry.status.sessionId;
    if (previous) {
      this.sessions.delete(previous);
      this.noteReplacement(entry, sessionId, remoteAddress);
      this.ingest?.disconnect(previous);
    }
    this.sessions.set(sessionId, droneId);
    const wasLive = entry.status.state === "live";
    entry.status = {
      ...entry.status,
      state: "live",
      since: wasLive ? entry.status.since : this.now().toISOString(),
      sessionId,
      stalledSince: null,
      video: null,
    };
    entry.metadataSize = undefined;
    entry.lastVideoAt = this.now().getTime();
    this.logger.info({ droneId, sessionId, replacedSessionId: previous ?? undefined }, "drone live");
    this.emitUpdate(entry);
  }

  publishEnded(sessionId: string): void {
    const droneId = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    const entry = droneId === undefined ? undefined : this.drones.get(droneId);
    if (!entry || entry.status.sessionId !== sessionId) return; // replaced session ending late
    entry.status = {
      ...entry.status,
      state: "offline",
      since: this.now().toISOString(),
      sessionId: null,
      stalledSince: null,
      video: null,
    };
    this.logger.info({ droneId, sessionId }, "drone offline");
    this.emitUpdate(entry);
  }

  setViewerCount(droneId: string, viewerCount: number): void {
    const entry = this.drones.get(droneId);
    if (!entry || entry.status.viewerCount === viewerCount) return;
    entry.status = { ...entry.status, viewerCount };
    this.emitUpdate(entry);
  }

  /**
   * Marks live drones whose publisher has sent no video for PUBLISHER_STALL_MS. Called
   * periodically by the composition root; recovery is reported on the next video tag.
   */
  checkStalls(): void {
    const now = this.now().getTime();
    for (const entry of this.drones.values()) {
      const { state, stalledSince, id, sessionId } = entry.status;
      if (state !== "live" || stalledSince !== null || now - entry.lastVideoAt < PUBLISHER_STALL_MS) continue;
      entry.status = { ...entry.status, stalledSince: new Date(entry.lastVideoAt).toISOString() };
      this.logger.info({ droneId: id, sessionId }, "publisher stalled: no video");
      this.emitUpdate(entry);
    }
  }

  private videoArrived(sessionId: string): void {
    const entry = this.entryForSession(sessionId);
    if (!entry) return;
    const now = this.now().getTime();
    const gapMs = now - entry.lastVideoAt;
    entry.lastVideoAt = now;
    if (entry.status.stalledSince === null) return;
    entry.status = { ...entry.status, stalledSince: null };
    this.logger.info({ droneId: entry.status.id, sessionId, gapMs }, "publisher resumed video");
    this.emitUpdate(entry);
  }

  private noteReplacement(entry: DroneEntry, sessionId: string, remoteAddress: string | undefined): void {
    const now = this.now().getTime();
    entry.replacements = [...entry.replacements.filter((t) => now - t < FLAPPING_WINDOW_MS), now];
    if (entry.replacements.length === FLAPPING_REPLACEMENTS) {
      this.logger.error(
        { droneId: entry.status.id, sessionId, remoteAddress, replacements: entry.replacements.length },
        "publisher replaced repeatedly: two senders probably use the same stream key",
      );
    }
  }

  private videoInfo(sessionId: string, info: DroneVideoInfo): void {
    const entry = this.entryForSession(sessionId);
    if (!entry) return;
    const video: DroneVideoInfo = { ...info };
    if (video.width === undefined && entry.metadataSize) Object.assign(video, entry.metadataSize);
    if (JSON.stringify(video) === JSON.stringify(entry.status.video)) return;
    entry.status = { ...entry.status, video };
    this.emitUpdate(entry);
  }

  private metadata(sessionId: string, data: Buffer): void {
    const entry = this.entryForSession(sessionId);
    if (!entry) return;
    try {
      const script = parseScriptTag(data);
      if (!script || !isMetadataObject(script.value)) return;
      const { width, height } = script.value;
      if (typeof width === "number" && typeof height === "number") entry.metadataSize = { width, height };
    } catch (err) {
      this.logger.debug({ droneId: entry.status.id, sessionId, err }, "cannot decode metadata");
    }
  }

  private entryForSession(sessionId: string): DroneEntry | undefined {
    const droneId = this.sessions.get(sessionId);
    const entry = droneId === undefined ? undefined : this.drones.get(droneId);
    return entry?.status.sessionId === sessionId ? entry : undefined;
  }

  private emitUpdate(entry: DroneEntry): void {
    this.emit("drone-updated", { ...entry.status });
  }
}
