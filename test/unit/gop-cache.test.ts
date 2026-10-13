import { describe, expect, it } from "vitest";
import { GopCache } from "../../src/server/gop-cache/gop-cache.js";
import { interframe, keyframe, metadataTag, sequenceHeader } from "../helpers/tags.js";

describe("GopCache", () => {
  it("is not ready before a sequence header and a keyframe", () => {
    const cache = new GopCache({ maxGopBytes: 1e6 });
    expect(cache.addVideoTag(interframe(0))).toEqual({ kind: "frame" });
    expect(cache.ready).toBe(false);
    expect(cache.gopLength).toBe(0); // frames before the first keyframe are useless
    cache.addVideoTag(sequenceHeader());
    expect(cache.ready).toBe(false);
    cache.addVideoTag(keyframe(33));
    expect(cache.ready).toBe(true);
  });

  it("returns metadata, sequence header and the GOP since the last keyframe, timestamps unchanged", () => {
    const cache = new GopCache({ maxGopBytes: 1e6 });
    const meta = metadataTag();
    cache.setMetadata(meta);
    const seq = sequenceHeader();
    cache.addVideoTag(seq);
    cache.addVideoTag(keyframe(0));
    cache.addVideoTag(interframe(33));
    const k2 = keyframe(2000);
    const f2 = interframe(2033);
    expect(cache.addVideoTag(k2)).toEqual({ kind: "keyframe" });
    cache.addVideoTag(f2);
    expect(cache.snapshot()).toEqual([meta, seq, k2, f2]);
  });

  it("reports an identical sequence header as unchanged and a different one as changed", () => {
    const cache = new GopCache({ maxGopBytes: 1e6 });
    expect(cache.addVideoTag(sequenceHeader(1))).toEqual({ kind: "sequence-header", changed: false });
    cache.addVideoTag(keyframe(0));
    expect(cache.addVideoTag(sequenceHeader(1, 500))).toEqual({ kind: "sequence-header", changed: false });
    expect(cache.gopLength).toBe(1);
    expect(cache.addVideoTag(sequenceHeader(2, 600))).toEqual({ kind: "sequence-header", changed: true });
    expect(cache.gopLength).toBe(0);
    expect(cache.sequenceHeader).toEqual(sequenceHeader(2, 600));
  });

  it("drops the GOP when it exceeds the byte limit and resumes at the next keyframe", () => {
    const cache = new GopCache({ maxGopBytes: 400 });
    cache.addVideoTag(sequenceHeader());
    cache.addVideoTag(keyframe(0, 200));
    cache.addVideoTag(interframe(33, 100));
    cache.addVideoTag(interframe(66, 100)); // exceeds 400 bytes
    expect(cache.gopLength).toBe(0);
    expect(cache.gopOverflows).toBe(1);
    cache.addVideoTag(interframe(99, 10));
    expect(cache.gopLength).toBe(0);
    cache.addVideoTag(keyframe(2000, 10));
    expect(cache.gopLength).toBe(1);
    expect(cache.byteSize).toBeLessThan(400);
  });

  it("classifies malformed and non-frame tags", () => {
    const cache = new GopCache({ maxGopBytes: 1e6 });
    expect(cache.addVideoTag({ type: 9, timestamp: 0, data: Buffer.alloc(0) })).toEqual({ kind: "invalid" });
    expect(cache.addVideoTag({ type: 9, timestamp: 0, data: Buffer.from([0x17, 0x02, 0, 0, 0]) })).toEqual({
      kind: "other",
    });
  });

  it("clear() forgets everything", () => {
    const cache = new GopCache({ maxGopBytes: 1e6 });
    cache.setMetadata(metadataTag());
    cache.addVideoTag(sequenceHeader());
    cache.addVideoTag(keyframe(0));
    cache.clear();
    expect(cache.snapshot()).toEqual([]);
    expect(cache.byteSize).toBe(0);
  });
});
