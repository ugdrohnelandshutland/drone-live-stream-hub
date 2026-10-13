import { EventEmitter } from "node:events";
import net from "node:net";
import type { Logger } from "../server/logger.js";

/** Network conditions applied to both directions of every connection. */
export interface NetworkConditions {
  /** Added one-way delay. */
  latencyMs: number;
  /** Random extra delay 0..jitterMs per chunk (order is kept, like TCP). */
  jitterMs: number;
  /** Bandwidth cap per direction and connection in kbit/s; 0 = unlimited. */
  bandwidthKbps: number;
}

export const PERFECT_NETWORK: NetworkConditions = { latencyMs: 0, jitterMs: 0, bandwidthKbps: 0 };

export interface ChaosProxyOptions {
  name: string;
  targetHost: string;
  targetPort: number;
  listenPort?: number;
  listenHost?: string;
  logger: Logger;
  /** Stop reading from a side once this much data is queued (TCP backpressure to the sender). */
  maxQueueBytes?: number;
}

interface Chunk {
  data: Buffer;
  releaseAt: number;
}

/** One direction of one connection: delays, rate-limits and stalls the data. */
class Lane {
  private readonly queue: Chunk[] = [];
  private queuedBytes = 0;
  private lastReleaseAt = 0;
  private tokens = 0;
  private tokensAt = Date.now();
  private timer: NodeJS.Timeout | undefined;
  private writing = false;
  private ended = false;

  constructor(
    private readonly from: net.Socket,
    private readonly to: net.Socket,
    private readonly proxy: ChaosProxy,
    private readonly maxQueueBytes: number,
  ) {
    from.on("data", (data: Buffer) => this.enqueue(data));
    from.on("end", () => {
      this.ended = true;
      this.pump();
    });
  }

  private enqueue(data: Buffer): void {
    const { latencyMs, jitterMs } = this.proxy.conditions;
    const now = Date.now();
    // Keep order: a chunk is never released before the previous one.
    const releaseAt = Math.max(now + latencyMs + Math.random() * jitterMs, this.lastReleaseAt);
    this.lastReleaseAt = releaseAt;
    this.queue.push({ data, releaseAt });
    this.queuedBytes += data.length;
    if (this.queuedBytes > this.maxQueueBytes) this.from.pause();
    this.pump();
  }

  /** Re-evaluate after a condition change or the end of a stall. */
  pump(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.writing || this.to.destroyed) return;
    const now = Date.now();

    const stalledUntil = this.proxy.stalledUntil;
    if (stalledUntil > now) {
      this.timer = setTimeout(() => this.pump(), stalledUntil - now);
      return;
    }

    const head = this.queue[0];
    if (!head) {
      if (this.ended) this.to.end();
      return;
    }
    if (head.releaseAt > now) {
      this.timer = setTimeout(() => this.pump(), head.releaseAt - now);
      return;
    }

    let data = head.data;
    const kbps = this.proxy.conditions.bandwidthKbps;
    if (kbps > 0) {
      const bytesPerMs = (kbps * 1000) / 8 / 1000;
      // Token bucket with at most 50 ms of burst; large chunks are sent in budget-sized slices.
      this.tokens = Math.min(this.tokens + (now - this.tokensAt) * bytesPerMs, Math.max(bytesPerMs * 50, 1));
      this.tokensAt = now;
      const allowed = Math.floor(this.tokens);
      if (allowed < Math.min(data.length, 1460)) {
        const wait = Math.ceil((Math.min(data.length, 1460) - this.tokens) / bytesPerMs);
        this.timer = setTimeout(() => this.pump(), Math.max(1, wait));
        return;
      }
      if (allowed < data.length) {
        head.data = data.subarray(allowed);
        data = data.subarray(0, allowed);
      }
      this.tokens -= data.length;
    }

    if (data === head.data) this.queue.shift();
    this.queuedBytes -= data.length;
    this.proxy.bytesForwarded += data.length;
    if (this.queuedBytes <= this.maxQueueBytes / 2 && this.from.isPaused()) this.from.resume();

