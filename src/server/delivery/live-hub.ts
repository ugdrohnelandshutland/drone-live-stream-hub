import type { IngestAdapter } from "../ingest/types.js";
import type { Logger } from "../logger.js";
import {
  LiveChannel,
  type ChannelStats,
  type LiveChannelOptions,
  type StreamResetReason,
} from "./live-channel.js";

/**
 * Owns one LiveChannel per configured drone and routes ingest sessions to them.
 * Key validation is the registry's job (registered first); a key without a channel is
 * still rejected here as a safety net.
 */
export class LiveHub {
  private readonly channels = new Map<string, LiveChannel>();
  private readonly sessionToDrone = new Map<string, string>();

  constructor(
    droneIds: readonly string[],
    ingest: IngestAdapter,
    options: LiveChannelOptions,
    private readonly logger: Logger,
    onViewerCount: (droneId: string, count: number) => void = () => undefined,
    onStreamReset: (droneId: string, reason: StreamResetReason) => void = () => undefined,
  ) {
    for (const id of droneIds) {
      const channel = new LiveChannel(
        id,
        options,
        logger.child({ droneId: id }),
        Date.now,
        (count) => onViewerCount(id, count),
        (reason) => onStreamReset(id, reason),
      );
      this.channels.set(id, channel);
    }

    ingest.on("publish", ({ streamKey, sessionId }) => {
      const channel = this.channels.get(streamKey);
      if (!channel) return false;
      this.sessionToDrone.set(sessionId, streamKey);
      channel.publish(sessionId);
      return true;
    });
    ingest.on("metadata", (sessionId, tag) => this.channelFor(sessionId)?.metadata(sessionId, tag));
    ingest.on("videoTag", (sessionId, tag) => this.channelFor(sessionId)?.videoTag(sessionId, tag));
    ingest.on("unpublish", (sessionId) => {
      this.channelFor(sessionId)?.unpublish(sessionId);
      this.sessionToDrone.delete(sessionId);
    });
  }

  channel(droneId: string): LiveChannel | undefined {
    return this.channels.get(droneId);
  }

  stats(): Record<string, ChannelStats> {
    return Object.fromEntries([...this.channels].map(([id, channel]) => [id, channel.stats()]));
  }

  closeAll(code: number, reason: string): void {
    for (const channel of this.channels.values()) channel.closeAll(code, reason);
    this.logger.debug("all viewers closed");
  }

  private channelFor(sessionId: string): LiveChannel | undefined {
    const droneId = this.sessionToDrone.get(sessionId);
    return droneId === undefined ? undefined : this.channels.get(droneId);
  }
}
