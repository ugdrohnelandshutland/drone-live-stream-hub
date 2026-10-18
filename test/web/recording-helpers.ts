/** Synthetic FLV streams and a minimal MP4 box reader for the recording tests (no Buffer). */

// Real SPS NAL units (as in test/unit/flv-video.test.ts).
export const SPS_1080P = hex("67640028acd940780227e5c044000003000400000300f03c60c658");
export const SPS_640X512 = hex("6764001eacd940a0106c0440000003004000000f03c58b6580");
const PPS = hex("68ebe3cb22c0");

export function hex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function avcConfigRecord(sps: Uint8Array): Uint8Array {
  return concat([
    Uint8Array.from([
      1,
      sps[1] ?? 0,
      sps[2] ?? 0,
      sps[3] ?? 0,
      0xff,
      0xe1,
      sps.length >> 8,
      sps.length & 0xff,
    ]),
    sps,
    Uint8Array.from([1, PPS.length >> 8, PPS.length & 0xff]),
    PPS,
  ]);
}

export const FLV_HEADER = Uint8Array.from([0x46, 0x4c, 0x56, 1, 0x01, 0, 0, 0, 9, 0, 0, 0, 0]);

/** One FLV tag with its PreviousTagSize. */
export function flvTag(type: number, timestamp: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + body.length + 4);
  const view = new DataView(out.buffer);
  out[0] = type;
  out[1] = (body.length >> 16) & 0xff;
  out[2] = (body.length >> 8) & 0xff;
  out[3] = body.length & 0xff;
  out[4] = (timestamp >> 16) & 0xff;
  out[5] = (timestamp >> 8) & 0xff;
  out[6] = timestamp & 0xff;
  out[7] = (timestamp >>> 24) & 0xff;
  out.set(body, 11);
  view.setUint32(11 + body.length, 11 + body.length);
  return out;
}

export function sequenceHeaderTag(sps: Uint8Array, timestamp = 0): Uint8Array {
  return flvTag(9, timestamp, concat([Uint8Array.from([0x17, 0, 0, 0, 0]), avcConfigRecord(sps)]));
}

export function hevcSequenceHeaderTag(): Uint8Array {
  return flvTag(9, 0, Uint8Array.from([0x1c, 0, 0, 0, 0, 1, 2, 3]));
}

/**
 * A coded frame whose payload names its timestamp, so tests can tell frames apart: one
 * length-prefixed NAL unit of 8 bytes (type 5 = IDR or 1 = non-IDR, then the timestamp).
 */
export function frameTag(timestamp: number, keyframe: boolean): Uint8Array {
  const nal = new Uint8Array(12);
  const view = new DataView(nal.buffer);
  view.setUint32(0, 8);
  nal[4] = keyframe ? 0x65 : 0x41;
  view.setUint32(8, timestamp);
  return flvTag(9, timestamp, concat([Uint8Array.from([keyframe ? 0x17 : 0x27, 1, 0, 0, 0]), nal]));
}

/** Timestamps encoded in the samples of an MP4 written from frameTag() frames, in file order. */
export function sampleTimestamps(mp4: Uint8Array): number[] {
  const mdat = findBox(mp4, ["mdat"]);
  if (!mdat) throw new Error("no mdat");
  const view = new DataView(mp4.buffer, mp4.byteOffset);
  const timestamps: number[] = [];
  for (let offset = mdat.start; offset < mdat.end; offset += 12) timestamps.push(view.getUint32(offset + 8));
  return timestamps;
}

export interface BoxRange {
  /** Offset of the box payload (after size and type). */
  start: number;
  end: number;
}

/** Finds a box by its path of types, e.g. ["moov", "trak", "mdia", "minf", "stbl", "stsz"]. */
export function findBox(
  data: Uint8Array,
  path: readonly string[],
  from = 0,
  to = data.length,
): BoxRange | undefined {
  const view = new DataView(data.buffer, data.byteOffset);
  let offset = from;
  while (offset + 8 <= to) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    if (size < 8) return undefined;
    if (type === path[0]) {
      const range = { start: offset + 8, end: offset + size };
      return path.length === 1 ? range : findBox(data, path.slice(1), range.start, range.end);
    }
    offset += size;
  }
  return undefined;
}

export function boxTypes(data: Uint8Array): string[] {
  const view = new DataView(data.buffer, data.byteOffset);
  const types: string[] = [];
  for (let offset = 0; offset + 8 <= data.length; offset += view.getUint32(offset)) {
    types.push(String.fromCharCode(...data.subarray(offset + 4, offset + 8)));
    if (view.getUint32(offset) < 8) break;
  }
  return types;
}

/** The 32-bit values of a full box's payload after version/flags. */
export function fullBoxWords(data: Uint8Array, path: readonly string[]): number[] {
  const range = findBox(data, path);
  if (!range) throw new Error(`no ${path.join("/")}`);
  const view = new DataView(data.buffer, data.byteOffset);
  const words: number[] = [];
  for (let offset = range.start + 4; offset + 4 <= range.end; offset += 4) words.push(view.getUint32(offset));
  return words;
}

export const STBL = ["moov", "trak", "mdia", "minf", "stbl"] as const;

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
