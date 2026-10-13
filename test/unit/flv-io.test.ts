import { describe, expect, it } from "vitest";
import { FlvParseError, FlvStreamParser } from "../../src/server/flv/reader.js";
import { FlvTagType, type FlvTag } from "../../src/server/flv/types.js";
import { createFlvHeader, encodeFlvTag } from "../../src/server/flv/writer.js";

describe("createFlvHeader", () => {
  it("writes the 9-byte header plus PreviousTagSize0, video only", () => {
    expect(createFlvHeader({ audio: false, video: true }).toString("hex")).toBe("464c5601010000000900000000");
  });

  it("sets the audio flag when requested", () => {
    expect(createFlvHeader({ audio: true, video: true })[4]).toBe(0x05);
  });
});

describe("encodeFlvTag", () => {
  it("encodes header, body and PreviousTagSize byte-exactly", () => {
    const tag: FlvTag = {
      type: FlvTagType.Video,
      timestamp: 0x01020304,
      data: Buffer.from([0x17, 0x01, 0xaa]),
    };
    expect(encodeFlvTag(tag).toString("hex")).toBe(
      // type  size    ts(lower 24) ext  stream   body     prevTagSize = 11 + 3
      "09" + "000003" + "020304" + "01" + "000000" + "1701aa" + "0000000e",
    );
  });

  it("rejects bodies larger than 24 bits", () => {
    const tag: FlvTag = { type: FlvTagType.Video, timestamp: 0, data: Buffer.alloc(0x1000000) };
    expect(() => encodeFlvTag(tag)).toThrow(RangeError);
  });
});

describe("FlvStreamParser", () => {
  const tags: FlvTag[] = [
    { type: FlvTagType.Script, timestamp: 0, data: Buffer.from("02000a6f6e4d65746144617461", "hex") },
    { type: FlvTagType.Video, timestamp: 0, data: Buffer.from([0x17, 0x00, 0, 0, 0, 1, 2, 3]) },
    { type: FlvTagType.Video, timestamp: 0xfffffff0, data: Buffer.alloc(5000, 7) },
  ];
  const stream = Buffer.concat([createFlvHeader({ audio: false, video: true }), ...tags.map(encodeFlvTag)]);

  it("round-trips tags written by the writer", () => {
    const parser = new FlvStreamParser();
    expect(parser.push(stream)).toEqual(tags);
    expect(parser.header).toEqual({ version: 1, hasAudio: false, hasVideo: true });
  });

  it("handles arbitrary chunk boundaries", () => {
    const parser = new FlvStreamParser();
    const out: FlvTag[] = [];
    for (let i = 0; i < stream.length; i += 7) out.push(...parser.push(stream.subarray(i, i + 7)));
    expect(out).toEqual(tags);
  });

  it("rejects a wrong PreviousTagSize", () => {
    const broken = Buffer.from(stream);
    broken.writeUInt32BE(1, 13 + 11 + (tags[0]?.data.length ?? 0));
    expect(() => new FlvStreamParser().push(broken)).toThrow(FlvParseError);
  });

  it("rejects a missing signature", () => {
    expect(() => new FlvStreamParser().push(Buffer.alloc(20))).toThrow(/signature/);
  });
});
