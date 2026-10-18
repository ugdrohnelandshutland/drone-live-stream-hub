import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/close-codes";
import {
  DEFAULT_LIMITS,
  StreamRecorder,
  type RecorderLimits,
  type RecordingPart,
} from "../../src/web/recording/stream-recorder";
import {
  boxTypes,
  concat,
  findBox,
  FLV_HEADER,
  frameTag,
  fullBoxWords,
  hevcSequenceHeaderTag,
  sampleTimestamps,
  sequenceHeaderTag,
  SPS_1080P,
  SPS_640X512,
  STBL,
  toArrayBuffer,
} from "./recording-helpers";

const STEP = 33;

/** Frames `from`..`to` (inclusive, by index), keyframe every `gop` frames, at index × 33 ms + offset. */
function frames(from: number, to: number, { gop = 30, offset = 0 } = {}): Uint8Array {
  const tags: Uint8Array[] = [];
  for (let i = from; i <= to; i++) tags.push(frameTag(offset + i * STEP, i % gop === 0));
  return concat(tags);
}

function times(from: number, to: number, offset = 0): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => offset + (from + i) * STEP);
}

function setup(limits: RecorderLimits = DEFAULT_LIMITS) {
  const recorder = new StreamRecorder(limits);
  const parts: RecordingPart[] = [];
  let unsupported = 0;
  recorder.setListener({ onPart: (part) => parts.push(part), onUnsupported: () => unsupported++ });
  const send = (...chunks: Uint8Array[]) => {
    for (const chunk of chunks) recorder.handle({ type: "data", chunk: toArrayBuffer(chunk) });
  };
  const connect = (sps = SPS_1080P) => {
    recorder.handle({ type: "open" });
    send(concat([FLV_HEADER, sequenceHeaderTag(sps)]));
  };
  const close = (code: number) => recorder.handle({ type: "close", code });
  const files = async () => Promise.all(parts.map(async (p) => new Uint8Array(await p.blob.arrayBuffer())));
  return { recorder, parts, send, connect, close, files, unsupported: () => unsupported };
}

/** Sample durations from stts. */
function durations(mp4: Uint8Array): number[] {
  const [count = 0, ...entries] = fullBoxWords(mp4, [...STBL, "stts"]);
  const out: number[] = [];
  for (let i = 0; i < count; i++)
    out.push(...Array<number>(entries[2 * i] ?? 0).fill(entries[2 * i + 1] ?? 0));
  return out;
}

function trackSize(mp4: Uint8Array): [number, number] {
  const words = fullBoxWords(mp4, ["moov", "trak", "tkhd"]);
  return [(words.at(-2) ?? 0) / 0x1_0000, (words.at(-1) ?? 0) / 0x1_0000];
}

