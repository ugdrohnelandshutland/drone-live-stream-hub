import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/server/logger.js";
import { ChaosProxy } from "../../src/sim/chaos-proxy.js";
import { ReconnectingViewer } from "../../src/sim/viewer-client.js";
import { closeCodes, runScenario, skipReason, sleep, stateChanges } from "./harness.js";

const MB = 1024 * 1024;
const logger = createLogger({ name: "proxy", level: "silent" });

describe.skipIf(skipReason !== "")("scenarios: bad-wifi, weak viewer, field-day", () => {
  it("bad-wifi: no crash, bounded memory, recovery after the network heals", async () => {
    const result = await runScenario({
      scenario: {
        name: "bad-wifi-short",
        duration: "60s",
        drones: [
          { id: "m30t-01", profile: "1080p30" },
          { id: "m30t-02", profile: "720p30" },
        ],
        timeline: [
          { at: "0s", drone: "*", action: "start" },
          { at: "3s", drone: "*", action: "network", latencyMs: 80, jitterMs: 120 },
          { at: "8s", drone: "m30t-01", action: "network", bandwidthKbps: 3000 },
          { at: "13s", drone: "*", action: "heal" },
          { at: "15s", drone: "*", action: "stall", for: "3s" },
          // Longer than the ingest idle timeout (10 s): the service must drop the publisher.
          { at: "21s", drone: "m30t-01", action: "stall", for: "13s" },
          { at: "37s", drone: "m30t-02", action: "cut", for: "5s" },
          { at: "45s", drone: "*", action: "heal" },
        ],
      },
      viewersPerDrone: { "m30t-01": 1, "m30t-02": 1 },
    });

    expect(result.final.map((d) => [d.id, d.state])).toEqual([
      ["m30t-01", "live"],
      ["m30t-02", "live"],
      ["m30t-03", "offline"],
    ]);
    // Long stall → idle timeout → offline → publisher reconnects.
    expect(stateChanges(result.updates.get("m30t-01"))).toEqual(["live", "offline", "live"]);
    // Out of range → offline → back.
    expect(stateChanges(result.updates.get("m30t-02"))).toEqual(["live", "offline", "live"]);
    for (const [key, viewer] of result.viewers) {
      expect(closeCodes(viewer), key).toContain(4000);
      expect(viewer.metrics.timestampRegressions, key).toBe(0);
      expect(result.playingAtEnd.get(key), key).toBe(true);
    }
    // The short stall shows as a gap but does not end the session.
    expect(result.viewers.get("m30t-02#0")?.metrics.stalls.some((s) => s.gapMs > 2000)).toBe(true);

    expect(result.maxCacheBytes).toBeLessThan(16 * MB);
    expect(result.heap.last - result.heap.first).toBeLessThan(30 * MB);
  });

  it("weak viewers: a slow tablet gets a thinned-out stream, a hopeless one is cut off; others unaffected", async () => {
    const tablets = new Map<string, ReconnectingViewer>();
    const proxies: ChaosProxy[] = [];
    let droppedTags = 0;
    let slowViewerClosures = 0;
    let openSockets = -1;
    const result = await runScenario({
      scenario: {
        name: "weak-viewers",
        duration: "30s",
        drones: [{ id: "m30t-01", profile: "1080p30" }], // ~6 Mbit/s
        timeline: [{ at: "0s", drone: "m30t-01", action: "start" }],
      },
      viewersPerDrone: { "m30t-01": 1 },
      // Shorter than the 10 s default to keep the test short. Not much shorter: bufferedAmount
      // drains in large steps and can sit above the soft limit for ~4.5 s even for a viewer
      // that keeps up with keyframes.
      service: { maxCongestionMs: 8000 },
      during: async ({ service }) => {
        for (const [name, kbps] of [
          ["slow", 1500],
          ["hopeless", 300],
        ] as const) {
          const proxy = new ChaosProxy({
            name,
            targetHost: "127.0.0.1",
            targetPort: service.httpPort,
            logger,
            maxQueueBytes: 256 * 1024,
          });
          await proxy.start();
          proxy.setConditions({ bandwidthKbps: kbps, latencyMs: 20 });
          proxies.push(proxy);
          tablets.set(
            name,
            new ReconnectingViewer({ baseUrl: `ws://127.0.0.1:${proxy.port}`, droneId: "m30t-01" }).start(),
          );
        }
        await sleep(28_000);
        droppedTags = service.hub.stats()["m30t-01"]?.droppedTags ?? 0;
        slowViewerClosures = service.hub.stats()["m30t-01"]?.slowViewerClosures ?? 0;
        const health = (await (await fetch(`http://127.0.0.1:${service.httpPort}/healthz`)).json()) as {
          viewers: number;
        };
        openSockets = health.viewers;
        for (const tablet of tablets.values()) tablet.stop();
        await Promise.all(proxies.map((p) => p.stop()));
      },
    });

    const fast = result.viewers.get("m30t-01#0")!;
    const slow = tablets.get("slow")!;
    // Frames are dropped until the next keyframe: the stream stays live, but thinner.
    expect(slow.metrics.videoTags).toBeGreaterThan(30);
    expect(slow.metrics.videoTags).toBeLessThan(fast.metrics.videoTags / 2);
    expect(slow.metrics.timestampRegressions).toBe(0);
    expect(droppedTags).toBeGreaterThan(100);
    // Not even keyframes fit through: closed with 4008. The close frame is stuck behind
    // queued video, so the server cuts the socket after 2 s instead of keeping it (and its
    // queue) open. The test proxy has megabytes of buffers, so the tablet itself only
    // notices much later; on real Wi-Fi far less data is in flight.
    //
    // Not asserted, because it depends on timing: that the slow tablet is never cut off.
    // The kernel frees send buffer space in large steps (loopback: up to ~1 MB at once), so
    // bufferedAmount of a viewer that just keeps up can stay above the soft limit for several
    // seconds (docs/milestone-6.md). On Windows, the kernel also absorbs so much that the
    // hopeless tablet is not always detected within this test.
    if (process.platform !== "win32") {
      expect(slowViewerClosures).toBeGreaterThanOrEqual(1);
      expect(openSockets).toBeLessThanOrEqual(2); // the hopeless one is gone on the server
    }
    expect(tablets.get("hopeless")!.metrics.videoTags).toBeLessThan(slow.metrics.videoTags);
    // The normal viewer never notices.
    expect(fast.metrics.closes).toEqual([]);
    expect(fast.metrics.stalls).toEqual([]);
    expect(fast.metrics.videoTags).toBeGreaterThan(25 * 30);
  });

  it("field-day (short): a mix of everything, every drone ends live and watchable", async () => {
    const result = await runScenario({
      scenario: {
        name: "field-day-short",
        duration: "75s",
        drones: [
          { id: "m30t-01", profile: "1080p30" },
          { id: "m30t-02", profile: "720p30" },
          { id: "m30t-03", profile: "720p30", switchMode: "restart" },
        ],
        timeline: [
          { at: "0s", drone: "m30t-01", action: "start" },
          { at: "2s", drone: "m30t-02", action: "start" },
          { at: "4s", drone: "m30t-03", action: "start" },
          { at: "8s", drone: "*", action: "switchCamera", camera: "zoom" },
          {
            at: "12s",
            drone: "m30t-02",
            action: "network",
            latencyMs: 60,
            jitterMs: 80,
            bandwidthKbps: 8000,
          },
          { at: "15s", drone: "m30t-01", action: "drop", for: "5s" },
          { at: "18s", drone: "m30t-03", action: "switchCamera", camera: "thermal" },
          { at: "22s", drone: "m30t-02", action: "stall", for: "4s" },
          { at: "28s", drone: "m30t-03", action: "duplicate", for: "4s" },
          { at: "32s", drone: "m30t-01", action: "switchCamera", camera: "thermal" },
          { at: "35s", drone: "m30t-02", action: "cut", for: "3s" },
          { at: "40s", drone: "m30t-03", action: "stop" },
          { at: "46s", drone: "m30t-03", action: "start" },
          { at: "48s", drone: "*", action: "heal" },
          { at: "50s", drone: "*", action: "switchCamera", camera: "wide" },
        ],
      },
      viewersPerDrone: { "m30t-01": 1, "m30t-02": 1, "m30t-03": 1 },
    });

    expect(result.final.map((d) => d.state)).toEqual(["live", "live", "live"]);
    for (const [key, viewer] of result.viewers) {
      expect(viewer.metrics.timestampRegressions, key).toBe(0);
      expect(result.playingAtEnd.get(key), key).toBe(true);
      expect(viewer.metrics.resolutions.at(-1), key).toMatch(/^(1920x1080|1280x720)$/);
    }
    expect(result.maxCacheBytes).toBeLessThan(16 * MB);
    expect(result.heap.last - result.heap.first).toBeLessThan(30 * MB);
  });
});
