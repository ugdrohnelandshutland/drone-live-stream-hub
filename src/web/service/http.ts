/**
 * Every request of the web UI goes through here: the one place to add credentials once the
 * UI gets a login (ADR 0003).
 */
import type { StreamMode } from "../player/live-player";

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function openEventSource(path: string): EventSource {
  return new EventSource(path);
}

export function liveStreamUrl(droneId: string, mode: StreamMode = "full"): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const query = mode === "keyframes" ? "?keyframes=1" : "";
  return `${protocol}://${location.host}/ws/live/${encodeURIComponent(droneId)}${query}`;
}
