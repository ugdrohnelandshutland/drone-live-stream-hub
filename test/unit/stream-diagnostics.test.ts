import { describe, expect, it } from "vitest";
import { encodeAmf0String } from "../../src/server/flv/amf0.js";
import { avcLevelName, avcProfileName } from "../../src/shared/flv/avc.js";
import { compositionTimeOffset, parseVideoTag } from "../../src/shared/flv/video.js";
import { amfToJson, StreamDiagnostics } from "../../src/server/diagnostics/stream-diagnostics.js";
import { createLogger } from "../../src/server/logger.js";
import { DroneRegistry } from "../../src/server/registry/registry.js";
import { FakeIngest } from "../helpers/fake-ingest.js";

const logger = createLogger({ name: "test", level: "silent" });

// AVC sequence header with a real 1920x1080 High 4.0 SPS.
const SPS = Buffer.from("67640028acd940780227e5c044000003000400000300f03c60c658", "hex");
const AVC_SEQ = Buffer.concat([
  Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, SPS.length]),
  SPS,
  Buffer.from([1, 0, 4, 0x68, 0xeb, 0xe3, 0xcb]),
]);

/** Coded AVC frame with a composition time offset (B-frames when non-zero). */
function frame(key: boolean, size: number, cts = 0): Buffer {
  const header = Buffer.from([key ? 0x17 : 0x27, 0x01, 0, 0, 0]);
  header.writeIntBE(cts, 2, 3);
  return Buffer.concat([header, Buffer.alloc(size)]);
}

function metadata(fields: Record<string, number | string>): Buffer {
  const parts = [encodeAmf0String("onMetaData"), Buffer.from([0x08, 0, 0, 0, Object.keys(fields).length])];
  for (const [key, value] of Object.entries(fields)) {
    const name = Buffer.alloc(2 + key.length);
    name.writeUInt16BE(key.length);
    name.write(key, 2, "utf8");
    parts.push(name);
    if (typeof value === "number") {
      const n = Buffer.alloc(9);
      n.writeDoubleBE(value, 1);
      parts.push(n);
    } else {
      parts.push(encodeAmf0String(value));
    }
  }
  parts.push(Buffer.from([0, 0, 9]));
  return Buffer.concat(parts);
}

