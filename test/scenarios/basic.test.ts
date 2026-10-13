import { describe, expect, it } from "vitest";
import { closeCodes, runScenario, skipReason, stateChanges } from "./harness.js";

describe.skipIf(skipReason !== "")("scenarios: steady, staggered-start, unknown-key", () => {
  it("steady: all drones live, continuous playback for every viewer", async () => {
    const result = await runScenario({
      scenario: {
        name: "steady-short",
        duration: "20s",
        drones: [
          { id: "m30t-01", profile: "720p30" },
          { id: "m30t-02", profile: "720p30" },
          { id: "m30t-03", profile: "720p30" },
        ],
        timeline: [{ at: "0s", drone: "*", action: "start" }],
      },
      viewersPerDrone: { "m30t-01": 2, "m30t-02": 2, "m30t-03": 2 },
    });

    expect(result.final.map((d) => d.state)).toEqual(["live", "live", "live"]);
    for (const [key, viewer] of result.viewers) {
      const m = viewer.metrics;
      expect(m.closes, key).toEqual([]);
      expect(m.stalls, key).toEqual([]);
      expect(m.timestampRegressions, key).toBe(0);
      expect(m.timeToFirstKeyframeMs[0], key).toBeLessThan(3000); // includes ffmpeg start
      expect(m.videoTags, key).toBeGreaterThan(15 * 30);
      expect(result.playingAtEnd.get(key), key).toBe(true);
    }
  });

  it("staggered-start: drones join and leave, states follow live", async () => {
    const result = await runScenario({
      scenario: {
        name: "staggered-short",
        duration: "30s",
        drones: [
          { id: "m30t-01", profile: "720p30" },
          { id: "m30t-02", profile: "720p30" },
          { id: "m30t-03", profile: "720p30" },
        ],
        timeline: [
          { at: "0s", drone: "m30t-01", action: "start" },
          { at: "4s", drone: "m30t-02", action: "start" },
          { at: "8s", drone: "m30t-03", action: "start" },
          { at: "14s", drone: "m30t-02", action: "stop" },
          { at: "20s", drone: "m30t-02", action: "start" },
        ],
      },
      viewersPerDrone: { "m30t-02": 1 },
    });

    const states = (id: string) => stateChanges(result.updates.get(id));
    expect(states("m30t-01")).toEqual(["live"]);
    expect(states("m30t-02")).toEqual(["live", "offline", "live"]);
    expect(states("m30t-03")).toEqual(["live"]);
    const firstLive = (id: string) =>
      Date.parse(result.updates.get(id)?.find((u) => u.state === "live")?.since ?? "");
    expect(firstLive("m30t-01")).toBeLessThan(firstLive("m30t-02"));
    expect(firstLive("m30t-02")).toBeLessThan(firstLive("m30t-03"));

    const viewer = result.viewers.get("m30t-02#0");
    // Connected while offline (kept open), closed once by the stop, then playing again.
    expect(closeCodes(viewer)).toEqual([4000]);
    expect(viewer?.metrics.timeToFirstKeyframeMs).toHaveLength(2);
    expect(result.playingAtEnd.get("m30t-02#0")).toBe(true);
  });

  it("unknown-key: rejected, never visible", async () => {
    const result = await runScenario({
      scenario: {
        name: "unknown-short",
        duration: "10s",
        drones: [
          { id: "m30t-01", profile: "720p30" },
          { id: "unknown-01", profile: "720p30" },
        ],
        timeline: [{ at: "0s", drone: "*", action: "start" }],
      },
      viewersPerDrone: { "unknown-01": 1 },
    });

    expect(result.final.map((d) => d.id)).toEqual(["m30t-01", "m30t-02", "m30t-03"]);
    expect(result.final[0]?.state).toBe("live");
    expect(result.updates.has("unknown-01")).toBe(false);
    expect(closeCodes(result.viewers.get("unknown-01#0"))).toEqual([4004]);
  });
});
