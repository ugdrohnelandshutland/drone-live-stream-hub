import { encodeAmf0String } from "../../src/server/flv/amf0.js";
import { FlvTagType, type FlvTag } from "../../src/server/flv/types.js";

export function sequenceHeader(variant = 0, timestamp = 0): FlvTag {
  return {
    type: FlvTagType.Video,
    timestamp,
    data: Buffer.from([0x17, 0x00, 0, 0, 0, 1, 0x64, 0, 0x28, variant]),
  };
}

export function keyframe(timestamp: number, size = 100): FlvTag {
  return {
    type: FlvTagType.Video,
    timestamp,
    data: Buffer.concat([Buffer.from([0x17, 0x01, 0, 0, 0]), Buffer.alloc(size, 1)]),
  };
}

export function interframe(timestamp: number, size = 50): FlvTag {
  return {
    type: FlvTagType.Video,
    timestamp,
    data: Buffer.concat([Buffer.from([0x27, 0x01, 0, 0, 0]), Buffer.alloc(size, 2)]),
  };
}

export function metadataTag(): FlvTag {
  return {
    type: FlvTagType.Script,
    timestamp: 0,
    data: Buffer.concat([encodeAmf0String("onMetaData"), Buffer.from([0x05])]),
  };
}
