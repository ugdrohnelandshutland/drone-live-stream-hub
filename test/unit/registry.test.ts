import { describe, expect, it } from "vitest";
import type { DroneStatus } from "../../src/shared/api.js";
import { DroneRegistry } from "../../src/server/registry/registry.js";
import { FakeIngest } from "../helpers/fake-ingest.js";
import { createLogger } from "../../src/server/logger.js";
import { encodeAmf0String } from "../../src/server/flv/amf0.js";

const logger = createLogger({ name: "test", level: "silent" });

// AVC sequence header with a real 1920x1080 High profile SPS.
const SPS = Buffer.from("67640028acd940780227e5c044000003000400000300f03c60c658", "hex");
const AVC_SEQ = Buffer.concat([
  Buffer.from([0x17, 0, 0, 0, 0, 1, 0x64, 0, 0x28, 0xff, 0xe1, 0, SPS.length]),
  SPS,
  Buffer.from([1, 0, 4, 0x68, 0xeb, 0xe3, 0xcb]),
]);
const HEVC_SEQ = Buffer.from([0x90, ...Buffer.from("hvc1"), 1, 2, 3]);

function amfNumber(n: number): Buffer {
  const b = Buffer.alloc(9);
  b.writeDoubleBE(n, 1);
  return b;
}
const METADATA = Buffer.concat([
  encodeAmf0String("onMetaData"),
  Buffer.from([0x03]),
  encodeAmf0String("width").subarray(1),
  amfNumber(1280),
  encodeAmf0String("height").subarray(1),
  amfNumber(720),
  Buffer.from([0, 0, 9]),
]);

function setup() {
  let clock = new Date("2026-10-09T10:00:00Z");
  const registry = new DroneRegistry(
    [
      { id: "m30t-01", name: "Drohne 1" },
      { id: "m30t-02", name: "Drohne 2" },
    ],
    logger,
    () => clock,
  );
  const ingest = new FakeIngest();
  registry.attach(ingest);
  const updates: DroneStatus[] = [];
  registry.on("drone-updated", (s) => updates.push(s));
  return { registry, ingest, updates, setClock: (iso: string) => (clock = new Date(iso)) };
}

