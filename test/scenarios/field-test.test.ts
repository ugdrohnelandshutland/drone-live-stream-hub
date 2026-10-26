import { describe, expect, it } from "vitest";
import type { DiagnosticsResponse } from "../../src/shared/diagnostics.js";
import { closeCodes, runScenario, skipReason, sleep, transitions } from "./harness.js";

describe.skipIf(skipReason !== "")("scenario: pilot2-real (values from the first field test)", () => {
  it("keeps viewers through RC pauses and resets them only on camera switches", async () => {
    let diagnostics: DiagnosticsResponse | undefined;
    const result = await runScenario({
      scenario: {
        name: "pilot2-real-short",
        duration: "24s",
        drones: [{ id: "m30t-01", profile: "pilot2-real" }],
        timeline: [
          { at: "0s", drone: "m30t-01", action: "start", camera: "wide" },
          { at: "6s", drone: "m30t-01", action: "dropout", for: "3s" },
          { at: "13s", drone: "m30t-01", action: "switchCamera", camera: "zoom" },
          { at: "18s", drone: "m30t-01", action: "switchCamera", camera: "thermal" },
        ],
      },
      viewersPerDrone: { "m30t-01": 1 },
      during: async ({ service }) => {
        await sleep(22_000);
        const res = await fetch(`http://127.0.0.1:${service.httpPort}/api/diagnostics`);
        diagnostics = (await res.json()) as DiagnosticsResponse;
      },
    });

    const viewer = result.viewers.get("m30t-01#0")!;
    // The pause is a stall, not a disconnect; only the two switches reset the viewer.
    expect(closeCodes(viewer)).toEqual([4001, 4001]);
    expect(viewer.metrics.stalls.some((s) => s.gapMs > 2500)).toBe(true);
    expect(transitions(viewer.metrics.resolutions)).toEqual(["1920x1088", "1440x1088", "1080x720"]);
    expect(result.playingAtEnd.get("m30t-01#0")).toBe(true);

    const drone = diagnostics?.drones.find((d) => d.id === "m30t-01");
    expect(drone?.totals?.timestampJumps).toBeGreaterThanOrEqual(1);
    expect(drone?.totals?.malformedFrames).toBe(0);
    // One keyframe a second; the pause and the switches stretch the average a little.
    expect(drone?.measurements?.keyframeIntervalMs?.avg).toBeGreaterThan(900);
    expect(drone?.measurements?.keyframeIntervalMs?.avg).toBeLessThan(1500);
  });
});
