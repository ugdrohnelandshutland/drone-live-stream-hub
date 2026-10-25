import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Every browser gets a random id in a cookie on its first request (ADR 0012), sent along
 * with every later request, SSE and WebSocket. Set by the server, not by script: WebKit
 * caps script-set cookies at 7 days, and the page needs no code for it.
 */
export const CLIENT_COOKIE = "dlsh_client";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_AGE_SEC = 5 * 365 * 24 * 3600;

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export interface ClientCookie {
  clientId: string;
  /** Set-Cookie header value if the request had no valid id; undefined otherwise. */
  setCookie: string | undefined;
}

/** The request's client id, or a new one together with the header that stores it. */
export function clientCookie(req: IncomingMessage): ClientCookie {
  const existing = readCookie(req, CLIENT_COOKIE);
  if (existing && CLIENT_ID_PATTERN.test(existing)) return { clientId: existing, setCookie: undefined };
  const clientId = randomBytes(16).toString("base64url");
  return {
    clientId,
    setCookie: `${CLIENT_COOKIE}=${clientId}; Path=/; Max-Age=${MAX_AGE_SEC}; HttpOnly; SameSite=Lax`,
  };
}

/**
 * The client id for a request that must not create one (WebSocket of a script or simulated
 * viewer): undefined without a valid cookie.
 */
export function existingClientId(req: IncomingMessage): string | undefined {
  const value = readCookie(req, CLIENT_COOKIE);
  return value && CLIENT_ID_PATTERN.test(value) ? value : undefined;
}