describe("StreamRecorder", () => {
  it("starts at the next keyframe and writes one MP4 on stop", async () => {
    const t = setup();
    t.connect();
    t.send(frames(0, 9));
    t.recorder.start();
    t.send(frames(10, 29));
    expect(t.recorder.state).toBe("waiting");
    t.send(frames(30, 69));
    expect(t.recorder.state).toBe("recording");
    t.recorder.stop();

    expect(t.recorder.state).toBe("idle");
    expect(t.parts.map((p) => [p.index, p.reason])).toEqual([[1, "stopped"]]);
    const [mp4] = await t.files();
    expect(boxTypes(mp4!)).toEqual(["ftyp", "moov", "mdat"]);
    expect(sampleTimestamps(mp4!)).toEqual(times(30, 69));
    expect(durations(mp4!)).toEqual(Array<number>(40).fill(STEP));
    expect(fullBoxWords(mp4!, [...STBL, "stss"])).toEqual([2, 1, 31]);
    // One chunk per GOP, the first one right at the start of the mdat payload.
    const mdat = findBox(mp4!, ["mdat"])!;
    expect(fullBoxWords(mp4!, [...STBL, "stco"])).toEqual([2, mdat.start, mdat.start + 30 * 12]);
    expect(trackSize(mp4!)).toEqual([1920, 1080]);
    expect(t.parts[0]!.durationMs).toBe(40 * STEP);
  });

  it("reads tags split across chunks", async () => {
    const t = setup();
    t.recorder.start();
    t.recorder.handle({ type: "open" });
    const bytes = concat([FLV_HEADER, sequenceHeaderTag(SPS_1080P), frames(0, 44)]);
    for (let offset = 0; offset < bytes.length; offset += 7) t.send(bytes.subarray(offset, offset + 7));
    t.recorder.stop();
    const [mp4] = await t.files();
    expect(sampleTimestamps(mp4!)).toEqual(times(0, 44));
  });

  it("starts a new part at a camera switch", async () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 59));
    t.close(CloseCode.StreamReset);
    t.connect(SPS_640X512);
    t.send(frames(0, 29));
    t.recorder.stop();

    expect(t.parts.map((p) => [p.index, p.reason])).toEqual([
      [1, "camera-switch"],
      [2, "stopped"],
    ]);
    const [first, second] = await t.files();
    expect(sampleTimestamps(first!)).toEqual(times(0, 59));
    expect(trackSize(first!)).toEqual([1920, 1080]);
    expect(sampleTimestamps(second!)).toEqual(times(0, 29));
    expect(trackSize(second!)).toEqual([640, 512]);
  });

  it("skips the GOP the server repeats after a network reconnect", async () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 44));
    // Socket lost without a close code (player restart); the server starts with its cached GOP.
    t.connect();
    t.send(frames(30, 59));
    t.recorder.stop();

    const [mp4] = await t.files();
    expect(t.parts).toHaveLength(1);
    expect(sampleTimestamps(mp4!)).toEqual(times(0, 59));
    expect(durations(mp4!)).toEqual(Array<number>(60).fill(STEP));
  });

  it("turns a new publisher session into a cut in the same file", async () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 39));
    t.close(CloseCode.DroneOffline);
    t.connect();
    t.send(frames(0, 29)); // the drone is back, its timestamps start anew
    t.recorder.stop();

    const [mp4] = await t.files();
    expect(t.parts).toHaveLength(1);
    expect(sampleTimestamps(mp4!)).toEqual([...times(0, 39), ...times(0, 29)]);
    expect(durations(mp4!)).toEqual(Array<number>(70).fill(STEP));
  });

  it("does not freeze the picture over a gap in the stream", async () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 29), frames(0, 29, { offset: 20_000 }));
    t.recorder.stop();
    const [mp4] = await t.files();
    expect(durations(mp4!)).toEqual(Array<number>(60).fill(STEP));
  });

  it("waits for a keyframe when frames are missing after a reconnect", async () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 29));
    t.connect();
    t.send(frames(45, 89)); // 30..44 never arrived; 45..59 cannot be decoded
    t.recorder.stop();
    const [mp4] = await t.files();
    expect(sampleTimestamps(mp4!)).toEqual([...times(0, 29), ...times(60, 89)]);
  });

  it("splits long recordings at a keyframe without losing a frame", async () => {
    const t = setup({ ...DEFAULT_LIMITS, maxPartDurationMs: 900 });
    t.connect();
    t.recorder.start();
    t.send(frames(0, 99));
    t.recorder.stop();

    expect(t.parts.map((p) => [p.index, p.reason])).toEqual([
      [1, "limit"],
      [2, "limit"],
      [3, "limit"],
      [4, "stopped"],
    ]);
    const files = await t.files();
    expect(files.flatMap(sampleTimestamps)).toEqual(times(0, 99));
    expect(files.map((f) => sampleTimestamps(f).length)).toEqual([30, 30, 30, 10]);
  });

  it("reports total time and the size of the current part", () => {
    const t = setup();
    t.connect();
    t.recorder.start();
    t.send(frames(0, 30));
    expect(t.recorder.progress()).toEqual({ state: "recording", durationMs: 30 * STEP, bytes: 30 * 12 });
  });

  it("refuses H.265 and stops when the stream switches to it", () => {
    const t = setup();
    t.recorder.handle({ type: "open" });
    t.send(concat([FLV_HEADER, hevcSequenceHeaderTag()]));
    t.recorder.start();
    expect(t.recorder.state).toBe("idle");
    expect(t.unsupported()).toBe(1);

    t.connect();
    t.recorder.start();
    t.send(frames(0, 9));
    t.recorder.handle({ type: "open" });
    t.send(concat([FLV_HEADER, hevcSequenceHeaderTag()]));
    expect(t.recorder.state).toBe("idle");
    expect(t.unsupported()).toBe(2);
    expect(t.parts).toHaveLength(1); // what was recorded until then is kept
  });

  it("writes nothing when stopped before the first keyframe", () => {
    const t = setup();
    t.connect();
    t.send(frames(0, 5));
    t.recorder.start();
    t.send(frames(6, 20));
    t.recorder.stop();
    expect(t.parts).toEqual([]);
  });
});
