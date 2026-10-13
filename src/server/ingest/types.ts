import type { FlvTag } from "../flv/types.js";

export interface PublishRequest {
  /** RTMP stream name, i.e. the drone id. */
  streamKey: string;
  sessionId: string;
  remoteAddress: string;
  /** The RTMP connect command object (flashVer, tcUrl, …), for diagnostics. */
  connect: Record<string, unknown>;
}

export interface IngestEvents {
  /** Return false to reject the publisher. All listeners must accept. */
  publish: (request: PublishRequest) => boolean;
  videoTag: (sessionId: string, tag: FlvTag) => void;
  /** Audio is never delivered to viewers; this event only feeds diagnostics. */
  audioTag: (sessionId: string, tag: FlvTag) => void;
  /** Script tag normalised to start with `onMetaData`. */
  metadata: (sessionId: string, tag: FlvTag) => void;
  unpublish: (sessionId: string) => void;
}

/** Hides the RTMP library so it can be swapped. Audio is dropped inside the adapter. */
export interface IngestAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Actual listening port (useful when configured with port 0). */
  readonly port: number;
  on<E extends keyof IngestEvents>(event: E, cb: IngestEvents[E]): void;
  /** Closes a publisher's connection (e.g. replaced by a newer session). `unpublish` follows. */
  disconnect(sessionId: string): void;
}
