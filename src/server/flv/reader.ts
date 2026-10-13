import type { FlvTag, FlvTagType } from "./types.js";
import { FLV_HEADER_SIZE, FLV_TAG_HEADER_SIZE, PREVIOUS_TAG_SIZE_SIZE } from "./writer.js";

export class FlvParseError extends Error {
  override readonly name = "FlvParseError";
}

export interface FlvHeader {
  version: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/**
 * Incremental FLV byte-stream parser. Feed arbitrary chunks; complete tags are returned.
 * Used by tests and the simulated viewers.
 */
export class FlvStreamParser {
  private buffer: Buffer = Buffer.alloc(0);
  private headerParsed = false;
  header: FlvHeader | undefined;

  push(chunk: Buffer): FlvTag[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const tags: FlvTag[] = [];
    let offset = 0;

    if (!this.headerParsed) {
      if (this.buffer.length < FLV_HEADER_SIZE + PREVIOUS_TAG_SIZE_SIZE) return tags;
      if (this.buffer.toString("ascii", 0, 3) !== "FLV") throw new FlvParseError("missing FLV signature");
      const dataOffset = this.buffer.readUInt32BE(5);
      this.header = {
        version: this.buffer[3] ?? 0,
        hasAudio: ((this.buffer[4] ?? 0) & 0x04) !== 0,
        hasVideo: ((this.buffer[4] ?? 0) & 0x01) !== 0,
      };
      if (this.buffer.readUInt32BE(dataOffset) !== 0) throw new FlvParseError("PreviousTagSize0 is not zero");
      offset = dataOffset + PREVIOUS_TAG_SIZE_SIZE;
      this.headerParsed = true;
    }

    while (this.buffer.length - offset >= FLV_TAG_HEADER_SIZE) {
      const size = this.buffer.readUIntBE(offset + 1, 3);
      const total = FLV_TAG_HEADER_SIZE + size + PREVIOUS_TAG_SIZE_SIZE;
      if (this.buffer.length - offset < total) break;
      const type = (this.buffer[offset] ?? 0) & 0x1f;
      const timestamp =
        (this.buffer.readUIntBE(offset + 4, 3) | ((this.buffer[offset + 7] ?? 0) << 24)) >>> 0;
      const prevTagSize = this.buffer.readUInt32BE(offset + FLV_TAG_HEADER_SIZE + size);
      if (prevTagSize !== FLV_TAG_HEADER_SIZE + size) {
        throw new FlvParseError(
          `PreviousTagSize mismatch: expected ${FLV_TAG_HEADER_SIZE + size}, got ${prevTagSize}`,
        );
      }
      const data = Buffer.from(
        this.buffer.subarray(offset + FLV_TAG_HEADER_SIZE, offset + FLV_TAG_HEADER_SIZE + size),
      );
      tags.push({ type: type as FlvTagType, timestamp, data });
      offset += total;
    }

    this.buffer = offset === 0 ? this.buffer : this.buffer.subarray(offset);
    return tags;
  }
}
