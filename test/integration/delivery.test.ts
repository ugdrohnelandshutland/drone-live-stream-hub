import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createService, type Service } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import { parseScriptTag } from "../../src/server/flv/script.js";
import { FlvTagType } from "../../src/server/flv/types.js";
import { isKeyframe, parseVideoTag } from "../../src/server/flv/video.js";
import { createLogger } from "../../src/server/logger.js";
import { CloseCode } from "../../src/shared/close-codes.js";
import { SimulatedDrone } from "../../src/sim/drone.js";
import { findFontFile, simulatorSkipReason } from "../../src/sim/ffmpeg.js";
import { FlvViewer } from "../../src/sim/flv-viewer.js";
import { PROFILES } from "../../src/sim/profiles.js";
import { waitFor } from "../helpers/wait.js";

const skipReason = await simulatorSkipReason();
const fontFile = (await findFontFile()) ?? "";
if (skipReason) console.warn(`Skipping delivery integration tests: ${skipReason}`);

const logger = createLogger({ name: "test", level: process.env["LOG_LEVEL"] ?? "silent" });
const config: AppConfig = {
  rtmpPort: 1935,
  httpPort: 8080,
  drones: [
    { id: "m30t-01", name: "Drohne 1" },
    { id: "m30t-02", name: "Drohne 2" },
  ],
};

/** Asserts the stream starts with metadata, sequence header and a keyframe (CLAUDE.md §4). */
function expectValidStart(viewer: FlvViewer): void {
  const [meta, seq, key] = viewer.tags;
  expect(meta?.type).toBe(FlvTagType.Script);
  expect(parseScriptTag(meta!.data)?.name).toBe("onMetaData");
  expect(seq?.type).toBe(FlvTagType.Video);
  expect(parseVideoTag(seq!.data)?.packetType).toBe("sequence-header");
  expect(isKeyframe(parseVideoTag(key!.data)!)).toBe(true);
  expect(viewer.tags.every((t) => t.type !== FlvTagType.Audio)).toBe(true);
}

describe.skipIf(skipReason !== "")("service end to end", () => {
  let service: Service;
  let wsBase: string;
  let httpBase: string;

  beforeAll(async () => {
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "dlsh-web-"));
    await writeFile(path.join(staticDir, "index.html"), "<html>ui</html>");
    service = createService(config, logger, {
      rtmpPort: 0,
      httpPort: 0,
      host: "127.0.0.1",
      staticDir,
      probeIntervalMs: 0,
    });
    await service.start();
    wsBase = `ws://127.0.0.1:${service.httpPort}/ws/live`;
    httpBase = `http://127.0.0.1:${service.httpPort}`;
  });

  afterAll(async () => {
    await service?.stop();
  });

  function drone(id: string): SimulatedDrone {
    return new SimulatedDrone({
      id,
      host: "127.0.0.1",
      port: service.rtmpPort,
      profile: { ...PROFILES["720p30"]!, keyframeIntervalSec: 1, bitrateKbps: 1500 },
      camera: "wide",
      colour: "0x2ca02c",
      fontFile: fontFile!,
      audio: true,
      autoReconnect: false,
      logger,
    });
  }

  it("serves health, SPA fallback and closes unknown drones with 4004", async () => {
    const health = (await (await fetch(`${httpBase}/healthz`)).json()) as { status: string; drones: object };
    expect(health.status).toBe("ok");
    expect(Object.keys(health.drones)).toEqual(["m30t-01", "m30t-02"]);
    expect(await (await fetch(`${httpBase}/drone/m30t-01`)).text()).toContain("ui");
    const viewer = new FlvViewer(`${wsBase}/nope`).connect();
    expect(await viewer.closed()).toBe(CloseCode.UnknownDrone);
  });

  it("delivers a valid FLV stream to early and late viewers and closes them with 4000 when the drone leaves", async () => {
    const early = new FlvViewer(`${wsBase}/m30t-01`).connect();
    await new Promise((resolve) => early.once("open", resolve));

    const sim = drone("m30t-01");
    await sim.start();
    let late: FlvViewer | undefined;
    try {
      await waitFor(() => early.tags.length >= 3, 15_000, "first tags for the early viewer");
      expect(early.firstByteAt).toBeDefined();
      expectValidStart(early);

      // Join mid-GOP: the late viewer gets the cached GOP first.
      await new Promise((resolve) => setTimeout(resolve, 500));
      late = new FlvViewer(`${wsBase}/m30t-01`).connect();
      await waitFor(() => late!.tags.length >= 5, 5000, "late viewer tags");
      expectValidStart(late);
      const gopStart = late.tags[2]!.timestamp;
      const lastEarly = early.tags.at(-1)!.timestamp;
      expect(gopStart).toBeLessThanOrEqual(lastEarly);
      expect(lastEarly - gopStart).toBeLessThan(1200); // GOP is at most ~1 keyframe interval old

      // Timestamps are kept as received and increase.
      const videoTs = early.tags.slice(2).map((t) => t.timestamp);
      expect(videoTs.every((ts, i) => i === 0 || ts >= videoTs[i - 1]!)).toBe(true);
    } finally {
      await sim.stop();
    }
    expect(await early.closed()).toBe(CloseCode.DroneOffline);
    expect(await late!.closed()).toBe(CloseCode.DroneOffline);
  });

  it("keeps a viewer of an offline drone connected", async () => {
    const viewer = new FlvViewer(`${wsBase}/m30t-02`).connect();
    await new Promise((resolve) => viewer.once("open", resolve));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(viewer.closeCode).toBeUndefined();
    expect(viewer.bytes).toBe(0);
    viewer.close();
    await viewer.closed();
  });
});
