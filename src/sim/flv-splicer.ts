import { FlvStreamParser } from "../server/flv/reader.js";
import { FlvTagType, type FlvTag } from "../server/flv/types.js";
import { createFlvHeader, encodeFlvTag } from "../server/flv/writer.js";
import { parseVideoTag } from "../shared/flv/video.js";
import type { StreamQuirks } from "./profiles.js";

/** Coded AVC frame holding one SEI NAL unit (user data unregistered, zero UUID, "SIM"). */
const SEI_ONLY_FRAME = Buffer.from([
  0x27,
  0x01,
  0,
  0,
  0,
  0,
  0,
  0,
  0x17,
  0x06,
  0x05,
  0x13,
  ...new Array<number>(16).fill(0),
  0x53,
  0x49,
  0x4d,
  0x80,
]);
/** Coded AVC frame whose only NAL length field is 0, as Pilot 2 sends every few seconds. */
const EMPTY_FRAME = Buffer.from([0x27, 0x01, 0, 0, 0, 0, 0, 0, 0]);

/**
 * Joins the FLV outputs of successive encoder processes into one continuous FLV stream:
 * one file header, timestamps that keep increasing across segments. A new segment starts
 * with its own onMetaData and sequence header, so the receiver sees a parameter change
 * inside one RTMP session — like a camera switch in Pilot 2.
 *
 * `dropFor()` leaves out the frames of a few seconds while the session stays open: the stream
 * timestamps jump and the next frame is usually not a keyframe, like the pauses seen from a
 * real RC Plus. Metadata and sequence headers still pass, so a camera switch is not lost.
 *
 * `quirks` add what Pilot 2 does beyond the encoder: uneven picture timestamps, SEI-only
 * tags and empty frames.
 */
export class FlvSplicer {
  private parser = new FlvStreamParser();
  private headerWritten = false;
  private lastTimestamp = -1;
  private offset = 0;
  private segmentStart = true;
  private dropUntil = 0;
  /** Last timestamp written, after the quirks. */
  private lastWritten = 0;
  private lastEmptyAt = 0;

  constructor(
    private readonly write: (chunk: Buffer) => boolean,
    private readonly audio: boolean,
    private readonly frameDurationMs: number,
    private readonly now: () => number = Date.now,
    private readonly quirks: StreamQuirks = {},
    private readonly random: () => number = Math.random,
  ) {}

  /** Leaves out audio and video frames for `ms` from now. */
  dropFor(ms: number): void {
    this.dropUntil = this.now() + ms;
  }

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
    for (const tag of this.parser.push(chunk)) {
      const timed = this.retime(tag);
      if (!this.dropped(timed)) out.push(...this.withQuirks(timed).map(encodeFlvTag));
    }
    return out.length === 0 ? true : this.write(Buffer.concat(out));
  }

  private dropped(tag: FlvTag): boolean {
    if (this.now() >= this.dropUntil || tag.type === FlvTagType.Script) return false;
    return tag.type === FlvTagType.Audio || parseVideoTag(tag.data)?.packetType === "coded-frame";
  }

  private withQuirks(tag: FlvTag): FlvTag[] {
    const { timestampJitterMs = 0, seiOnlyTags = false, emptyTagIntervalMs } = this.quirks;
    if (tag.type !== FlvTagType.Video || parseVideoTag(tag.data)?.packetType !== "coded-frame") {
      this.lastWritten = Math.max(this.lastWritten, tag.timestamp);
      return [tag];
    }
    const jitter = Math.round((this.random() * 2 - 1) * timestampJitterMs);
    const timestamp = Math.max(this.lastWritten, tag.timestamp + jitter);
    this.lastWritten = timestamp;
    const tags: FlvTag[] = [];
    if (seiOnlyTags) tags.push({ type: FlvTagType.Video, timestamp, data: SEI_ONLY_FRAME });
    tags.push({ ...tag, timestamp });
    if (emptyTagIntervalMs !== undefined && timestamp - this.lastEmptyAt >= emptyTagIntervalMs) {
      this.lastEmptyAt = timestamp;
      tags.push({ type: FlvTagType.Video, timestamp, data: EMPTY_FRAME });
    }
    return tags;
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
