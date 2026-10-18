/**
 * Minimal incremental FLV tag reader for the browser (Uint8Array, no Buffer). The server sends
 * whole tags per WebSocket message, but the reader does not rely on it.
 */

export interface FlvTagView {
  type: number;
  /** Milliseconds, as sent (32-bit, wraps). */
  timestamp: number;
  /** Tag body without the 11-byte tag header; a view into the pushed chunk. */
  body: Uint8Array;
}

const FLV_HEADER_SIZE = 9;
const TAG_HEADER_SIZE = 11;
const PREVIOUS_TAG_SIZE_SIZE = 4;

export class FlvTagReader {
  private rest: Uint8Array | undefined;
  private atStreamStart = true;

  /** A new connection: the next bytes start with the FLV file header. */
  reset(): void {
    this.rest = undefined;
    this.atStreamStart = true;
  }

  push(chunk: Uint8Array): FlvTagView[] {
    let data = chunk;
    if (this.rest) {
      data = new Uint8Array(this.rest.length + chunk.length);
      data.set(this.rest);
      data.set(chunk, this.rest.length);
      this.rest = undefined;
    }
    let offset = 0;

    if (this.atStreamStart) {
      if (data.length < FLV_HEADER_SIZE + PREVIOUS_TAG_SIZE_SIZE) {
        this.rest = data;
        return [];
      }
      this.atStreamStart = false;
      // "FLV": skip the file header and PreviousTagSize0. Anything else: already inside tags.
      if (data[0] === 0x46 && data[1] === 0x4c && data[2] === 0x56) {
        offset = readUint32(data, 5) + PREVIOUS_TAG_SIZE_SIZE;
      }
    }

    const tags: FlvTagView[] = [];
    while (data.length - offset >= TAG_HEADER_SIZE) {
      const size = ((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
      const end = offset + TAG_HEADER_SIZE + size;
      if (end + PREVIOUS_TAG_SIZE_SIZE > data.length) break;
      const timestamp =
        (((data[offset + 4] ?? 0) << 16) |
          ((data[offset + 5] ?? 0) << 8) |
          (data[offset + 6] ?? 0) |
          ((data[offset + 7] ?? 0) << 24)) >>>
        0;
      tags.push({
        type: (data[offset] ?? 0) & 0x1f,
        timestamp,
        body: data.subarray(offset + TAG_HEADER_SIZE, end),
      });
      offset = end + PREVIOUS_TAG_SIZE_SIZE;
    }
    if (offset < data.length) this.rest = data.slice(offset);
    return tags;
  }
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  );
}
