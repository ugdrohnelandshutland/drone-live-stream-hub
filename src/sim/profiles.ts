/**
 * Simulated Pilot 2 stream profiles. Real values are unknown until an RC Plus is available
 * (CLAUDE.md §13); keep everything here easy to adjust.
 */

export interface Resolution {
  width: number;
  height: number;
}

export interface StreamProfile extends Resolution {
  name: string;
  fps: number;
  keyframeIntervalSec: number;
  bitrateKbps: number;
  /** Output size of the `zoom` camera; differs from the main size to force a sequence-header change. */
  zoom: Resolution;
  /** Output size of the `thermal` camera (M30T thermal sensor is 640×512). */
  thermal: Resolution;
  /** How Pilot 2 packs the stream beyond the encoder settings (inline switch mode only). */
  quirks?: StreamQuirks;
}

/**
 * Stream properties of a real RC Plus that ffmpeg does not produce, added by FlvSplicer.
 * Synthetic: no content from real captures (GPS, serial numbers) goes into the simulator.
 */
export interface StreamQuirks {
  /** Each picture timestamp is moved by up to ± this many ms (kept in order). */
  timestampJitterMs?: number;
  /** A separate video tag with only an SEI NAL unit before each picture, same timestamp. */
  seiOnlyTags?: boolean;
  /** About this often, a coded frame without any NAL unit (9-byte tag). */
  emptyTagIntervalMs?: number;
}

export const PROFILES: Record<string, StreamProfile> = {
  "1080p30": {
    name: "1080p30",
    width: 1920,
    height: 1080,
    fps: 30,
    keyframeIntervalSec: 2,
    bitrateKbps: 6000,
    zoom: { width: 1280, height: 720 },
    thermal: { width: 640, height: 512 },
  },
  /**
   * Values measured from two real RC Plus in the first field test (2026-10-26): coded height
   * 1088, zoom 1440×1088, thermal 1080×720, about 2 Mbit/s, a keyframe every second. Not
   * reproduced: Pilot 2 repeats the sequence header before every keyframe (ffmpeg drops
   * identical repeats when it pushes RTMP).
   * Pauses of 1–4.5 s in the stream come from the `dropout` scenario action.
   */
  "pilot2-real": {
    name: "pilot2-real",
    width: 1920,
    height: 1088,
    fps: 30,
    keyframeIntervalSec: 1,
    bitrateKbps: 2000,
    zoom: { width: 1440, height: 1088 },
    thermal: { width: 1080, height: 720 },
    // Second field test (2026-11-03): pictures stamped 2–37 ms apart, an SEI-only tag per
    // picture, an empty frame every 4–5 s.
    quirks: { timestampJitterMs: 15, seiOnlyTags: true, emptyTagIntervalMs: 4500 },
  },
  "720p30": {
    name: "720p30",
    width: 1280,
    height: 720,
    fps: 30,
    keyframeIntervalSec: 2,
    bitrateKbps: 3000,
    zoom: { width: 960, height: 540 },
    thermal: { width: 640, height: 512 },
  },
};

export const CAMERA_MODES = ["wide", "zoom", "thermal"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export function isCameraMode(value: string): value is CameraMode {
  return (CAMERA_MODES as readonly string[]).includes(value);
}

export function resolutionFor(profile: StreamProfile, camera: CameraMode): Resolution {
  switch (camera) {
    case "wide":
      return { width: profile.width, height: profile.height };
    case "zoom":
      return profile.zoom;
    case "thermal":
      return profile.thermal;
  }
}

/** Distinct background colours so tiles are easy to tell apart (0xRRGGBB). */
const DRONE_COLOURS = [
  "0x1f77b4",
  "0xd62728",
  "0x2ca02c",
  "0x9467bd",
  "0xff7f0e",
  "0x17becf",
  "0x8c564b",
  "0xe377c2",
];

export function colourForIndex(index: number): string {
  return DRONE_COLOURS[index % DRONE_COLOURS.length] ?? "0x1f77b4";
}
