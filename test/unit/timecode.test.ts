import { describe, expect, it } from "vitest";
import {
  TIMECODE_BITS,
  TIMECODE_CELLS,
  TIMECODE_MODULO,
  decodeTimecode,
  timecodeLatency,
  timecodeLayout,
} from "../../src/shared/timecode.js";
import { timecodeFilters } from "../../src/sim/drone.js";

function encode(value: number): boolean[] {
  const bits = Array.from({ length: TIMECODE_BITS }, (_, k) => Math.floor(value / 2 ** k) % 2 === 1);
  const parity = bits.filter(Boolean).length % 2 === 1;
  return [true, false, ...bits, parity];
}

describe("timecode", () => {
  it.each([0, 1, 12345, TIMECODE_MODULO - 1])("round-trips %i", (value) => {
    expect(decodeTimecode(encode(value))).toBe(value);
  });

  it("rejects a wrong marker, a parity error and a wrong length", () => {
    const cells = encode(4242);
    expect(decodeTimecode([false, ...cells.slice(1)])).toBeUndefined();
    const flipped = [...cells];
    flipped[5] = !flipped[5];
    expect(decodeTimecode(flipped)).toBeUndefined();
    expect(decodeTimecode(cells.slice(1))).toBeUndefined();
  });

  it("computes latency across the modulo wrap and rejects frames from the future", () => {
    expect(timecodeLatency(1000, 1250)).toBe(250);
    expect(timecodeLatency(TIMECODE_MODULO - 100, TIMECODE_MODULO * 5 + 50)).toBe(150);
    expect(timecodeLatency(1000, 900)).toBeUndefined();
  });

  it("lays out the strip inside the frame for all simulator resolutions", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [960, 540],
      [640, 512],
    ] as const) {
      const layout = timecodeLayout(w, h);
      expect(layout.x + TIMECODE_CELLS * layout.cell).toBeLessThanOrEqual(w);
      expect(layout.y + layout.cell).toBeLessThanOrEqual(h);
      expect(layout.cell).toBeGreaterThanOrEqual(8);
    }
  });

  it("draws one box per cell in the simulator filter chain", () => {
    const filters = timecodeFilters(1920, 1080);
    expect(filters.split("drawbox=").length - 1).toBe(1 + 1 + TIMECODE_BITS + 1);
    expect(filters).toContain("enable='mod(floor((t*1000+0.5)/1),2)'");
  });
});
