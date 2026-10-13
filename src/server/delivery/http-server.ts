import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { CloseCode, CloseReason } from "../../shared/close-codes.js";
import type { Logger } from "../logger.js";
import { sendJson, type Api } from "./api.js";
import type { LiveHub } from "./live-hub.js";
import type { ViewerConnection, ViewerMode } from "./live-channel.js";
import { createStaticHandler } from "./static-files.js";

export interface HttpServerOptions {
  port: number;
  host?: string;
  staticDir: string;
  hub: LiveHub;
  api: Api;
  health: () => object;
  logger: Logger;
  /** Ping interval to detect dead viewers (tablet left the Wi-Fi). */
  heartbeatMs?: number;
}

const WS_PATH = /^\/ws\/live\/([^/]+)$/;
const CLOSE_GRACE_MS = 2000;

class WsViewer implements ViewerConnection {
  readonly id = randomUUID();
  alive = true;
  constructor(readonly ws: WebSocket) {}

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  send(data: Buffer): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(data, { binary: true });
  }

  /**
   * Sends the close frame, but does not wait for it: behind a congested link the frame
   * sits after megabytes of queued video, and ws would keep the socket (and the queue)
   * for 30 s. A client that does not complete the close in time is cut off; it then sees
   * an abnormal close and reconnects with backoff.
   */
  close(code: number, reason: string): void {
    if (this.ws.readyState !== this.ws.OPEN && this.ws.readyState !== this.ws.CONNECTING) return;
    this.ws.close(code, reason);
    const timer = setTimeout(() => this.ws.terminate(), CLOSE_GRACE_MS);
    timer.unref();
    this.ws.once("close", () => clearTimeout(timer));
  }
}

export class DeliveryServer {
  private readonly server: http.Server;
  private readonly wss: WebSocketServer;
  private readonly viewers = new Set<WsViewer>();
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(private readonly options: HttpServerOptions) {
    const serveStatic = createStaticHandler(options.staticDir);
    this.server = http.createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      let pathname: string;
      try {
        pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (pathname === "/healthz") {
        sendJson(res, 200, options.health());
        return;
      }
      if (options.api.handle(req, res, pathname)) return;
      if (pathname.startsWith("/ws/")) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      serveStatic(req, res).catch((err: unknown) => {
        options.logger.error({ err, pathname }, "static file error");
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    // Viewers never send data; keep the limit tiny. No compression: video does not compress.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  get port(): number {
    const address = this.server.address();
    return typeof address === "object" && address !== null ? address.port : this.options.port;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.server.once("error", onError);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off("error", onError);
        this.server.on("error", (err) => this.options.logger.error({ err }, "HTTP server error"));
        this.heartbeat = setInterval(() => this.checkAlive(), this.options.heartbeatMs ?? 15_000);
        this.heartbeat.unref();
        this.options.logger.info({ port: this.port }, "HTTP server listening");
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    clearInterval(this.heartbeat);
    this.options.api.close();
    for (const viewer of this.viewers) viewer.ws.terminate();
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
  }

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = WS_PATH.exec(url.pathname);
    // `?keyframes=1`: data saver for overview tiles (live-channel.ts, ADR 0009).
    const mode: ViewerMode = url.searchParams.get("keyframes") === "1" ? "keyframes" : "full";
    if (!match?.[1]) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const droneId = decodeURIComponent(match[1]);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const channel = this.options.hub.channel(droneId);
      if (!channel) {
        // Accept, then close with a code the client can act on.
        ws.close(CloseCode.UnknownDrone, CloseReason[CloseCode.UnknownDrone]);
        return;
      }
      const viewer = new WsViewer(ws);
      const remoteAddress = req.socket.remoteAddress;
      const log = this.options.logger.child({ droneId, viewerId: viewer.id, remoteAddress, mode });
      this.viewers.add(viewer);
      ws.on("pong", () => {
        viewer.alive = true;
      });
      ws.on("error", (err) => log.debug({ err: err.message }, "viewer socket error"));
      ws.on("close", (code) => {
        this.viewers.delete(viewer);
        channel.removeViewer(viewer.id);
        log.info({ code, viewers: channel.viewerCount }, "viewer disconnected");
      });
      channel.addViewer(viewer, mode);
      log.info({ live: channel.live, viewers: channel.viewerCount }, "viewer connected");
    });
  }

  private checkAlive(): void {
    for (const viewer of this.viewers) {
      if (!viewer.alive) {
        this.options.logger.info({ viewerId: viewer.id }, "viewer did not answer ping, terminating");
        viewer.ws.terminate();
        continue;
      }
      viewer.alive = false;
      viewer.ws.ping();
    }
  }
}
