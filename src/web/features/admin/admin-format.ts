/** Pure formatting for the admin page (no DOM, unit-tested). */
import type { AdminClient, AdminEvent, AdminQuality } from "../../../shared/admin";
import { t } from "../../strings";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "14:03:07" (local time). */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "850 kbit/s", "4,2 Mbit/s". */
export function formatKbps(kbps: number): string {
  if (kbps < 1000) return `${Math.round(kbps)} kbit/s`;
  return `${(kbps / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mbit/s`;
}

/** "112 MB" (decimal units). */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/** "7,5 MB", "0,2 MB" (decimal units, one decimal). */
export function formatFileSize(bytes: number): string {
  return `${(bytes / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

/** "26.10. 19:52:18" (local time). */
export function dayAndTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${clockTime(iso)}`;
}

/** "45 s", "12 min", "3 h 05 min", "2 d 4 h". */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${pad(minutes % 60)} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** The admin's name, else the browser label, else a placeholder. */
export function clientLabel(client: Pick<AdminClient, "name" | "device">): string {
  return client.name ?? (client.device || t.admin.unknownDevice);
}

/** Problems first; empty list means a clean connection. */
export function qualityIssues(quality: AdminQuality): string[] {
  const issues: string[] = [];
  if (quality.aborts > 0) issues.push(t.admin.aborts(quality.aborts));
  if (quality.slowClosures > 0) issues.push(t.admin.slowClosures(quality.slowClosures));
  if (quality.droppedFrames > 0) issues.push(t.admin.droppedFrames(quality.droppedFrames));
  return issues;
}

/** One line of the event log; `droneName` maps ids to the configured names. */
export function eventText(event: AdminEvent, droneName: (id: string) => string): string {
  const drone = event.droneId !== undefined ? droneName(event.droneId) : "";
  const who = event.client || t.admin.unknownDevice;
  const at = event.address ? ` (${event.address})` : "";
  switch (event.kind) {
    case "drone-live":
      return `${drone} ist live`;
    case "drone-offline":
      return `${drone} ist offline`;
    case "stream-reset":
      return event.detail === "publisher"
        ? `${drone}: Fernsteuerung neu verbunden`
        : `${drone}: Kamera oder Bildformat gewechselt`;
    case "publish-rejected":
      return `Abgewiesen: Stream-Key „${event.detail ?? ""}“${at}`;
    case "client-online":
      return `${who}${at} verbunden`;
    case "client-offline":
      return `${who}${at} getrennt`;
    case "client-paused":
      return `${who}${at} angehalten`;
    case "client-resumed":
      return `${who}${at} freigegeben`;
    case "client-reload":
      return `${who}${at} neu geladen`;
    case "client-renamed":
      return event.detail ? `Gerät${at} heißt jetzt „${event.detail}“` : `Name von Gerät${at} entfernt`;
  }
}
