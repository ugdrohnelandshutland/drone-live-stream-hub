import { describe, expect, it } from "vitest";
import { FlvStreamParser } from "../../src/server/flv/reader.js";
import type { FlvTag } from "../../src/server/flv/types.js";
import { createFlvHeader, encodeFlvTag } from "../../src/server/flv/writer.js";
import { FlvSplicer } from "../../src/sim/flv-splicer.js";
import { interframe, keyframe, metadataTag, sequenceHeader } from "../helpers/tags.js";

function file(tags: FlvTag[]): Buffer {
  return Buffer.concat([createFlvHeader({ audio: false, video: true }), ...tags.map(encodeFlvTag)]);
}

describe("FlvSplicer", () => {
  it("joins segments into one stream with one header and increasing timestamps", () => {
    const chunks: Buffer[] = [];
    const splicer = new FlvSplicer((c) => (chunks.push(c), true), false, 33);
    splicer.beginSegment();
    const first = file([metadataTag(), sequenceHeader(1), keyframe(0), interframe(33), interframe(66)]);
    // Feed in odd chunk sizes, like a pipe would.
    for (let i = 0; i < first.length; i += 11) splicer.push(first.subarray(i, i + 11));
    splicer.beginSegment();
    splicer.push(file([metadataTag(), sequenceHeader(2), keyframe(0), interframe(33)]));

    const parser = new FlvStreamParser();
    const tags = parser.push(Buffer.concat(chunks));
    expect(parser.header).toEqual({ version: 1, hasAudio: false, hasVideo: true });
    expect(tags.map((t) => t.timestamp)).toEqual([0, 0, 0, 33, 66, 99, 99, 99, 132]);
    expect(tags[6]?.data).toEqual(sequenceHeader(2).data);
  });

  it("leaves out frames during a dropout but keeps sequence headers and the session", () => {
    const chunks: Buffer[] = [];
    let now = 0;
    const splicer = new FlvSplicer(
      (c) => (chunks.push(c), true),
      false,
      33,
      () => now,
    );
    splicer.beginSegment();
    splicer.push(file([sequenceHeader(1), keyframe(0), interframe(33)]));
    splicer.dropFor(2000);
    now = 1000;
    splicer.push(file([interframe(66), sequenceHeader(2, 1000), keyframe(1000)]).subarray(13));
    now = 2000;
    splicer.push(file([interframe(2033), interframe(2066)]).subarray(13));

    const tags = new FlvStreamParser().push(Buffer.concat(chunks));
    expect(tags.map((t) => [t.timestamp, t.data[0], t.data[1]])).toEqual([
      [0, 0x17, 0],
      [0, 0x17, 1],
      [33, 0x27, 1],
      [1000, 0x17, 0],
      [2033, 0x27, 1],
      [2066, 0x27, 1],
    ]);
  });

  it("passes the destination's backpressure through", () => {
    const splicer = new FlvSplicer(() => false, false, 33);
    expect(splicer.push(file([keyframe(0)]))).toBe(false);
  });
});
