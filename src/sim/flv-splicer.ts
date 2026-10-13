import { FlvStreamParser } from "../server/flv/reader.js";
import type { FlvTag } from "../server/flv/types.js";
import { createFlvHeader, encodeFlvTag } from "../server/flv/writer.js";

/**
 * Joins the FLV outputs of successive encoder processes into one continuous FLV stream:
 * one file header, timestamps that keep increasing across segments. A new segment starts
 * with its own onMetaData and sequence header, so the receiver sees a parameter change
 * inside one RTMP session — like a camera switch in Pilot 2.
 */
export class FlvSplicer {
  private parser = new FlvStreamParser();
  private headerWritten = false;
  private lastTimestamp = -1;
  private offset = 0;
  private segmentStart = true;

  constructor(
    private readonly write: (chunk: Buffer) => boolean,
    private readonly audio: boolean,
    private readonly frameDurationMs: number,
  ) {}

  /** Call before feeding the output of a new encoder. */
  beginSegment(): void {
    this.parser = new FlvStreamParser();
    this.segmentStart = true;
  }

  /** Feeds encoder output. Returns false when the destination wants us to pause. */
  push(chunk: Buffer): boolean {
    const out: Buffer[] = [];
    if (!this.headerWritten) {
      out.push(createFlvHeader({ audio: this.audio, video: true }));
      this.headerWritten = true;
    }
    for (const tag of this.parser.push(chunk)) out.push(encodeFlvTag(this.retime(tag)));
    return out.length === 0 ? true : this.write(Buffer.concat(out));
  }

  private retime(tag: FlvTag): FlvTag {
    if (this.segmentStart) {
      this.segmentStart = false;
      this.offset = this.lastTimestamp < 0 ? 0 : this.lastTimestamp + this.frameDurationMs - tag.timestamp;
    }
    const timestamp = Math.max(tag.timestamp + this.offset, this.lastTimestamp, 0);
    this.lastTimestamp = timestamp;
    return { ...tag, timestamp };
  }
}
