import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario, parseScenario } from "../../src/sim/scenarios.js";

describe("scenario files", () => {
  it("parses every scenario in sim/scenarios", async () => {
    const dir = path.resolve("sim", "scenarios");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    expect(files).toContain("pilot2-real.json");
    for (const file of files) await expect(loadScenario(path.join(dir, file))).resolves.toBeTruthy();
  });

  it("reads dropouts and requires their length", () => {
    const base = { name: "x", drones: [{ id: "m30t-01", profile: "pilot2-real" }] };
    const scenario = parseScenario({
      ...base,
      timeline: [{ at: "5s", drone: "m30t-01", action: "dropout", for: "4500ms" }],
    });
    expect(scenario.timeline[0]).toEqual({ at: 5000, drone: "m30t-01", action: "dropout", for: 4500 });
    expect(() =>
      parseScenario({ ...base, timeline: [{ at: "5s", drone: "m30t-01", action: "dropout" }] }),
    ).toThrow(/timeline\.0/);
  });
});
