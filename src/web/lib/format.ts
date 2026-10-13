/** Pure formatting helpers for German UI text (no DOM, unit-tested). */
import type { DroneStatus, DroneVideoInfo, ServiceInfo } from "../../shared/api";

const CODEC_NAMES: Record<string, string> = { avc: "H.264", hevc: "H.265", av1: "AV1", vp9: "VP9" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "seit 14:03 Uhr" today, "seit 08.10. 14:03 Uhr" on other days. */
export function formatSince(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? `seit ${time}` : `seit ${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${time}`;
}

export function formatVideo(video: DroneVideoInfo | null): string | undefined {
  if (!video) return undefined;
  const codec = CODEC_NAMES[video.codec] ?? video.codec.toUpperCase();
  return video.width && video.height ? `${video.width}×${video.height} ${codec}` : codec;
}

export function formatViewers(count: number): string {
  return `${count} Zuschauer`;
}

/** Facts for a drone's strip, most important first: since when, picture format, viewers. */
export function droneFacts(drone: DroneStatus, now: Date = new Date()): string[] {
  const facts = [drone.since ? formatSince(drone.since, now) : "noch kein Signal"];
  if (drone.state === "live") {
    const video = formatVideo(drone.video);
    if (video) facts.push(video);
    facts.push(formatViewers(drone.viewerCount));
  }
  return facts;
}

export function countLive(drones: readonly DroneStatus[]): number {
  return drones.filter((d) => d.state === "live").length;
}

/** Build facts after name and version: ["Commit 1a2b3c4", "Build 10.10.2026 08:55 Uhr"]. */
export function buildFacts(info: ServiceInfo): string[] {
  const parts: string[] = [];
  if (info.commit) parts.push(`Commit ${info.commit}`);
  if (info.builtAt) {
    const date = new Date(info.builtAt);
    parts.push(
      `Build ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`,
    );
  } else {
    parts.push("Entwicklungsstand");
  }
  return parts;
}

/** "2026-10-10" → "10.10.2026" (a calendar date, no time zone involved). */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/** "10.10.2026 14:03:07 Uhr" (local time). */
export function formatDateTime(date: Date): string {
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} Uhr`
  );
}

/** Caption burnt into a still image: "Drohne 1 (m30t-01) · 10.10.2026 14:03:07 Uhr". */
export function snapshotCaption(name: string, droneId: string, date: Date): string {
  const who = name && name !== droneId ? `${name} (${droneId})` : droneId;
  return `${who} · ${formatDateTime(date)}`;
}

/** "2026-10-10_14-03-07_m30t-01.png": sorts by time across drones, safe on every file system. */
export function snapshotFileName(droneId: string, date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}_${time}_${droneId}.png`;
}
