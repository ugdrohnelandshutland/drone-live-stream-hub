import { describe, expect, it } from "vitest";
import { parseAvcDecoderConfig, parseSps, unescapeRbsp } from "../../src/shared/flv/avc.js";
import { isKeyframe, parseVideoTag } from "../../src/shared/flv/video.js";

// Real SPS NAL units from `ffmpeg -f lavfi -i testsrc2=s=WxH -c:v libx264 -profile:v <profile>`.
const SPS_1080P_HIGH = Buffer.from("67640028acd940780227e5c044000003000400000300f03c60c658", "hex");
const SPS_640X512_HIGH = Buffer.from("6764001eacd940a0106c0440000003004000000f03c58b6580", "hex");
const SPS_720P_BASELINE = Buffer.from("6742c01fd9005005bb0110000003001000000303c0f1832480", "hex");
const PPS = Buffer.from("68ebe3cb22c0", "hex");

function avcConfigRecord(sps: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([1, sps[1] ?? 0, sps[2] ?? 0, sps[3] ?? 0, 0xff, 0xe1]),
    Buffer.from([sps.length >> 8, sps.length & 0xff]),
    sps,
    Buffer.from([1, PPS.length >> 8, PPS.length & 0xff]),
    PPS,
  ]);
}

describe("parseSps", () => {
  it.each([
    [SPS_1080P_HIGH, 100, 40, 1920, 1080],
    [SPS_640X512_HIGH, 100, 30, 640, 512],
    [SPS_720P_BASELINE, 66, 31, 1280, 720],
  ])("parses profile, level and cropped size", (sps, profileIdc, levelIdc, width, height) => {
    expect(parseSps(sps)).toEqual({ profileIdc, levelIdc, width, height });
  });
});

describe("unescapeRbsp", () => {
  it("removes emulation prevention bytes", () => {
    expect(Buffer.from(unescapeRbsp(Buffer.from("0000030100000302", "hex"))).toString("hex")).toBe(
      "000001000002",
    );
  });
});

describe("parseAvcDecoderConfig", () => {
  it("returns the codec string and size", () => {
    expect(parseAvcDecoderConfig(avcConfigRecord(SPS_1080P_HIGH))).toEqual({
      profileIdc: 100,
      levelIdc: 40,
      codecString: "avc1.640028",
      width: 1920,
      height: 1080,
    });
  });

  it("rejects garbage", () => {
    expect(() => parseAvcDecoderConfig(Buffer.from([0, 1, 2]))).toThrow(RangeError);
  });
});

describe("parseVideoTag", () => {
  it("detects a legacy AVC sequence header", () => {
    const info = parseVideoTag(
      Buffer.concat([Buffer.from([0x17, 0x00, 0, 0, 0]), avcConfigRecord(SPS_1080P_HIGH)]),
    );
    expect(info).toMatchObject({
      codec: "avc",
      frameType: "key",
      packetType: "sequence-header",
      payloadOffset: 5,
    });
    expect(info && isKeyframe(info)).toBe(false);
  });

  it("detects AVC key and inter frames", () => {
    const key = parseVideoTag(Buffer.from([0x17, 0x01, 0, 0, 0, 0, 0, 0, 1]));
    const inter = parseVideoTag(Buffer.from([0x27, 0x01, 0, 0, 0, 0, 0, 0, 1]));
    expect(key && isKeyframe(key)).toBe(true);
    expect(inter).toMatchObject({ frameType: "inter", packetType: "coded-frame" });
    expect(inter && isKeyframe(inter)).toBe(false);
  });

  it("detects legacy HEVC (codec id 12)", () => {
    expect(parseVideoTag(Buffer.from([0x1c, 0x00, 0, 0, 0]))).toMatchObject({
      codec: "hevc",
      packetType: "sequence-header",
    });
  });

  it("detects Enhanced RTMP HEVC", () => {
    const header = parseVideoTag(Buffer.from([0x90, ...Buffer.from("hvc1"), 1]));
    expect(header).toMatchObject({
      codec: "hevc",
      enhanced: true,
      packetType: "sequence-header",
      frameType: "key",
    });
    const frame = parseVideoTag(Buffer.from([0x91, ...Buffer.from("hvc1"), 0, 0, 0, 1]));
    expect(frame).toMatchObject({ packetType: "coded-frame", payloadOffset: 8 });
    expect(frame && isKeyframe(frame)).toBe(true);
    const frameX = parseVideoTag(Buffer.from([0xa3, ...Buffer.from("hvc1"), 1]));
    expect(frameX).toMatchObject({ frameType: "inter", packetType: "coded-frame", payloadOffset: 5 });
  });

  it("returns undefined for empty or truncated tags", () => {
    expect(parseVideoTag(Buffer.alloc(0))).toBeUndefined();
    expect(parseVideoTag(Buffer.from([0x90, 0x68]))).toBeUndefined();
  });
});
