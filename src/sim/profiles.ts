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
