import { describe, expect, it } from "vitest";
import { TimestampSmoother } from "../../src/server/ingest/timestamp-smoother.js";

/** Deterministic jitter like Pilot 2: frames 33 ms apart on average, stamped 2–37 ms apart. */
function jittered(count: number, start = 0): number[] {
  const out: number[] = [];
  let seed = 7;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    const jitter = (seed / 2 ** 31 - 0.5) * 30; // ±15 ms around the even grid
    out.push(Math.round(start + i * (1000 / 30) + jitter));
  }
  return out.sort((a, b) => a - b);
}

function deltas(values: number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

describe("TimestampSmoother", () => {
  it("puts jittered pictures on an even grid close to the publisher's clock", () => {
    const input = jittered(600, 5000);
    const smoother = new TimestampSmoother();
    const output = input.map((ts) => smoother.picture(ts, 0));

    const steady = deltas(output.slice(60));
    expect(Math.min(...steady)).toBeGreaterThanOrEqual(31);
    expect(Math.max(...steady)).toBeLessThanOrEqual(36);
    expect(Math.min(...deltas(input))).toBeLessThan(10); // the input really was bunched
    expect(output.every((ts, i) => Math.abs(ts - input[i]!) <= 60)).toBe(true);
    expect(smoother.stats.resyncs).toBe(0);
  });

  it("starts at the first input timestamp", () => {
    const smoother = new TimestampSmoother();
    expect(smoother.other(1200)).toBe(1200);
    expect(smoother.picture(1234, 0)).toBe(1234);
  });

  it("gives other tags and repeated picture times the last picture's time", () => {
    const smoother = new TimestampSmoother();
    smoother.picture(0, 0);
    const second = smoother.picture(40, 0);
    expect(smoother.other(40)).toBe(second); // SEI-only tag after the picture
    expect(smoother.picture(40, 0)).toBe(second); // same picture time again
    expect(smoother.other(73)).toBe(second); // SEI-only tag before the next picture
  });

  it("keeps a real pause and continues from the publisher's clock", () => {
    const smoother = new TimestampSmoother();
    let ts = 0;
    for (let i = 0; i < 30; i++) smoother.picture((ts = i * 33), 0);
    const before = smoother.picture((ts += 33), 0);
    const after = smoother.picture((ts += 2500), 0);
    expect(after).toBe(ts);
    expect(after - before).toBeGreaterThanOrEqual(2400);
    expect(smoother.stats.resyncs).toBe(1);
  });

  it("starts again when the publisher's clock runs away, without going backwards", () => {
    const smoother = new TimestampSmoother();
    let last = 0;
    for (let i = 0; i < 30; i++) last = smoother.picture(i * 33, 0);
    // 200 ms gaps: shorter than a pause at a slow measured rate, but far off the grid.
    const outputs = [1200, 1400, 1600, 1800].map((ts) => smoother.picture(ts, 0));
    expect(outputs.every((ts, i) => ts > (i === 0 ? last : outputs[i - 1]!))).toBe(true);
    expect(Math.abs(outputs.at(-1)! - 1800)).toBeLessThanOrEqual(300);
  });

  it("follows a jump back of the publisher's clock as before", () => {
    const smoother = new TimestampSmoother();
    for (let i = 0; i < 30; i++) smoother.picture(10_000 + i * 33, 0);
    expect(smoother.picture(500, 0)).toBe(500);
    expect(smoother.picture(533, 0)).toBe(533);
  });

  it("follows a lower frame rate after measuring it", () => {
    const smoother = new TimestampSmoother();
    const output = Array.from({ length: 120 }, (_, i) => smoother.picture(i * 40, 0));
    expect(deltas(output.slice(80)).every((d) => d >= 39 && d <= 41)).toBe(true);
    expect(Math.abs(output.at(-1)! - 119 * 40)).toBeLessThanOrEqual(20);
  });

  it("only shifts timestamps once B-frames show up", () => {
    const smoother = new TimestampSmoother();
    for (let i = 0; i < 10; i++) smoother.picture(i * 33, 0);
    const a = smoother.picture(400, 66);
    const b = smoother.picture(405, 33);
    const c = smoother.picture(470, 0);
    expect(b - a).toBe(5);
    expect(c - b).toBe(65);
  });
});
