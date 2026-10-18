import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAvcDecoderConfig } from "../../src/shared/flv/avc.js";
import { parseScriptTag } from "../../src/server/flv/script.js";
import { FlvTagType, type FlvTag } from "../../src/server/flv/types.js";
import { isKeyframe, parseVideoTag } from "../../src/shared/flv/video.js";
import { NmsIngestAdapter } from "../../src/server/ingest/nms-adapter.js";
import { createLogger } from "../../src/server/logger.js";
import { SimulatedDrone } from "../../src/sim/drone.js";
import { findFontFile, simulatorSkipReason } from "../../src/sim/ffmpeg.js";
import { PROFILES } from "../../src/sim/profiles.js";
import { waitFor } from "../helpers/wait.js";

const skipReason = await simulatorSkipReason();
const fontFile = (await findFontFile()) ?? "";
if (skipReason) console.warn(`Skipping ingest integration tests: ${skipReason}`);

const logger = createLogger({ name: "test", level: process.env["LOG_LEVEL"] ?? "silent" });
const profile = { ...PROFILES["720p30"]!, keyframeIntervalSec: 1, bitrateKbps: 1500 };

interface SessionRecord {
  streamKey: string;
  metadata: FlvTag[];
  video: FlvTag[];
  unpublished: boolean;
}

describe.skipIf(skipReason !== "")("RTMP ingest with a simulated drone", () => {
  const sessions = new Map<string, SessionRecord>();
  const rejected: string[] = [];
  let ingest: NmsIngestAdapter;

  function drone(id: string, audio = false): SimulatedDrone {
    return new SimulatedDrone({
      id,
      host: "127.0.0.1",
      port: ingest.port,
      profile,
      camera: "wide",
      colour: "0x1f77b4",
      fontFile: fontFile!,
      audio,
      autoReconnect: false,
      logger,
    });
  }

  beforeAll(async () => {
    ingest = new NmsIngestAdapter({
      port: 0,
      host: "127.0.0.1",
      appName: "live",
      idleTimeoutMs: 5000,
      logger,
    });
    ingest.on("publish", ({ streamKey, sessionId }) => {
      if (streamKey !== "m30t-01") {
        rejected.push(streamKey);
        return false;
      }
      sessions.set(sessionId, { streamKey, metadata: [], video: [], unpublished: false });
      return true;
    });
    ingest.on("metadata", (id, tag) => sessions.get(id)?.metadata.push(tag));
    ingest.on("videoTag", (id, tag) => sessions.get(id)?.video.push(tag));
    ingest.on("unpublish", (id) => {
      const session = sessions.get(id);
      if (session) session.unpublished = true;
    });
    await ingest.start();
  });

  afterAll(async () => {
    await ingest?.stop();
  });

  it("receives metadata, a sequence header and keyframes, drops audio, and reports unpublish", async () => {
    const sim = drone("m30t-01", true);
    await sim.start();
    try {
      await waitFor(
        () =>
          [...sessions.values()].some(
            (s) => s.video.filter((t) => isKeyframe(parseVideoTag(t.data)!)).length >= 2,
          ),
        20_000,
        "two keyframes",
      );
    } finally {
      await sim.stop();
    }
    await waitFor(() => [...sessions.values()].every((s) => s.unpublished), 5000, "unpublish");

    const [session] = [...sessions.values()];
    expect(session).toBeDefined();
    const { metadata, video } = session!;

    expect(metadata).toHaveLength(1);
    expect(metadata[0]!.type).toBe(FlvTagType.Script);
    expect(parseScriptTag(metadata[0]!.data)).toMatchObject({
      name: "onMetaData",
      value: { width: 1280, height: 720 },
    });
    // The adapter strips @setDataFrame: the tag body starts with the AMF0 string "onMetaData".
    expect(metadata[0]!.data.subarray(3, 13).toString("latin1")).toBe("onMetaData");

    expect(video.every((t) => t.type === FlvTagType.Video)).toBe(true);
    const first = parseVideoTag(video[0]!.data)!;
    expect(first.packetType).toBe("sequence-header");
    expect(parseAvcDecoderConfig(video[0]!.data.subarray(first.payloadOffset))).toMatchObject({
      width: 1280,
      height: 720,
      profileIdc: 100,
    });
    expect(isKeyframe(parseVideoTag(video[1]!.data)!)).toBe(true);

    const keyframeTimes = video.filter((t) => isKeyframe(parseVideoTag(t.data)!)).map((t) => t.timestamp);
    expect(keyframeTimes[1]! - keyframeTimes[0]!).toBeGreaterThanOrEqual(900);
    expect(keyframeTimes[1]! - keyframeTimes[0]!).toBeLessThanOrEqual(1100);
  });

  it("rejects an unknown stream key without emitting tags", async () => {
    const before = sessions.size;
    const sim = drone("rogue-01");
    const exited = new Promise((resolve) => sim.once("exit", resolve));
    await sim.start();
    await exited;
    expect(rejected).toContain("rogue-01");
    expect(sessions.size).toBe(before);
  });
});
