/**
 * Parsing of FLV video tag headers, legacy (codec id 7 = AVC, 12 = HEVC) and
 * Enhanced RTMP (FourCC-based, e.g. "hvc1"). Plain Uint8Array (a Buffer is one), so the
 * server and the browser (recording) share it.
 */

export type VideoCodec = "avc" | "hevc" | "av1" | "vp9" | "unknown";
export type VideoFrameType = "key" | "inter" | "disposable-inter" | "generated-key" | "command" | "unknown";
export type VideoPacketType = "sequence-header" | "coded-frame" | "end-of-sequence" | "metadata" | "other";

export interface VideoTagInfo {
  codec: VideoCodec;
  frameType: VideoFrameType;
  packetType: VideoPacketType;
  enhanced: boolean;
  /** Offset of the codec payload (e.g. AVCDecoderConfigurationRecord or NAL units) inside the tag body. */
  payloadOffset: number;
}

const FRAME_TYPES: Record<number, VideoFrameType> = {
  1: "key",
  2: "inter",
  3: "disposable-inter",
  4: "generated-key",
  5: "command",
};

const LEGACY_CODECS: Record<number, VideoCodec> = { 7: "avc", 12: "hevc" };

const FOURCC_CODECS: Record<string, VideoCodec> = {
  avc1: "avc",
  hvc1: "hevc",
  av01: "av1",
  vp09: "vp9",
};

export function parseVideoTag(data: Uint8Array): VideoTagInfo | undefined {
  const b0 = data[0];
  if (b0 === undefined) return undefined;
  const enhanced = (b0 & 0x80) !== 0;
  const frameType = FRAME_TYPES[(b0 >> 4) & 0x07] ?? "unknown";

  if (enhanced) {
    if (data.length < 5) return undefined;
    const codec = FOURCC_CODECS[String.fromCharCode(...data.subarray(1, 5))] ?? "unknown";
    const rawPacketType = b0 & 0x0f;
    let packetType: VideoPacketType;
    let payloadOffset = 5;
    switch (rawPacketType) {
      case 0:
        packetType = "sequence-header";
        break;
      case 1: // CodedFrames: 24-bit composition time follows (AVC/HEVC)
        packetType = "coded-frame";
        payloadOffset = codec === "avc" || codec === "hevc" ? 8 : 5;
        break;
      case 3: // CodedFramesX: composition time implied zero
        packetType = "coded-frame";
        break;
      case 2:
        packetType = "end-of-sequence";
        break;
      case 4:
        packetType = "metadata";
        break;
      default:
        packetType = "other";
    }
    return { codec, frameType, packetType, enhanced, payloadOffset };
  }

  const codec = LEGACY_CODECS[b0 & 0x0f] ?? "unknown";
  if (codec === "unknown" || data.length < 5) {
    return { codec, frameType, packetType: "other", enhanced, payloadOffset: 1 };
  }
  const rawPacketType = data[1];
  const packetType: VideoPacketType =
    rawPacketType === 0 ? "sequence-header" : rawPacketType === 1 ? "coded-frame" : "end-of-sequence";
  return { codec, frameType, packetType, enhanced, payloadOffset: 5 };
}

export function isKeyframe(info: VideoTagInfo): boolean {
  return (
    info.packetType === "coded-frame" && (info.frameType === "key" || info.frameType === "generated-key")
  );
}

/**
 * Composition time offset (pts - dts) of a coded AVC/HEVC frame in ms; non-zero means the
 * encoder uses B-frames. 0 for other tags and codecs.
 */
export function compositionTimeOffset(data: Uint8Array, info: VideoTagInfo): number {
  if (info.packetType !== "coded-frame" || (info.codec !== "avc" && info.codec !== "hevc")) return 0;
  if (!info.enhanced) return data.length >= 5 ? readInt24(data, 2) : 0;
  return info.payloadOffset === 8 && data.length >= 8 ? readInt24(data, 5) : 0;
}

/** Signed 24-bit big-endian integer. */
function readInt24(data: Uint8Array, offset: number): number {
  const value = ((data[offset] ?? 0) << 16) | ((data[offset + 1] ?? 0) << 8) | (data[offset + 2] ?? 0);
  return value & 0x800000 ? value - 0x1000000 : value;
}
