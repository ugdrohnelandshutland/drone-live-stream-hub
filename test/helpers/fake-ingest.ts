import { FlvTagType, type FlvTag } from "../../src/server/flv/types.js";
import type { IngestAdapter, IngestEvents } from "../../src/server/ingest/types.js";

/** Minimal ingest adapter that lets a test fire events. */
export class FakeIngest implements IngestAdapter {
  readonly port = 0;
  readonly listeners: { [E in keyof IngestEvents]: IngestEvents[E][] } = {
    publish: [],
    videoTag: [],
    audioTag: [],
    metadata: [],
    unpublish: [],
  };
  readonly disconnected: string[] = [];
  async start() {}
  async stop() {}
  disconnect(sessionId: string): void {
    this.disconnected.push(sessionId);
  }
  on<E extends keyof IngestEvents>(event: E, cb: IngestEvents[E]): void {
    this.listeners[event].push(cb);
  }
  publish(
    streamKey: string,
    sessionId: string,
    remoteAddress = "test",
    connect: Record<string, unknown> = {},
  ): boolean {
    return this.listeners.publish.every((cb) => cb({ streamKey, sessionId, remoteAddress, connect }));
  }
  unpublish(sessionId: string): void {
    for (const cb of this.listeners.unpublish) cb(sessionId);
  }
  video(sessionId: string, data: Buffer, timestamp = 0): void {
    this.videoTag(sessionId, { type: FlvTagType.Video, timestamp, data });
  }
  videoTag(sessionId: string, tag: FlvTag): void {
    for (const cb of this.listeners.videoTag) cb(sessionId, tag);
  }
  audio(sessionId: string, data: Buffer, timestamp = 0): void {
    for (const cb of this.listeners.audioTag) cb(sessionId, { type: FlvTagType.Audio, timestamp, data });
  }
  metadata(sessionId: string, data: Buffer): void {
    for (const cb of this.listeners.metadata) cb(sessionId, { type: FlvTagType.Script, timestamp: 0, data });
  }
}
