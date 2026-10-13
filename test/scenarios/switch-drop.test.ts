import { describe, expect, it } from "vitest";
import { closeCodes, runScenario, skipReason, stateChanges, transitions } from "./harness.js";

describe.skipIf(skipReason !== "")("scenarios: camera-switch, publisher-drop, duplicate-key", () => {
  it("camera-switch: inline switches reset viewers with 4001, restarts with 4000; playback resumes", async () => {
    const result = await runScenario({
      scenario: {
        name: "camera-switch-short",
        duration: "22s",
        drones: [
          { id: "m30t-01", profile: "1080p30", switchMode: "inline" },
          { id: "m30t-02", profile: "720p30", switchMode: "restart" },
        ],
        timeline: [
          { at: "0s", drone: "*", action: "start", camera: "wide" },
          { at: "5s", drone: "*", action: "switchCamera", camera: "zoom" },
          { at: "10s", drone: "*", action: "switchCamera", camera: "thermal" },
          { at: "15s", drone: "*", action: "switchCamera", camera: "wide" },
        ],
      },
      viewersPerDrone: { "m30t-01": 1, "m30t-02": 1 },
    });

    const inline = result.viewers.get("m30t-01#0")!;
    expect(closeCodes(inline)).toEqual([4001, 4001, 4001]);
    expect(transitions(inline.metrics.resolutions)).toEqual([
      "1920x1080",
      "1280x720",
      "640x512",
      "1920x1080",
    ]);
    // One RTMP session for the whole run.
    const sessions = new Set(
      result.updates
        .get("m30t-01")
        ?.map((u) => u.sessionId)
        .filter(Boolean),
    );
    expect(sessions.size).toBe(1);
    // After a reset the new picture is there almost at once.
    for (const ms of inline.metrics.timeToFirstKeyframeMs.slice(1)) expect(ms).toBeLessThan(1000);

    const restart = result.viewers.get("m30t-02#0")!;
    expect(closeCodes(restart)).toEqual([4000, 4000, 4000]);
    expect(transitions(restart.metrics.resolutions)).toEqual(["1280x720", "960x540", "640x512", "1280x720"]);

    for (const viewer of [inline, restart]) expect(viewer.metrics.timestampRegressions).toBe(0);
    expect(result.playingAtEnd.get("m30t-01#0")).toBe(true);
    expect(result.playingAtEnd.get("m30t-02#0")).toBe(true);
  });

  it("publisher-drop: offline while the drone is gone, automatic recovery after", async () => {
    const result = await runScenario({
      scenario: {
        name: "publisher-drop-short",
        duration: "22s",
        drones: [{ id: "m30t-01", profile: "720p30" }],
        timeline: [
          { at: "0s", drone: "m30t-01", action: "start" },
          { at: "5s", drone: "m30t-01", action: "drop", for: "6s" },
        ],
      },
      viewersPerDrone: { "m30t-01": 2 },
    });

    expect(stateChanges(result.updates.get("m30t-01"))).toEqual(["live", "offline", "live"]);
    // Ignore offline updates from before the first publish (viewer count changes).
    const updates = result.updates.get("m30t-01") ?? [];
    const firstLive = updates.findIndex((u) => u.state === "live");
    const offline = updates.slice(firstLive).find((u) => u.state === "offline");
    const backLive = updates.filter((u) => u.state === "live").at(-1);
    const gapMs = Date.parse(backLive?.since ?? "") - Date.parse(offline?.since ?? "");
    expect(gapMs).toBeGreaterThan(5000);
    expect(gapMs).toBeLessThan(8000);

    for (const [key, viewer] of result.viewers) {
      expect(closeCodes(viewer), key).toEqual([4000]);
      // The reconnected viewer waited on the open socket and got the first keyframe immediately.
      expect(viewer.metrics.timeToFirstKeyframeMs, key).toHaveLength(2);
      expect(result.playingAtEnd.get(key), key).toBe(true);
    }
  });

  it("duplicate-key: the newer publisher replaces the old one, the old connection is closed", async () => {
    const result = await runScenario({
      scenario: {
        name: "duplicate-short",
        duration: "25s",
        drones: [{ id: "m30t-01", profile: "720p30" }],
        timeline: [
          { at: "0s", drone: "m30t-01", action: "start" },
          { at: "5s", drone: "m30t-01", action: "duplicate", for: "8s" },
        ],
      },
      viewersPerDrone: { "m30t-01": 1 },
    });

    const viewer = result.viewers.get("m30t-01#0")!;
    // Duplicate takes over (4001), the original reconnects and takes over again (4001).
    expect(closeCodes(viewer).filter((c) => c === 4001).length).toBeGreaterThanOrEqual(2);
    expect(viewer.metrics.resolutions).toContain("640x512"); // the duplicate's thermal camera
    expect(viewer.metrics.resolutions.at(-1)).toBe("1280x720"); // original is back
    const sessions = new Set(
      result.updates
        .get("m30t-01")
        ?.map((u) => u.sessionId)
        .filter(Boolean),
    );
    expect(sessions.size).toBeGreaterThanOrEqual(3);
    // Never shown as offline: a replacement is not an outage.
    expect(stateChanges(result.updates.get("m30t-01"))).toEqual(["live"]);
    expect(result.final[0]?.state).toBe("live");
    expect(result.playingAtEnd.get("m30t-01#0")).toBe(true);
  });
});
