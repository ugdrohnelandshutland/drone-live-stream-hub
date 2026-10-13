import type { FlvTag } from "./types.js";

export const FLV_HEADER_SIZE = 9;
export const FLV_TAG_HEADER_SIZE = 11;
export const PREVIOUS_TAG_SIZE_SIZE = 4;

/** FLV file header (9 bytes) followed by PreviousTagSize0 (4 zero bytes). */
export function createFlvHeader(options: { audio: boolean; video: boolean }): Buffer {
  const buf = Buffer.alloc(FLV_HEADER_SIZE + PREVIOUS_TAG_SIZE_SIZE);
  buf.write("FLV", 0, "ascii");
  buf[3] = 1; // version
  buf[4] = (options.audio ? 0x04 : 0) | (options.video ? 0x01 : 0);
  buf.writeUInt32BE(FLV_HEADER_SIZE, 5);
  // PreviousTagSize0 stays zero.
  return buf;
}

/** Encodes one tag: 11-byte header, body, then its PreviousTagSize. */
export function encodeFlvTag(tag: FlvTag): Buffer {
  const size = tag.data.length;
  if (size > 0xffffff) throw new RangeError(`FLV tag body too large: ${size} bytes`);
  const buf = Buffer.allocUnsafe(FLV_TAG_HEADER_SIZE + size + PREVIOUS_TAG_SIZE_SIZE);
  buf[0] = tag.type; // filter bit and reserved bits are zero
  buf.writeUIntBE(size, 1, 3);
  const ts = tag.timestamp >>> 0;
  buf.writeUIntBE(ts & 0xffffff, 4, 3);
  buf[7] = ts >>> 24; // TimestampExtended
  buf.writeUIntBE(0, 8, 3); // StreamID
  tag.data.copy(buf, FLV_TAG_HEADER_SIZE);
  buf.writeUInt32BE(FLV_TAG_HEADER_SIZE + size, FLV_TAG_HEADER_SIZE + size);
  return buf;
}
