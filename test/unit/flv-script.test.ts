import { describe, expect, it } from "vitest";
import { Amf0Error, decodeAmf0All, encodeAmf0String } from "../../src/server/flv/amf0.js";
import { parseScriptTag, stripSetDataFrame } from "../../src/server/flv/script.js";

function amfNumber(n: number): Buffer {
  const buf = Buffer.alloc(9);
  buf[0] = 0x00;
  buf.writeDoubleBE(n, 1);
  return buf;
}

function amfKey(key: string): Buffer {
  return encodeAmf0String(key).subarray(1); // property names have no type marker
}

const ecmaArray = Buffer.concat([
  Buffer.from([0x08, 0, 0, 0, 3]),
  amfKey("width"),
  amfNumber(1920),
  amfKey("height"),
  amfNumber(1080),
  amfKey("encoder"),
  encodeAmf0String("Lavf"),
  Buffer.from([0, 0, 0x09]),
]);
const onMetaData = Buffer.concat([encodeAmf0String("onMetaData"), ecmaArray]);
const withSetDataFrame = Buffer.concat([encodeAmf0String("@setDataFrame"), onMetaData]);

describe("AMF0", () => {
  it("decodes scalars, objects and strict arrays", () => {
    const data = Buffer.concat([
      amfNumber(1.5),
      Buffer.from([0x01, 0x01, 0x05, 0x06]),
      Buffer.from([0x03]),
      amfKey("a"),
      amfNumber(2),
      Buffer.from([0, 0, 0x09]),
      Buffer.from([0x0a, 0, 0, 0, 2]),
      amfNumber(1),
      encodeAmf0String("x"),
    ]);
    expect(decodeAmf0All(data)).toEqual([1.5, true, null, undefined, { a: 2 }, [1, "x"]]);
  });

  it("throws on truncated data and unknown markers", () => {
    expect(() => decodeAmf0All(amfNumber(1).subarray(0, 5))).toThrow(Amf0Error);
    expect(() => decodeAmf0All(Buffer.from([0x11]))).toThrow(/unsupported/);
  });
});

describe("script tags", () => {
  it("parses onMetaData", () => {
    expect(parseScriptTag(onMetaData)).toEqual({
      name: "onMetaData",
      value: { width: 1920, height: 1080, encoder: "Lavf" },
    });
  });

  it("skips @setDataFrame when parsing", () => {
    expect(parseScriptTag(withSetDataFrame)?.name).toBe("onMetaData");
  });

  it("strips @setDataFrame byte-exactly and leaves other tags untouched", () => {
    expect(stripSetDataFrame(withSetDataFrame).equals(onMetaData)).toBe(true);
    expect(stripSetDataFrame(onMetaData)).toBe(onMetaData);
  });
});
