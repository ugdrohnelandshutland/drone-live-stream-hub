import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SSE_DRONE_UPDATED,
  SSE_SNAPSHOT,
  type DroneStatus,
  type DronesResponse,
  type ServiceInfo,
} from "../../shared/api.js";
import type { DiagnosticsResponse } from "../../shared/diagnostics.js";
import { clientCookie } from "../clients/client-cookie.js";
import type { ClientRegistry } from "../clients/client-registry.js";
import { displayAddress } from "../clients/user-agent.js";
import type { Logger } from "../logger.js";
import type { DroneRegistry } from "../registry/registry.js";

export interface ApiOptions {
  registry: DroneRegistry;
  /** Release information for GET /api/info. */
  info: ServiceInfo;
  /** GET /api/diagnostics: what each publisher sends (see src/shared/diagnostics.ts). */
  diagnostics?: () => DiagnosticsResponse;
  /** Devices (ADR 0012): each SSE connection tells the registry the device is there. */
  clients?: ClientRegistry;
  logger: Logger;
  /** Updates per drone within this window are merged into one event (viewer count bursts). */
  coalesceMs?: number;
  heartbeatMs?: number;
  /** Drop an SSE client whose unsent output exceeds this (it reconnects and gets a snapshot). */
  maxPendingBytes?: number;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** JSON API and server-sent events for the web UI. */
export class Api {
  private readonly clients = new Set<ServerResponse>();
  private readonly pending = new Map<string, DroneStatus>();
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly options: ApiOptions) {
    options.registry.on("drone-updated", (status) => this.queue(status));
    this.heartbeat = setInterval(() => this.broadcast(": ping\n\n"), options.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  get sseClientCount(): number {
    return this.clients.size;
  }

  /** Returns true if the request was an API request and has been answered. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (pathname === "/api/drones") {
      const body: DronesResponse = { drones: this.options.registry.list() };
      sendJson(res, 200, body);
      return true;
    }
    if (pathname === "/api/diagnostics" && this.options.diagnostics) {
      sendJson(res, 200, this.options.diagnostics());
      return true;
    }
    if (pathname === "/api/info") {
      sendJson(res, 200, this.options.info);
      return true;
    }
    if (pathname === "/api/events") {
      this.openStream(req, res);
      return true;
    }
    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    return false;
  }

  close(): void {
    clearInterval(this.heartbeat);
    clearTimeout(this.flushTimer);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private openStream(req: IncomingMessage, res: ServerResponse): void {
    // The page's first request normally set the cookie already; not with the Vite dev server.
    const { clientId, setCookie } = clientCookie(req);
    if (setCookie) res.setHeader("set-cookie", setCookie);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    req.socket.setNoDelay(true);
    const snapshot: DronesResponse = { drones: this.options.registry.list() };
    res.write(`retry: 2000\n\n${sseEvent(SSE_SNAPSHOT, snapshot)}`);
    this.clients.add(res);
    this.options.logger.debug({ clients: this.clients.size }, "SSE client connected");
    const leave = this.options.clients?.openEvents({
      clientId,
      address: displayAddress(req.socket.remoteAddress),
      userAgent: req.headers["user-agent"],
      send: (event, data) => {
        if (!res.destroyed) res.write(sseEvent(event, data));
      },
    });
    const remove = () => {
      this.clients.delete(res);
      leave?.();
    };
    req.on("close", remove);
    res.on("error", remove);
  }

  private queue(status: DroneStatus): void {
    this.pending.set(status.id, status);
    this.flushTimer ??= setTimeout(() => this.flush(), this.options.coalesceMs ?? 100);
  }

  private flush(): void {
    this.flushTimer = undefined;
    const events = [...this.pending.values()].map((status) => sseEvent(SSE_DRONE_UPDATED, status)).join("");
    this.pending.clear();
    if (events) this.broadcast(events);
  }

  private broadcast(text: string): void {
    const limit = this.options.maxPendingBytes ?? 1024 * 1024;
    for (const res of this.clients) {
      if (res.writableLength > limit) {
        this.options.logger.warn("dropping slow SSE client");
        this.clients.delete(res);
        res.destroy();
        continue;
      }
      res.write(text);
    }
  }
}