describe("DroneRegistry", () => {
  it("lists configured drones as offline initially", () => {
    const { registry } = setup();
    expect(registry.list()).toEqual([
      {
        id: "m30t-01",
        name: "Drohne 1",
        state: "offline",
        since: null,
        sessionId: null,
        stalledSince: null,
        viewerCount: 0,
        video: null,
      },
      {
        id: "m30t-02",
        name: "Drohne 2",
        state: "offline",
        since: null,
        sessionId: null,
        stalledSince: null,
        viewerCount: 0,
        video: null,
      },
    ]);
  });

  it("rejects unknown stream keys without emitting updates", () => {
    const { ingest, updates, registry } = setup();
    expect(ingest.publish("rogue", "s0")).toBe(false);
    expect(updates).toEqual([]);
    expect(registry.has("rogue")).toBe(false);
  });

  it("goes live and offline with timestamps and session ids", () => {
    const { ingest, registry, updates, setClock } = setup();
    expect(ingest.publish("m30t-01", "s1")).toBe(true);
    expect(registry.get("m30t-01")).toMatchObject({
      state: "live",
      since: "2026-10-09T10:00:00.000Z",
      sessionId: "s1",
    });
    setClock("2026-10-09T10:05:00Z");
    ingest.unpublish("s1");
    expect(registry.get("m30t-01")).toMatchObject({
      state: "offline",
      since: "2026-10-09T10:05:00.000Z",
      sessionId: null,
    });
    expect(updates.map((u) => u.state)).toEqual(["live", "offline"]);
  });

  it("lets a new session replace a live one and ignores the old session ending", () => {
    const { ingest, registry, setClock } = setup();
    ingest.publish("m30t-01", "old");
    setClock("2026-10-09T10:01:00Z");
    ingest.publish("m30t-01", "new");
    // Still live since the first publish: the drone never went away.
    expect(registry.get("m30t-01")).toMatchObject({
      state: "live",
      sessionId: "new",
      since: "2026-10-09T10:00:00.000Z",
    });
    expect(ingest.disconnected).toEqual(["old"]);
    ingest.unpublish("old");
    expect(registry.get("m30t-01")).toMatchObject({ state: "live", sessionId: "new" });
    ingest.video("old", AVC_SEQ);
    expect(registry.get("m30t-01")?.video).toBeNull();
  });

  it("reports codec and resolution from the sequence header, once per change", () => {
    const { ingest, registry, updates } = setup();
    ingest.publish("m30t-01", "s1");
    ingest.video("s1", AVC_SEQ);
    ingest.video("s1", AVC_SEQ);
    expect(registry.get("m30t-01")?.video).toEqual({
      codec: "avc",
      codecString: "avc1.640028",
      width: 1920,
      height: 1080,
    });
    expect(updates).toHaveLength(2); // live + video info
    ingest.video("s1", Buffer.from([0x27, 1, 0, 0, 0, 0])); // inter frame: no update
    expect(updates).toHaveLength(2);
  });

  it("falls back to onMetaData size when the codec is not parsed (HEVC)", () => {
    const { ingest, registry } = setup();
    ingest.publish("m30t-02", "s2");
    ingest.metadata("s2", METADATA);
    ingest.video("s2", HEVC_SEQ);
    expect(registry.get("m30t-02")?.video).toEqual({ codec: "hevc", width: 1280, height: 720 });
  });

  it("reports a publisher that stops sending video, and its recovery", () => {
    const { ingest, registry, updates, setClock } = setup();
    ingest.publish("m30t-01", "s1");
    ingest.video("s1", AVC_SEQ);
    setClock("2026-10-09T10:00:00.900Z");
    registry.checkStalls();
    expect(registry.get("m30t-01")?.stalledSince).toBeNull();

    setClock("2026-10-09T10:00:01.000Z");
    registry.checkStalls();
    registry.checkStalls();
    // Since the last video tag, not since the check.
    expect(registry.get("m30t-01")?.stalledSince).toBe("2026-10-09T10:00:00.000Z");
    expect(registry.get("m30t-02")?.stalledSince).toBeNull(); // offline drones never stall

    setClock("2026-10-09T10:00:04.000Z");
    ingest.video("s1", Buffer.from([0x27, 1, 0, 0, 0, 0]));
    expect(registry.get("m30t-01")?.stalledSince).toBeNull();
    expect(updates.map((u) => u.stalledSince)).toEqual([null, null, "2026-10-09T10:00:00.000Z", null]);
  });

  it("counts a publish without any video as stalled and clears the flag when it ends", () => {
    const { ingest, registry, setClock } = setup();
    ingest.publish("m30t-01", "s1");
    setClock("2026-10-09T10:00:02Z");
    registry.checkStalls();
    expect(registry.get("m30t-01")?.stalledSince).toBe("2026-10-09T10:00:00.000Z");
    ingest.unpublish("s1");
    expect(registry.get("m30t-01")).toMatchObject({ state: "offline", stalledSince: null });
  });

  it("tracks viewer counts and emits only on change", () => {
    const { registry, updates } = setup();
    registry.setViewerCount("m30t-02", 3);
    registry.setViewerCount("m30t-02", 3);
    registry.setViewerCount("nope", 1);
    expect(registry.get("m30t-02")?.viewerCount).toBe(3);
    expect(updates).toHaveLength(1);
  });

  it("returns copies that callers cannot mutate", () => {
    const { registry } = setup();
    const status = registry.get("m30t-01")!;
    status.state = "live";
    expect(registry.get("m30t-01")?.state).toBe("offline");
  });
});
