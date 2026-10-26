import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { StreamCapture } from "../../src/server/diagnostics/stream-capture.js";
import { FlvStreamParser } from "../../src/server/flv/reader.js";
import { createLogger } from "../../src/server/logger.js";
import { DroneRegistry } from "../../src/server/registry/registry.js";
import { FakeIngest } from "../helpers/fake-ingest.js";
import { waitFor } from "../helpers/wait.js";

const finished = (capture: StreamCapture) =>
  waitFor(
    () =>
      capture.list().every((c) => !c.recording) &&
      capture.filePath(capture.list()[0]?.file ?? "") !== undefined,
    2000,
    "capture to finish",
  );

const logger = createLogger({ name: "test", level: "silent" });
const SEQ = Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0]);
const frame = (key: boolean, fill: number) =>
  Buffer.from([key ? 0x17 : 0x27, 1, 0, 0, 0, 0, 0, 0, 2, fill, fill]);

let dir: string;
let ingest: FakeIngest;
let clock: number;

function setup(options: { maxBytes?: number; keep?: number } = {}) {
  ingest = new FakeIngest();
  const registry = new DroneRegistry(
    [
      { id: "m30t-01", name: "Drohne 1" },
      { id: "m30t-02", name: "Drohne 2" },
    ],
    logger,
  );
  registry.attach(ingest);
  return new StreamCapture({ ingest, dir, logger, now: () => clock, ...options });
}

async function tagsOf(file: string) {
  return new FlvStreamParser().push(await readFile(path.join(dir, file)));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-capture-"));
  clock = Date.parse("2026-10-26T18:52:18.648Z");
});

describe("StreamCapture", () => {
  it("writes cached metadata and sequence header, then the tags as received", async () => {
    const capture = setup();
    await capture.start();
    expect(capture.begin("m30t-01", 1)).toEqual({ ok: false, error: "offline" });

    ingest.publish("m30t-01", "s1");
    ingest.metadata("s1", Buffer.from([2, 0, 1, 0x61]));
    ingest.video("s1", SEQ, 0);
    ingest.video("s1", frame(true, 1), 0);
    const started = capture.begin("m30t-01", 0.2);
    expect(started).toMatchObject({ ok: true, capture: { file: "m30t-01_2026-10-26T18-52-18-648Z.flv" } });
    expect(capture.begin("m30t-01", 1)).toEqual({ ok: false, error: "busy" });
    ingest.video("s1", frame(false, 2), 1_000_033);
    ingest.audio("s1", Buffer.from([0xaf, 1, 0]), 1_000_033);

    await finished(capture);
    ingest.video("s1", frame(false, 3), 1_000_066); // after the end: not in the file
    const [listed] = capture.list();
    expect(listed).toMatchObject({ droneId: "m30t-01", recording: false });
    expect(listed?.cutShort).toBeUndefined();

    const tags = await tagsOf(listed!.file);
    expect(tags.map((t) => [t.type, t.timestamp, t.data])).toEqual([
      [18, 0, Buffer.from([2, 0, 1, 0x61])],
      [9, 0, SEQ],
      [9, 1_000_033, frame(false, 2)],
    ]);
    expect(listed!.bytes).toBe((await readFile(path.join(dir, listed!.file))).length);
    expect(capture.filePath(listed!.file)).toBe(path.join(dir, listed!.file));
    expect(capture.filePath("../clients.json")).toBeUndefined();
  });

  it("ends early when the drone goes offline or the size limit is reached", async () => {
    const capture = setup({ maxBytes: 100 });
    await capture.start();
    ingest.publish("m30t-01", "s1");
    ingest.publish("m30t-02", "s2");
    expect(capture.begin("m30t-01", 60).ok).toBe(true);
    clock += 1;
    expect(capture.begin("m30t-02", 60).ok).toBe(true);
    ingest.unpublish("s1");
    for (let i = 0; i < 10; i++) ingest.video("s2", frame(false, i), i * 33);

    await waitFor(
      () => capture.list().filter((c) => capture.filePath(c.file)).length === 2,
      2000,
      "both captures",
    );
    const byDrone = Object.fromEntries(capture.list().map((c) => [c.droneId, c]));
    expect(byDrone["m30t-01"]?.cutShort).toBe("offline");
    expect(byDrone["m30t-02"]?.cutShort).toBe("size");
    expect(byDrone["m30t-02"]!.bytes).toBeLessThanOrEqual(100);
    expect((await tagsOf(byDrone["m30t-02"]!.file)).length).toBe(3);
  });

  it("lists files of earlier runs and keeps only the newest", async () => {
    await writeFile(path.join(dir, "m30t-01_2026-10-25T08-00-00-000Z.flv"), "old");
    await writeFile(path.join(dir, "m30t-02_2026-10-25T09-00-00-000Z.flv"), "newer");
    await writeFile(path.join(dir, "notes.txt"), "not a capture");
    const capture = setup({ keep: 2 });
    await capture.start();
    expect(capture.list()).toEqual([
      expect.objectContaining({ droneId: "m30t-02", startedAt: "2026-10-25T09:00:00.000Z", bytes: 5 }),
      expect.objectContaining({ droneId: "m30t-01", startedAt: "2026-10-25T08:00:00.000Z", bytes: 3 }),
    ]);

    ingest.publish("m30t-01", "s1");
    capture.begin("m30t-01", 0.05);
    await finished(capture);
    for (let i = 0; i < 40 && (await readdir(dir)).length !== 3; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect((await readdir(dir)).sort()).toEqual([
      "m30t-01_2026-10-26T18-52-18-648Z.flv",
      "m30t-02_2026-10-25T09-00-00-000Z.flv",
      "notes.txt",
    ]);
  });

  it("finishes running captures on stop", async () => {
    const capture = setup();
    await capture.start();
    ingest.publish("m30t-01", "s1");
    capture.begin("m30t-01", 60);
    await capture.stop();
    expect(capture.list()[0]).toMatchObject({ recording: false, cutShort: "stopped" });
  });
});
