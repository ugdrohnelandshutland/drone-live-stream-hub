import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createService, type Service } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import { createLogger } from "../../src/server/logger.js";
import type { DroneStatus, DronesResponse, ServiceInfo } from "../../src/shared/api.js";
import type { DiagnosticsResponse } from "../../src/shared/diagnostics.js";
import { CloseCode } from "../../src/shared/close-codes.js";
import { SimulatedDrone } from "../../src/sim/drone.js";
import { findFontFile, simulatorSkipReason } from "../../src/sim/ffmpeg.js";
import { FlvViewer } from "../../src/sim/flv-viewer.js";
import { PROFILES } from "../../src/sim/profiles.js";
import { SseClient } from "../helpers/sse.js";
import { waitFor } from "../helpers/wait.js";

const skipReason = await simulatorSkipReason();
const fontFile = (await findFontFile()) ?? "";
if (skipReason) console.warn(`Skipping multi-drone integration tests: ${skipReason}`);

const logger = createLogger({ name: "test", level: process.env["LOG_LEVEL"] ?? "silent" });
const config: AppConfig = {
  rtmpPort: 1935,
  httpPort: 8080,
  drones: [
    { id: "m30t-01", name: "Drohne 1" },
    { id: "m30t-02", name: "Drohne 2" },
    { id: "m30t-03", name: "Drohne 3" },
  ],
};

describe.skipIf(skipReason !== "")("several drones, registry API and SSE", () => {
  let service: Service;
  let base: string;
  let sse: SseClient;
  const drones: SimulatedDrone[] = [];

  const updates = (id: string): DroneStatus[] =>
    sse.events
      .filter((e) => e.event === "drone-updated")
      .map((e) => JSON.parse(e.data) as DroneStatus)
      .filter((d) => d.id === id);
  const latest = (id: string) => updates(id).at(-1);

  beforeAll(async () => {
    service = createService(config, logger, {
      rtmpPort: 0,
      httpPort: 0,
      host: "127.0.0.1",
      staticDir: await mkdtemp(path.join(os.tmpdir(), "dlsh-web-")),
      probeIntervalMs: 0,
    });
    await service.start();
    base = `http://127.0.0.1:${service.httpPort}`;
    sse = new SseClient(`${base}/api/events`);
    await waitFor(() => sse.events.length > 0, 5000, "SSE snapshot");
  });

  afterAll(async () => {
    sse?.close();
    await Promise.all(drones.map((d) => d.stop()));
    await service?.stop();
  });

  function drone(id: string): SimulatedDrone {
    const sim = new SimulatedDrone({
      id,
      host: "127.0.0.1",
      port: service.rtmpPort,
      profile: { ...PROFILES["720p30"]!, keyframeIntervalSec: 1, bitrateKbps: 1000 },
      camera: "wide",
      colour: "0x9467bd",
      fontFile: fontFile!,
      autoReconnect: false,
      logger,
    });
    drones.push(sim);
    return sim;
  }

  it("starts with a snapshot of all configured drones, offline", () => {
    const first = sse.events[0]!;
    expect(first.event).toBe("snapshot");
    const snapshot = JSON.parse(first.data) as DronesResponse;
    expect(snapshot.drones.map((d) => [d.id, d.name, d.state])).toEqual([
      ["m30t-01", "Drohne 1", "offline"],
      ["m30t-02", "Drohne 2", "offline"],
      ["m30t-03", "Drohne 3", "offline"],
    ]);
  });

  it("shows two live drones with video info, rejects an unknown key, and counts viewers", async () => {
    const rogue = drone("rogue-01");
    const rogueExit = new Promise((resolve) => rogue.once("exit", resolve));
    const one = drone("m30t-01");
    await Promise.all([one.start(), drone("m30t-02").start(), rogue.start()]);

    await waitFor(
      () => latest("m30t-01")?.video?.width === 1280 && latest("m30t-02")?.video?.width === 1280,
      15_000,
      "both drones live with video info",
    );
    await rogueExit;

    const list = (await (await fetch(`${base}/api/drones`)).json()) as DronesResponse;
    expect(list.drones.map((d) => [d.id, d.state])).toEqual([
      ["m30t-01", "live"],
      ["m30t-02", "live"],
      ["m30t-03", "offline"],
    ]);
    expect(list.drones.find((d) => d.id === "m30t-01")).toMatchObject({
      video: { codec: "avc", codecString: "avc1.64001f", width: 1280, height: 720 },
    });
    expect(sse.events.some((e) => e.data.includes("rogue-01"))).toBe(false);

    const viewers = [1, 2].map(() =>
      new FlvViewer(`${base.replace("http", "ws")}/ws/live/m30t-01`).connect(),
    );
    await waitFor(() => latest("m30t-01")?.viewerCount === 2, 5000, "viewer count 2");
    viewers[0]!.close();
    await waitFor(() => latest("m30t-01")?.viewerCount === 1, 5000, "viewer count 1");

    // What the simulated RC sends, as seen by /api/diagnostics.
    const diagnostics = async () =>
      (await (await fetch(`${base}/api/diagnostics`)).json()) as DiagnosticsResponse;
    let report = await diagnostics();
    await waitFor(
      () => {
        void diagnostics().then((r) => (report = r));
        return report.drones[0]?.measurements?.keyframeIntervalMs != null;
      },
      10_000,
      "keyframe interval measured",
    );
    const first = report.drones[0]!;
    expect(first).toMatchObject({
      id: "m30t-01",
      name: "Drohne 1",
      live: true,
      video: { codec: "avc", profile: "High", width: 1280, height: 720 },
      metadata: { width: 1280, height: 720 },
      delivery: { viewers: 1 },
    });
    expect(first.publisher?.connect["flashVer"]).toEqual(expect.stringMatching(/FMLE|Lavf/));
    expect(first.measurements?.fps).toBeGreaterThan(15);
    expect(first.measurements?.bFrames).toBe(false);
    expect(first.events.map((e) => e.kind)).toContain("sequence-header");
    expect(report.drones[2]).toMatchObject({ id: "m30t-03", live: false, publisher: null });
    expect(report.rejected[0]).toMatchObject({ streamKey: "rogue-01", remoteHost: "127.0.0.1" });

    await one.stop();
    await waitFor(() => latest("m30t-01")?.state === "offline", 5000, "m30t-01 offline");
    const after = (await diagnostics()).drones[0]!;
    expect(after.live).toBe(false);
    expect(after.publisher?.endedAt).not.toBeNull();
    expect(after.events[0]?.kind).toBe("unpublish");
    expect(await viewers[1]!.closed()).toBe(CloseCode.DroneOffline);
    expect(latest("m30t-01")).toMatchObject({ state: "offline", sessionId: null, video: null });
    expect(latest("m30t-02")?.state).toBe("live");
  });

  it("reports the running release in /api/info and /healthz", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const info = (await (await fetch(`${base}/api/info`)).json()) as ServiceInfo;
    expect(info).toMatchObject({ name: "Drone Live Stream Hub", version, builtAt: null });
    expect(info.commit === null || /^[0-9a-f]{7,}(-dirty)?$/.test(info.commit)).toBe(true);
    const health = (await (await fetch(`${base}/healthz`)).json()) as { version: ServiceInfo };
    expect(health.version).toEqual(info);
  });

  it("answers unknown API paths with 404 JSON", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