function setup() {
  let clock = 1_000_000;
  const ingest = new FakeIngest();
  const registry = new DroneRegistry([{ id: "m30t-01", name: "Drohne 1" }], logger, () => new Date(clock));
  registry.attach(ingest);
  const diagnostics = new StreamDiagnostics({ ingest, registry, logger, now: () => clock });
  return {
    ingest,
    diagnostics,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Feeds `seconds` of 30 fps video with a keyframe every `gopSec`. */
function stream(
  t: ReturnType<typeof setup>,
  sessionId: string,
  seconds: number,
  { gopSec = 2, startDts = 0, cts = 0 } = {},
): number {
  let dts = startDts;
  for (let i = 0; i < seconds * 30; i++) {
    const key = i % (gopSec * 30) === 0;
    t.ingest.video(sessionId, frame(key, key ? 20_000 : 2_000, cts), dts);
    dts += 33;
    t.advance(1000 / 30);
  }
  return dts;
}

describe("FLV helpers for diagnostics", () => {
  it("reads composition time offsets and names AVC profiles and levels", () => {
    const withB = frame(false, 10, 66);
    expect(compositionTimeOffset(withB, parseVideoTag(withB)!)).toBe(66);
    const plain = frame(true, 10);
    expect(compositionTimeOffset(plain, parseVideoTag(plain)!)).toBe(0);
    expect(avcProfileName(100)).toBe("High");
    expect(avcProfileName(1)).toBe("profile 1");
    expect(avcLevelName(40)).toBe("4.0");
    expect(avcLevelName(31)).toBe("3.1");
  });

  it("converts AMF values to JSON", () => {
    expect(amfToJson({ a: undefined, b: new Date(0), c: [1, NaN], d: "x" })).toEqual({
      a: null,
      b: "1970-01-01T00:00:00.000Z",
      c: [1, null],
      d: "x",
    });
  });
});

describe("StreamDiagnostics", () => {
  it("reports publisher, metadata, format and live measurements", () => {
    const t = setup();
    t.ingest.publish("m30t-01", "s1", "10.0.0.7:50000", { flashVer: "FMLE/3.0", tcUrl: "rtmp://pc/live" });
    t.ingest.metadata("s1", metadata({ width: 1920, height: 1080, framerate: 30, encoder: "DJI" }));
    t.ingest.video("s1", AVC_SEQ);
    stream(t, "s1", 12);
    t.ingest.audio("s1", Buffer.from([0xaf, 0x01, 0]));

    const d = t.diagnostics.snapshot("m30t-01")!;
    expect(d.live).toBe(true);
    expect(d.publisher).toMatchObject({
      sessionId: "s1",
      remoteAddress: "10.0.0.7:50000",
      endedAt: null,
      connect: { flashVer: "FMLE/3.0", tcUrl: "rtmp://pc/live" },
    });
    expect(d.metadata).toMatchObject({ width: 1920, height: 1080, framerate: 30, encoder: "DJI" });
    expect(d.video).toEqual({
      codec: "avc",
      codecString: "avc1.640028",
      profile: "High",
      level: "4.0",
      width: 1920,
      height: 1080,
    });
    const m = d.measurements!;
    expect(m.windowSec).toBe(10);
    expect(m.fps).toBeCloseTo(30, 0);
    // 2 s GOP: one 20 kB keyframe + 59 × 2 kB per 2 s ≈ 552 kbit/s
    expect(m.kbps).toBeGreaterThan(500);
    expect(m.kbps).toBeLessThan(600);
    expect(m.keyframeIntervalMs).toEqual({ avg: 1980, min: 1980, max: 1980 });
    expect(m.avgKeyframeBytes).toBe(20_005);
    expect(m.maxArrivalGapMs).toBeLessThan(40);
    expect(m.bFrames).toBe(false);
    expect(d.totals).toMatchObject({
      frames: 360,
      keyframes: 6,
      sequenceHeaders: 1,
      timestampJumps: 0,
      audioTags: 1,
      audioCodec: "AAC",
    });
    expect(d.events.map((e) => e.kind)).toEqual(["sequence-header", "metadata", "publish"]);
    expect(d.events[0]?.text).toBe("sequence header: AVC High 4.0 1920x1080");
  });

  it("detects B-frames, timestamp jumps, stalls, replacement and keeps the last session", () => {
    const t = setup();
    t.ingest.publish("m30t-01", "s1", "10.0.0.7:1");
    const dts = stream(t, "s1", 3, { cts: 66 });
    t.advance(3000); // nothing arrives for 3 s
    expect(t.diagnostics.snapshot("m30t-01")!.measurements!.maxArrivalGapMs).toBeGreaterThanOrEqual(3000);
    stream(t, "s1", 1, { startDts: dts + 5000 }); // encoder restarted its clock
    let d = t.diagnostics.snapshot("m30t-01")!;
    expect(d.measurements!.bFrames).toBe(true);
    expect(d.totals!.timestampJumps).toBe(1);

    t.ingest.publish("m30t-01", "s2", "10.0.0.8:2"); // RC reconnects before the old TCP dies
    t.ingest.unpublish("s1");
    t.ingest.unpublish("s2");
    d = t.diagnostics.snapshot("m30t-01")!;
    expect(d.live).toBe(false);
    expect(d.publisher).toMatchObject({ sessionId: "s2", remoteAddress: "10.0.0.8:2" });
    expect(d.publisher!.endedAt).not.toBeNull();
    expect(d.events.map((e) => e.kind)).toEqual([
      "unpublish",
      "publish",
      "replaced",
      "timestamp-jump",
      "publish",
    ]);
  });

  it("lists rejected stream keys and nothing for drones that never published", () => {
    const t = setup();
    expect(t.ingest.publish("m30t-99", "x", "10.0.0.9:3")).toBe(false);
    t.advance(5000);
    t.ingest.publish("m30t-99", "y", "10.0.0.9:4"); // the RC retries from a new port
    t.ingest.publish("m30t-98", "z", "[fe80::1]:5");
    expect(t.diagnostics.rejectedPublishes()).toEqual([
      expect.objectContaining({ streamKey: "m30t-98", remoteHost: "fe80::1", attempts: 1 }),
      expect.objectContaining({
        streamKey: "m30t-99",
        remoteHost: "10.0.0.9",
        attempts: 2,
        firstAt: new Date(1_000_000).toISOString(),
        lastAt: new Date(1_005_000).toISOString(),
      }),
    ]);
    expect(t.diagnostics.snapshot("m30t-01")).toBeUndefined();
  });
});
