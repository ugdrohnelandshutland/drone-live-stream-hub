/** What the diagnostics page flags, compared with the simulator profile (no DOM, unit-tested). */
import type { DroneDiagnostics } from "../../../shared/diagnostics";

export interface Finding {
  level: "warn" | "info";
  text: string;
}

/** The simulator's Pilot 2 profile (src/sim/profiles.ts), shown as "expected" values. */
export const SIMULATOR_PROFILE = {
  codec: "H.264",
  profile: "High",
  resolutions: "1920×1080 / 1280×720, Wärmebild 640×512",
  fps: "30",
  bitrate: "3–6 Mbit/s",
  keyframeInterval: "2 s",
  bFrames: "keine",
  arrivalGap: "< 200 ms",
  audio: "keine",
} as const;

const KEYFRAME_WARN_MS = 2500;
const ARRIVAL_GAP_WARN_MS = 500;
const BITRATE_WARN_KBPS = 8000;
const FPS_WARN = 24;

export function findings(drone: DroneDiagnostics): Finding[] {
  const out: Finding[] = [];
  const video = drone.video;
  const m = drone.measurements;
  if (!drone.publisher) return out;

  if (video && video.codec !== "avc") {
    out.push({
      level: "warn",
      text:
        video.codec === "hevc"
          ? "H.265: Die Wiedergabe hängt vom Gerät ab (nicht jedes Tablet kann es)."
          : `Unerwarteter Codec „${video.codec}“.`,
    });
  } else if (video?.profile && video.profile !== SIMULATOR_PROFILE.profile) {
    out.push({ level: "info", text: `H.264-Profil ${video.profile} (Simulator: High).` });
  }
  if (!drone.metadata) out.push({ level: "info", text: "Keine Metadaten (onMetaData) empfangen." });

  if (m && drone.live) {
    const key = m.keyframeIntervalMs;
    if (key && key.max > KEYFRAME_WARN_MS) {
      const sec = (key.max / 1000).toFixed(1).replace(".", ",");
      out.push({
        level: "warn",
        text: `Keyframe-Abstand bis ${sec} s: Neue Zuschauer und Kamerawechsel warten so lange auf das erste Bild.`,
      });
    }
    if (m.bFrames) {
      out.push({
        level: "warn",
        text: "Der Encoder nutzt B-Frames: etwas mehr Latenz; der Simulator sendet keine.",
      });
    }
    if (m.fps !== null && m.windowSec >= 5 && m.fps < FPS_WARN) {
      out.push({ level: "warn", text: `Nur ${String(m.fps).replace(".", ",")} Bilder/s empfangen.` });
    }
    if (m.kbps !== null && m.kbps > BITRATE_WARN_KBPS) {
      out.push({
        level: "warn",
        text: `Hohe Bitrate (${(m.kbps / 1000).toFixed(1).replace(".", ",")} Mbit/s): belastet das WLAN pro Zuschauer.`,
      });
    }
    if (m.maxArrivalGapMs !== null && m.maxArrivalGapMs > ARRIVAL_GAP_WARN_MS) {
      out.push({
        level: "warn",
        text: `Empfangslücken bis ${m.maxArrivalGapMs} ms: Funkstrecke oder WLAN zwischen Fernsteuerung und PC prüfen.`,
      });
    }
  }
  const totals = drone.totals;
  if (totals && totals.timestampJumps > 0) {
    out.push({
      level: "info",
      text: `${totals.timestampJumps} Zeitstempel-Sprünge (z. B. bei Kamerawechsel). Die Wiedergabe fängt das ab.`,
    });
  }
  if (totals && totals.audioTags > 0) {
    out.push({
      level: "info",
      text: `Tonspur (${totals.audioCodec ?? "unbekannt"}) wird mitgesendet und vom Service verworfen.`,
    });
  }
  return out;
}
