/**
 * Every request of the web UI goes through here: the one place to add credentials once the
 * UI gets a login (ADR 0003).
 */
import type { StreamMode } from "../player/live-player";

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (!response.ok) throw new HttpError(response.status, await response.json().catch(() => undefined));
  return (await response.json()) as T;
}

/** Thrown for a non-2xx answer, so callers can tell 401 (login) from other failures. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

/** JSON POST (admin page). The body is JSON even when empty: the server requires the type. */
export async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new HttpError(response.status, data);
  return data as T;
}

export function openEventSource(path: string): EventSource {
  return new EventSource(path);
}

export function liveStreamUrl(droneId: string, mode: StreamMode = "full"): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const query = mode === "keyframes" ? "?keyframes=1" : "";
  return `${protocol}://${location.host}/ws/live/${encodeURIComponent(droneId)}${query}`;
}
