import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ADMIN_NAME_MAX,
  CAPTURE_SECONDS,
  type AdminCaptureError,
  type AdminLoad,
  type AdminLoginError,
  type AdminState,
} from "../../shared/admin.js";
import { readCookie } from "../clients/client-cookie.js";
import type { ClientRegistry } from "../clients/client-registry.js";
import { displayAddress } from "../clients/user-agent.js";
import { sendJson } from "../delivery/api.js";
import type { StreamCapture } from "../diagnostics/stream-capture.js";
import type { Logger } from "../logger.js";
import type { AdminAuth } from "./admin-auth.js";
import type { EventLog } from "./event-log.js";

export interface AdminApiOptions {
  /** Undefined: no PIN configured, every admin request answers 404. */
  auth: AdminAuth | undefined;
  clients: ClientRegistry;
  events: EventLog;
  load: () => AdminLoad;
  /** Raw stream captures; undefined without a data directory. */
  captures?: StreamCapture;
  logger: Logger;
}

const SESSION_COOKIE = "dlsh_admin";
const MAX_BODY_BYTES = 1024;
const CLIENT_ACTION = /^\/api\/admin\/clients\/([^/]+)\/(pause|resume|reload|name)$/;
const CAPTURE_FILE = /^\/api\/admin\/captures\/([^/]+)$/;

class BadRequest extends Error {}

/** Reads a small JSON body; POSTs must declare JSON, so a plain cross-site form cannot send one. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new BadRequest("not JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BadRequest("body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("invalid JSON");
  }
}

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

/**
 * `/api/admin/*` (ADR 0012): login with the PIN, then the devices, the load and the event log,
 * and pausing, releasing, reloading and naming devices. Everything but the login needs the
 * session cookie.
 */
export class AdminApi {
  /** Event numbers start again after a restart; the page drops its list when this changes. */
  private readonly epoch = randomUUID();

  constructor(private readonly options: AdminApiOptions) {}

  /** POST is allowed for these paths only. */
  static accepts(pathname: string): boolean {
    return pathname.startsWith("/api/admin/");
  }

  /** Returns true if the request was an admin request; it is then answered (possibly later). */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
    if (!AdminApi.accepts(url.pathname)) return false;
    const { auth } = this.options;
    if (!auth) {
      sendJson(res, 404, { error: "not configured" });
      return true;
    }
    this.route(auth, req, res, url).catch((err: unknown) => {
      if (err instanceof BadRequest) {
        if (!res.headersSent) sendJson(res, 400, { error: "bad-request" } satisfies AdminLoginError);
        return;
      }
      this.options.logger.error({ err, path: url.pathname }, "admin request failed");
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.end();
    });
    return true;
  }

  private async route(auth: AdminAuth, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const { pathname } = url;
    const post = req.method === "POST";
    const address = displayAddress(req.socket.remoteAddress);

    if (pathname === "/api/admin/login" && post) {
      const pin = field(await readJson(req), "pin");
      if (typeof pin !== "string" || pin.length > 64) throw new BadRequest("pin missing");
      const result = auth.login(pin, address);
      if (result.ok) {
        this.options.logger.info({ address }, "admin logged in");
        res.setHeader(
          "set-cookie",
          `${SESSION_COOKIE}=${result.token}; Path=/api/admin; HttpOnly; SameSite=Strict`,
        );
        sendJson(res, 200, { ok: true });
      } else if (result.lockedForMs !== undefined) {
        this.options.logger.warn({ address }, "admin login locked after wrong PINs");
        const retryAfterSec = Math.ceil(result.lockedForMs / 1000);
        res.setHeader("retry-after", String(retryAfterSec));
        sendJson(res, 429, { error: "locked", retryAfterSec } satisfies AdminLoginError);
      } else {
        this.options.logger.warn({ address }, "admin login with wrong PIN");
        sendJson(res, 401, { error: "wrong-pin" } satisfies AdminLoginError);
      }
      return;
    }

    const token = readCookie(req, SESSION_COOKIE);
    if (!auth.check(token)) {
      sendJson(res, 401, { error: "login required" });
      return;
    }

    if (pathname === "/api/admin/logout" && post) {
      auth.logout(token);
      res.setHeader(
        "set-cookie",
        `${SESSION_COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; SameSite=Strict`,
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/admin/state" && !post) {
      // Numbers from an earlier run of the service mean nothing now: send the whole log.
      const sameRun = url.searchParams.get("epoch") === this.epoch;
      const after = sameRun ? Number(url.searchParams.get("eventsAfter") ?? 0) : 0;
      const body: AdminState = {
        generatedAt: new Date().toISOString(),
        clients: this.options.clients.list(),
        load: this.options.load(),
        eventsEpoch: this.epoch,
        events: this.options.events.after(Number.isFinite(after) ? after : 0),
        captures: this.options.captures?.list() ?? null,
      };
      sendJson(res, 200, body);
      return;
    }

    const { captures } = this.options;
    if (pathname === "/api/admin/captures" && post && captures) {
      const droneId = field(await readJson(req), "droneId");
      if (typeof droneId !== "string") throw new BadRequest("droneId missing");
      const result = captures.begin(droneId, CAPTURE_SECONDS);
      if (result.ok) {
        this.options.logger.info({ droneId, file: result.capture.file, address }, "admin started capture");
        sendJson(res, 200, result.capture);
      } else {
        sendJson(res, 409, { error: result.error } satisfies AdminCaptureError);
      }
      return;
    }

    const [, file] = CAPTURE_FILE.exec(pathname) ?? [];
    if (file !== undefined && !post && captures) {
      const filePath = captures.filePath(file);
      if (!filePath) {
        sendJson(res, 404, { error: "unknown capture" });
        return;
      }
      const stream = createReadStream(filePath);
      stream.on("open", () => {
        res.writeHead(200, {
          "content-type": "video/x-flv",
          "content-disposition": `attachment; filename="${file}"`,
          "cache-control": "no-store",
        });
        stream.pipe(res);
      });
      stream.on("error", (err) => {
        this.options.logger.warn({ err, file }, "cannot read capture");
        if (!res.headersSent) sendJson(res, 404, { error: "unknown capture" });
        else res.destroy();
      });
      return;
    }

    const [, encodedId, verb] = CLIENT_ACTION.exec(pathname) ?? [];
    if (encodedId !== undefined && verb !== undefined && post) {
      let clientId: string;
      try {
        clientId = decodeURIComponent(encodedId);
      } catch {
        throw new BadRequest("malformed id");
      }
      const { clients } = this.options;
      let done: boolean;
      switch (verb) {
        case "pause":
          done = clients.pause(clientId);
          break;
        case "resume":
          done = clients.resume(clientId);
          break;
        case "reload":
          done = clients.reload(clientId);
          break;
        default: {
          const name = field(await readJson(req), "name");
          if (name !== null && typeof name !== "string") throw new BadRequest("name missing");
          if (typeof name === "string" && name.trim().length > ADMIN_NAME_MAX)
            throw new BadRequest("name too long");
          done = clients.rename(clientId, name ?? undefined);
        }
      }
      if (done) this.options.logger.info({ clientId, action: verb, address }, "admin action");
      sendJson(res, done ? 200 : 404, done ? { ok: true } : { error: "unknown device" });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }
}
