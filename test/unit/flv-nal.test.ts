import { describe, expect, it } from "vitest";
import { checkNalUnits, nalLengthSize } from "../../src/shared/flv/nal.js";

describe("NAL unit check", () => {
  it("reads the length field size from AVC and HEVC configuration records", () => {
    expect(nalLengthSize(Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1]), "avc")).toBe(4);
    expect(nalLengthSize(Uint8Array.from([1, 0x64, 0, 0x28, 0xfd, 0xe1]), "avc")).toBe(2);
    // lengthSizeMinusOne = 2 is reserved.
    expect(nalLengthSize(Uint8Array.from([1, 0x64, 0, 0x28, 0xfe, 0xe1]), "avc")).toBeUndefined();
    expect(nalLengthSize(Uint8Array.from([0, 0x64, 0, 0x28, 0xff]), "avc")).toBeUndefined();
    const hevc = new Uint8Array(23);
    hevc[0] = 1;
    hevc[21] = 0x0f;
    expect(nalLengthSize(hevc, "hevc")).toBe(4);
    expect(nalLengthSize(hevc.subarray(0, 20), "hevc")).toBeUndefined();
  });

  it("accepts well-formed frames and names the first problem", () => {
    const ok = Uint8Array.from([0, 0, 0, 2, 0x09, 0xf0, 0, 0, 0, 3, 0x65, 1, 2]);
    expect(checkNalUnits(ok, 4)).toEqual({ units: 2 });
    expect(checkNalUnits(Uint8Array.from([0, 2, 0x41, 1]), 2)).toEqual({ units: 1 });
    expect(checkNalUnits(new Uint8Array(0), 4)).toEqual({ units: 0 });

    expect(checkNalUnits(Uint8Array.from([0, 0, 0, 2, 0x41, 1, 0, 0, 0, 0]), 4)).toEqual({
      units: 1,
      problem: "zero-length",
      offset: 6,
    });
    expect(checkNalUnits(Uint8Array.from([0, 0, 0, 9, 0x41, 1]), 4)).toEqual({
      units: 0,
      problem: "overrun",
      offset: 0,
    });
    expect(checkNalUnits(Uint8Array.from([0, 0, 0, 1, 0x41, 0, 0]), 4)).toEqual({
      units: 0,
      problem: "start-code",
      offset: 0,
    });
    expect(checkNalUnits(Uint8Array.from([0, 1, 0x41, 0, 1, 0x42, 7]), 2)).toEqual({
      units: 2,
      problem: "trailing-bytes",
      offset: 6,
    });
  });
});
