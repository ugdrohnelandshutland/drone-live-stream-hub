/** What each player status means for the UI: one table instead of one map per view. */
import { t } from "../strings";
import type { PlayerStatus } from "./live-player";

/**
 * Visual tone, shared by badges, tile numbers and overlays. Never shown by colour alone: every
 * tone has its own mark (see components/status-badge.css).
 */
export type Tone = "live" | "nosignal" | "fault" | "pending" | "idle";

export interface StatusView {
  tone: Tone;
  /** Short word for badges. */
  label: string;
  /** Overlay title and detail; undefined while a picture is shown. */
  overlay: { title: string; detail: string } | undefined;
  /** Show without the settle delay (permanent conditions, not short interruptions). */
  immediate: boolean;
}

export function describeStatus(status: PlayerStatus, droneId: string): StatusView {
  switch (status) {
    case "playing":
      return { tone: "live", label: "Live", overlay: undefined, immediate: true };
    case "connecting":
      return {
        tone: "pending",
        label: "Verbinde …",
        overlay: { title: "Verbinde …", detail: "" },
        immediate: false,
      };
    case "waiting":
    case "offline":
      return {
        tone: "nosignal",
        label: "Kein Signal",
        overlay: { title: "Kein Signal", detail: "Warte auf die Drohne …" },
        immediate: false,
      };
    case "stalled":
      return {
        tone: "nosignal",
        label: "Kein Signal",
        overlay: { title: "Kein Signal", detail: "Das Bild steht – warte auf neue Daten …" },
        immediate: false,
      };
    case "error":
      return {
        tone: "fault",
        label: "Gestört",
        overlay: { title: "Verbindung gestört", detail: "Neuer Versuch läuft automatisch …" },
        immediate: false,
      };
    case "unknown-drone":
      return {
        tone: "fault",
        label: "Unbekannt",
        overlay: { title: "Unbekannte Drohne", detail: `„${droneId}“ ist nicht eingerichtet.` },
        immediate: true,
      };
    case "unsupported":
      return {
        tone: "fault",
        label: "Nicht unterstützt",
        overlay: {
          title: "Live-Wiedergabe nicht unterstützt",
          detail:
            "Dieser Browser kann den Stream nicht abspielen. Auf dem iPad wird iPadOS 17.1 oder neuer benötigt.",
        },
        immediate: true,
      };
  }
}

/**
 * A configured drone that is not publishing: normal while it is on the ground, so grey, not a
 * warning. `detail` for the single view, which waits for it.
 */
export function offlineView(detail = ""): StatusView {
  return { tone: "idle", label: "Offline", overlay: { title: "Kein Signal", detail }, immediate: true };
}

/** Overview tile with previews switched off (`?previews=0`). */
export const LIVE_WITHOUT_PREVIEW: StatusView = {
  tone: "live",
  label: "Live",
  overlay: { title: t.overview.previewsOff, detail: "" },
  immediate: true,
};
