import type { FlvTag } from "../flv/types.js";
import { isKeyframe, parseVideoTag, type VideoTagInfo } from "../../shared/flv/video.js";

export interface GopCacheOptions {
  /** Drop the cached GOP if it grows beyond this many bytes (until the next keyframe). */
  maxGopBytes: number;
}

export type VideoTagKind =
  | { kind: "sequence-header"; changed: boolean }
  | { kind: "keyframe" }
  | { kind: "frame" }
  | { kind: "other" }
  | { kind: "invalid" };

/**
 * Per-stream cache so a new viewer can start decoding immediately: the `onMetaData` tag,
 * the latest video sequence header and all video tags since the last keyframe.
 */
export class GopCache {
  private metadataTag: FlvTag | undefined;
  private sequenceHeaderTag: FlvTag | undefined;
  private gop: FlvTag[] = [];
  private gopBytes = 0;
  /** Set when the GOP was dropped for exceeding the byte limit; cleared at the next keyframe. */
  private overflowed = false;
  gopOverflows = 0;

  constructor(private readonly options: GopCacheOptions) {}

  get metadata(): FlvTag | undefined {
    return this.metadataTag;
  }

  get sequenceHeader(): FlvTag | undefined {
    return this.sequenceHeaderTag;
  }

  /** True when a viewer could start right now (sequence header and a keyframe are cached). */
  get ready(): boolean {
    return this.sequenceHeaderTag !== undefined && this.gop.length > 0;
  }

  get byteSize(): number {
    return this.gopBytes + (this.metadataTag?.data.length ?? 0) + (this.sequenceHeaderTag?.data.length ?? 0);
  }

  get gopLength(): number {
    return this.gop.length;
  }

  setMetadata(tag: FlvTag): void {
    this.metadataTag = tag;
  }

  /** Adds a video tag and reports what it was. A changed sequence header clears the GOP. */
  addVideoTag(tag: FlvTag, info: VideoTagInfo | undefined = parseVideoTag(tag.data)): VideoTagKind {
    if (!info) return { kind: "invalid" };

    if (info.packetType === "sequence-header") {
      const previous = this.sequenceHeaderTag;
      const changed = previous !== undefined && !previous.data.equals(tag.data);
      this.sequenceHeaderTag = tag;
      if (changed) this.clearGop();
      return { kind: "sequence-header", changed };
    }

    if (info.packetType !== "coded-frame") return { kind: "other" };

    if (isKeyframe(info)) {
      this.clearGop();
      this.overflowed = false;
      this.push(tag);
      return { kind: "keyframe" };
    }

    if (this.gop.length > 0 && !this.overflowed) this.push(tag);
    return { kind: "frame" };
  }

  /** Tags a new viewer needs, in order: metadata, sequence header, GOP (its first `maxGopTags`). */
  snapshot(maxGopTags = Infinity): FlvTag[] {
    const tags: FlvTag[] = [];
    if (this.metadataTag) tags.push(this.metadataTag);
    if (this.sequenceHeaderTag) tags.push(this.sequenceHeaderTag);
    tags.push(...this.gop.slice(0, maxGopTags));
    return tags;
  }

  clear(): void {
    this.metadataTag = undefined;
    this.sequenceHeaderTag = undefined;
    this.clearGop();
    this.overflowed = false;
  }

  private push(tag: FlvTag): void {
    if (this.gopBytes + tag.data.length > this.options.maxGopBytes) {
      this.clearGop();
      this.overflowed = true;
      this.gopOverflows++;
      return;
    }
    this.gop.push(tag);
    this.gopBytes += tag.data.length;
  }

  private clearGop(): void {
    this.gop = [];
    this.gopBytes = 0;
  }
}