    const flushed = this.to.write(data);
    if (!flushed) {
      this.writing = true;
      this.to.once("drain", () => {
        this.writing = false;
        this.pump();
      });
      return;
    }
    // Continue on the next tick so timers and I/O can interleave.
    this.timer = setTimeout(() => this.pump(), 0);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

interface Connection {
  client: net.Socket;
  upstream: net.Socket;
  lanes: Lane[];
}

/**
 * TCP proxy that emulates bad field Wi-Fi between a simulated drone and the ingest port (or
 * between the service and a viewer): latency, jitter, bandwidth cap, stalls without closing,
 * hard cuts, and periods in which new connections are refused (out of range).
 */
export class ChaosProxy extends EventEmitter {
  private readonly server: net.Server;
  private readonly connections = new Set<Connection>();
  conditions: NetworkConditions = { ...PERFECT_NETWORK };
  stalledUntil = 0;
  private refuseUntil = 0;
  bytesForwarded = 0;
  connectionsTotal = 0;

  constructor(private readonly options: ChaosProxyOptions) {
    super();
    // Half-open: a FIN is forwarded after the queued data, not before it.
    this.server = net.createServer({ allowHalfOpen: true }, (client) => this.handle(client));
  }

  get port(): number {
    const address = this.server.address();
    return typeof address === "object" && address !== null ? address.port : (this.options.listenPort ?? 0);
  }

  get activeConnections(): number {
    return this.connections.size;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.listenPort ?? 0, this.options.listenHost ?? "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    this.cut();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  setConditions(conditions: Partial<NetworkConditions>): void {
    this.conditions = { ...this.conditions, ...conditions };
    this.options.logger.info({ proxy: this.options.name, ...this.conditions }, "network conditions");
    this.pumpAll();
  }

  /** Freeze all traffic for `ms` without closing anything (data piles up, then flows). */
  stall(ms: number): void {
    this.stalledUntil = Date.now() + ms;
    this.options.logger.info({ proxy: this.options.name, ms }, "network stall");
    this.pumpAll();
  }

  /** Hard cut: reset all connections. With `refuseMs`, new connections fail for that long. */
  cut(refuseMs = 0): void {
    this.refuseUntil = Date.now() + refuseMs;
    if (this.connections.size > 0 || refuseMs > 0) {
      this.options.logger.info(
        { proxy: this.options.name, connections: this.connections.size, refuseMs },
        "network cut",
      );
    }
    for (const connection of this.connections) this.close(connection, true);
  }

  /** Back to a perfect network. */
  heal(): void {
    this.conditions = { ...PERFECT_NETWORK };
    this.stalledUntil = 0;
    this.refuseUntil = 0;
    this.options.logger.info({ proxy: this.options.name }, "network healed");
    this.pumpAll();
  }

  private pumpAll(): void {
    for (const connection of this.connections) for (const lane of connection.lanes) lane.pump();
  }

  private handle(client: net.Socket): void {
    if (Date.now() < this.refuseUntil) {
      client.resetAndDestroy();
      return;
    }
    this.connectionsTotal++;
    client.setNoDelay(true);
    const upstream = net.connect({
      port: this.options.targetPort,
      host: this.options.targetHost,
      allowHalfOpen: true,
    });
    upstream.setNoDelay(true);
    const maxQueue = this.options.maxQueueBytes ?? 4 * 1024 * 1024;
    const connection: Connection = { client, upstream, lanes: [] };
    connection.lanes.push(
      new Lane(client, upstream, this, maxQueue),
      new Lane(upstream, client, this, maxQueue),
    );
    this.connections.add(connection);
    // Clean up when both sides are closed; an error on either side tears down both.
    const onClose = () => {
      if (client.destroyed && upstream.destroyed) this.close(connection, false);
    };
    const onError = () => this.close(connection, false);
    client.on("close", onClose);
    upstream.on("close", onClose);
    client.on("error", onError);
    upstream.on("error", onError);
  }

  private close(connection: Connection, hard: boolean): void {
    if (!this.connections.delete(connection)) return;
    for (const lane of connection.lanes) lane.dispose();
    for (const socket of [connection.client, connection.upstream]) {
      if (socket.destroyed) continue;
      if (hard) socket.resetAndDestroy();
      else socket.destroy();
    }
  }
}
