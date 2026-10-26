import { describe, expect, it } from "vitest";
import type { DroneDiagnostics } from "../../src/shared/diagnostics";
import { findings, malformedSummary } from "../../src/web/features/diagnostics/checks";

const base: DroneDiagnostics = {
  id: "m30t-01",
  name: "Drohne 1",
  live: true,
  publisher: { sessionId: "s", remoteAddress: "10.0.0.7:1", startedAt: "", endedAt: null, connect: {} },
  metadata: { width: 1920 },
  video: {
    codec: "avc",
    codecString: "avc1.640028",
    profile: "High",
    level: "4.0",
    width: 1920,
    height: 1080,
  },
  measurements: {
    windowSec: 10,
    fps: 30,
    kbps: 6000,
    keyframeIntervalMs: { avg: 2000, min: 2000, max: 2000 },
    avgKeyframeBytes: 100_000,
    maxArrivalGapMs: 60,
    bFrames: false,
  },
  totals: {
    frames: 1,
    keyframes: 1,
    bytes: 1,
    sequenceHeaders: 1,
    timestampJumps: 0,
    malformedFrames: 0,
    nalProblems: { overrun: 0, "zero-length": 0, "trailing-bytes": 0, "start-code": 0 },
    audioTags: 0,
    audioCodec: null,
  },
  delivery: null,
  events: [],
};

describe("diagnostics findings", () => {
  it("has nothing to say about a stream like the simulator's", () => {
    expect(findings(base)).toEqual([]);
    expect(findings({ ...base, publisher: null })).toEqual([]);
  });

  it("flags what differs from the simulator profile", () => {
    const texts = findings({
      ...base,
      metadata: null,
      video: { ...base.video!, codec: "hevc", profile: null, level: null },
      measurements: {
        ...base.measurements!,
        fps: 20,
        kbps: 12_000,
        keyframeIntervalMs: { avg: 4000, min: 4000, max: 4000 },
        maxArrivalGapMs: 1200,
        bFrames: true,
      },
      totals: {
        ...base.totals!,
        timestampJumps: 2,
        malformedFrames: 1234,
        nalProblems: { overrun: 1200, "zero-length": 0, "trailing-bytes": 0, "start-code": 34 },
        audioTags: 5,
        audioCodec: "AAC",
      },
    }).map((f) => `${f.level}: ${f.text}`);
    expect(texts).toEqual([
      "warn: H.265: Die Wiedergabe hängt vom Gerät ab (nicht jedes Tablet kann es).",
      "info: Keine Metadaten (onMetaData) empfangen.",
      "warn: Keyframe-Abstand bis 4,0 s: Neue Zuschauer und Kamerawechsel warten so lange auf das erste Bild.",
      "warn: Der Encoder nutzt B-Frames: etwas mehr Latenz; der Simulator sendet keine.",
      "warn: Nur 20 Bilder/s empfangen.",
      "warn: Hohe Bitrate (12,0 Mbit/s): belastet das WLAN pro Zuschauer.",
      "warn: Empfangslücken bis 1200 ms: Funkstrecke oder WLAN zwischen Fernsteuerung und PC prüfen.",
      "info: 2 Zeitstempel-Sprünge (z. B. bei Kamerawechsel). Die Wiedergabe fängt das ab.",
      "warn: 1.234 Bilder mit fehlerhafter NAL-Struktur (Länge zu groß 1.200, Startcode statt Länge 34). Browser verwerfen den Rest dieser Bilder (kurze Bildfehler); strengere Empfänger brechen ab.",
      "info: Tonspur (AAC) wird mitgesendet und vom Service verworfen.",
    ]);
  });

  it("sums up malformed frames for the counter table", () => {
    expect(malformedSummary(null)).toBe("–");
    expect(malformedSummary(base.totals)).toBe("0");
    expect(
      malformedSummary({
        ...base.totals!,
        malformedFrames: 3,
        nalProblems: { overrun: 0, "zero-length": 2, "trailing-bytes": 1, "start-code": 0 },
      }),
    ).toBe("3 (Länge 0 2, Restbytes am Ende 1)");
  });
});
