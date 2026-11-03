import { beforeEach, describe, expect, it } from "vitest";
import { FlvTagType, type FlvTag } from "../../src/server/flv/types.js";
import { NormalizedIngest } from "../../src/server/ingest/normalized-ingest.js";
import { createLogger } from "../../src/server/logger.js";
import { FakeIngest } from "../helpers/fake-ingest.js";

const logger = createLogger({ name: "test", level: "silent" });

/** AVC sequence header with 4-byte NAL lengths. */
const SEQ = Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0]);
const nal = (type: number, size = 6) => {
  const unit = Buffer.alloc(4 + size, 0xaa);
  unit.writeUInt32BE(size);
  unit[4] = type;
  return unit;
};
const coded = (key: boolean, ...units: Buffer[]) =>
  Buffer.concat([Buffer.from([key ? 0x17 : 0x27, 1, 0, 0, 0]), ...units]);
const PICTURE = coded(false, nal(0x06), nal(0x01));
const SEI_ONLY = coded(false, nal(0x06));
const EMPTY = coded(false, Buffer.alloc(4));

let inner: FakeIngest;
let normalized: NormalizedIngest;
let received: FlvTag[];

beforeEach(() => {
  inner = new FakeIngest();
  normalized = new NormalizedIngest(inner, logger);
  received = [];
  normalized.on("publish", () => true);
  normalized.on("videoTag", (_sessionId, tag) => received.push(tag));
  inner.publish("m30t-01", "s1");
  inner.video("s1", SEQ, 0);
});

describe("NormalizedIngest", () => {
  it("drops coded frames without any NAL unit and keeps the other bytes unchanged", () => {
    inner.video("s1", coded(true, nal(0x05)), 0);
    inner.video("s1", EMPTY, 10);
    inner.video("s1", coded(false), 20);
    inner.video("s1", SEI_ONLY, 33);
    inner.video("s1", PICTURE, 33);

    expect(received.map((t) => t.data)).toEqual([SEQ, coded(true, nal(0x05)), SEI_ONLY, PICTURE]);
  });

  it("evens out picture timestamps and gives SEI-only tags the last picture time", () => {
    const stamps = [0, 30, 36, 99, 100, 133, 170, 200];
    for (const ts of stamps) {
      inner.video("s1", SEI_ONLY, ts);
      inner.video("s1", PICTURE, ts);
    }
    const pictures = received.filter((t) => t.data === PICTURE).map((t) => t.timestamp);
    const gaps = pictures.slice(1).map((ts, i) => ts - pictures[i]!);
    expect(gaps.every((g) => g >= 31 && g <= 36)).toBe(true);
    const all = received.map((t) => t.timestamp);
    expect(all.every((ts, i) => i === 0 || ts >= all[i - 1]!)).toBe(true);
  });

  it("treats frames it cannot read as pictures", () => {
    const unreadable = Buffer.from([0x27, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 1]);
    inner.video("s1", unreadable, 50);
    expect(received.at(-1)).toMatchObject({ data: unreadable, timestamp: 50 });
  });

  it("passes rejected publishers, audio, metadata and unpublish through", () => {
    const events: string[] = [];
    normalized.on("publish", ({ streamKey }) => streamKey !== "rogue");
    normalized.on("metadata", () => events.push("metadata"));
    normalized.on("audioTag", () => events.push("audio"));
    normalized.on("unpublish", (sessionId) => events.push(`unpublish ${sessionId}`));

    expect(inner.publish("rogue", "s2")).toBe(false);
    inner.metadata("s1", Buffer.from([2]));
    inner.audio("s1", Buffer.from([0xaf]));
    inner.unpublish("s1");
    expect(events).toEqual(["metadata", "audio", "unpublish s1"]);
  });

  it("starts each session from its own clock", () => {
    for (let i = 0; i < 20; i++) inner.video("s1", PICTURE, i * 33);
    inner.unpublish("s1");
    received = [];
    inner.publish("m30t-01", "s2");
    inner.video("s2", SEQ, 0);
    inner.video("s2", coded(true, nal(0x05)), 0);
    expect(received.map((t) => t.timestamp)).toEqual([0, 0]);
    expect(received[0]!.type).toBe(FlvTagType.Video);
  });
});
