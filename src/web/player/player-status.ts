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
  /** A note over a picture that stays visible (the last one, while no new frame arrives). */
  hint?: { title: string; detail: string };
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
    case "paused":
      return pausedView();
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

/** An admin paused this device (ADR 0012): no picture until released, also without a player. */
export function pausedView(): StatusView {
  return {
    tone: "idle",
    label: t.paused.label,
    overlay: { title: t.paused.title, detail: "" },
    immediate: true,
  };
}

/**
 * Why a live drone shows no new picture, from the hub's view (DroneStatus.stalledSince):
 * "drone" — the drone sends nothing (RC drops frames, radio link); "connection" — the drone
 * sends, but this device does not receive it fast enough (weak Wi-Fi).
 */
export type StallCause = "drone" | "connection";

/**
 * A live drone whose picture stopped: the last picture stays with a note on the cause.
 * "Kein Signal" is kept for a drone that is gone; the hub reports that after 10 s without data.
 */
export function stalledView(cause: StallCause, withDetail: boolean): StatusView {
  const text = t.stall[cause];
  return {
    tone: cause === "drone" ? "nosignal" : "pending",
    label: text.label,
    overlay: undefined,
    hint: { title: text.title, detail: withDetail ? text.detail : "" },
    immediate: false,
  };
}

/** Live, but no picture yet (connecting, or the first keyframe has not arrived). */
export function noPictureYetView(cause: StallCause | undefined, withDetail: boolean): StatusView {
  if (cause !== "drone") return describeStatus("connecting", "");
  return {
    tone: "nosignal",
    label: t.stall.drone.label,
    overlay: { title: t.stall.drone.title, detail: withDetail ? t.stall.drone.detail : "" },
    immediate: false,
  };
}
