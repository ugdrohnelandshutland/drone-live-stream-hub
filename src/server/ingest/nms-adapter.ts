import { randomUUID } from "node:crypto";
import net from "node:net";
import Rtmp from "node-media-server/src/protocol/rtmp.js";
import { stripSetDataFrame } from "../flv/script.js";
import { FlvTagType, type FlvTag } from "../flv/types.js";
import type { Logger } from "../logger.js";
import type { IngestAdapter, IngestEvents, PublishRequest } from "./types.js";

export interface NmsIngestOptions {
  port: number;
  host?: string;
  /** Only this RTMP app name is accepted. */
  appName: string;
  /** Close a publisher that sends nothing for this long (Wi-Fi cut without FIN). */
  idleTimeoutMs: number;
  logger: Logger;
}

const RTMP_TYPE_AMF0_DATA = 18;

interface SessionStats {
  videoTags: number;
  videoBytes: number;
  audioTagsDropped: number;
  startedAt: number;
}

/**
 * Ingest adapter built on the protocol layer of node-media-server (`src/protocol/rtmp.js`).
 * We run our own TCP server and session handling; NMS only parses RTMP and answers the handshake.
 * See docs/decisions/0001-rtmp-library.md.
 */
export class NmsIngestAdapter implements IngestAdapter {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly sessions = new Map<string, net.Socket>();
  private readonly listeners: { [E in keyof IngestEvents]: IngestEvents[E][] } = {
    publish: [],
    videoTag: [],
    audioTag: [],
    metadata: [],
    unpublish: [],
  };

  constructor(private readonly options: NmsIngestOptions) {
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  get port(): number {
    const address = this.server.address();
    return typeof address === "object" && address !== null ? address.port : this.options.port;
  }

  on<E extends keyof IngestEvents>(event: E, cb: IngestEvents[E]): void {
    this.listeners[event].push(cb);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.server.once("error", onError);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off("error", onError);
        this.server.on("error", (err) => this.options.logger.error({ err }, "RTMP server error"));
        this.options.logger.info({ port: this.port }, "RTMP ingest listening");
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.sockets) socket.destroy();
      this.server.close(() => resolve());
    });
  }

  disconnect(sessionId: string): void {
    const socket = this.sessions.get(sessionId);
    if (!socket) return;
    this.options.logger.info({ sessionId }, "disconnecting publisher");
    socket.destroy();
  }

  private acceptPublish(request: PublishRequest): boolean {
    return this.listeners.publish.every((cb) => cb(request));
  }

  private handleConnection(socket: net.Socket): void {
    const sessionId = randomUUID();
    // IPv4 clients on a dual-stack socket appear as "::ffff:10.0.0.7"; show plain IPv4.
    const remoteIp = (socket.remoteAddress ?? "?").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
    const remoteAddress = remoteIp.includes(":")
      ? `[${remoteIp}]:${socket.remotePort ?? "?"}`
      : `${remoteIp}:${socket.remotePort ?? "?"}`;
    let log = this.options.logger.child({ sessionId, remoteAddress });
    const rtmp = new Rtmp();
    let streamKey: string | undefined;
    let app: string | undefined;
    let published = false;
    let closed = false;
    const stats: SessionStats = { videoTags: 0, videoBytes: 0, audioTagsDropped: 0, startedAt: Date.now() };

    this.sockets.add(socket);
    this.sessions.set(sessionId, socket);
    socket.setNoDelay(true);
    socket.setTimeout(this.options.idleTimeoutMs);
    log.debug("RTMP connection opened");

    const reject = (reason: string) => {
      log.warn({ app, streamKey, reason }, "RTMP publish rejected");
      closed = true;
      socket.destroy();
    };

    rtmp.onOutputCallback = (buffer) => {
      if (!socket.destroyed) socket.write(buffer);
    };
    rtmp.onConnectCallback = (req) => {
      app = req.app;
      streamKey = req.name;
    };
    rtmp.onPlayCallback = () => reject("playback over RTMP is not supported");
    rtmp.onPushCallback = () => {
      if (published) return reject("second publish on the same connection");
      if (app !== this.options.appName) return reject(`unknown app, expected "${this.options.appName}"`);
      if (!streamKey) return reject("empty stream key");
      log = log.child({ droneId: streamKey });
      if (!this.acceptPublish({ streamKey, sessionId, remoteAddress, connect: rtmp.connectCmdObj ?? {} }))
        return reject("stream key not accepted");
      published = true;
      stats.startedAt = Date.now();
      log.info("RTMP publish started");
    };
    rtmp.onPacketCallback = (packet) => {
      if (!published || closed) return;
      // NMS reuses its payload buffer; copy exactly the valid bytes.
      const data = Buffer.from(packet.data.subarray(0, packet.size));
      const timestamp = packet.dts >>> 0;
      switch (packet.codec_type) {
        case FlvTagType.Video: {
          stats.videoTags++;
          stats.videoBytes += data.length;
          const tag: FlvTag = { type: FlvTagType.Video, timestamp, data };
          for (const cb of this.listeners.videoTag) cb(sessionId, tag);
          break;
        }
        case FlvTagType.Audio: {
          stats.audioTagsDropped++;
          const tag: FlvTag = { type: FlvTagType.Audio, timestamp, data };
          for (const cb of this.listeners.audioTag) cb(sessionId, tag);
          break;
        }
        case RTMP_TYPE_AMF0_DATA: {
          const tag: FlvTag = { type: FlvTagType.Script, timestamp: 0, data: stripSetDataFrame(data) };
          for (const cb of this.listeners.metadata) cb(sessionId, tag);
          break;
        }
        default:
          log.debug({ messageType: packet.codec_type }, "ignoring RTMP data message");
      }
    };

    socket.on("data", (chunk: Buffer) => {
      if (closed) return;
      try {
        const err = rtmp.parserData(chunk);
        if (err) {
          log.warn({ err }, "RTMP protocol error, closing connection");
          closed = true;
          socket.destroy();
        }
      } catch (err) {
        log.error({ err }, "RTMP session failed, closing connection");
        closed = true;
        socket.destroy();
      }
    });
    socket.on("timeout", () => {
      log.warn({ idleTimeoutMs: this.options.idleTimeoutMs }, "RTMP connection idle, closing");
      socket.destroy();
    });
    socket.on("error", (err) => log.warn({ err: err.message }, "RTMP socket error"));
    socket.on("close", () => {
      closed = true;
      this.sockets.delete(socket);
      this.sessions.delete(sessionId);
      if (!published) {
        log.debug("RTMP connection closed");
        return;
      }
      log.info(
        {
          durationMs: Date.now() - stats.startedAt,
          videoTags: stats.videoTags,
          videoBytes: stats.videoBytes,
          audioTagsDropped: stats.audioTagsDropped,
        },
        "RTMP publish ended",
      );
      for (const cb of this.listeners.unpublish) cb(sessionId);
    });
  }
}
