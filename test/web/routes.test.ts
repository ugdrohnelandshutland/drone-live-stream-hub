import { describe, expect, it } from "vitest";
import { wallLayout } from "../../src/web/features/live/wall-layout";
import { describeStatus } from "../../src/web/player/player-status";
import { droneHref, parseRoute, readPageOptions } from "../../src/web/routes";

describe("routes", () => {
  it("parses the three pages", () => {
    expect(parseRoute("/")).toEqual({ page: "overview" });
    expect(parseRoute("/drone/m30t-01")).toEqual({ page: "drone", droneId: "m30t-01" });
    expect(parseRoute("/drone/m30t-01/")).toEqual({ page: "drone", droneId: "m30t-01" });
    expect(parseRoute("/diagnose")).toEqual({ page: "diagnostics" });
    expect(parseRoute("/something")).toEqual({ page: "overview" });
  });

  it("does not crash on a malformed drone URL", () => {
    expect(parseRoute("/drone/%E0")).toEqual({ page: "overview" });
  });

  it("round-trips drone links", () => {
    expect(parseRoute(droneHref("a b/c"))).toEqual({ page: "drone", droneId: "a b/c" });
  });

  it("reads page options and keeps only valid tuning values", () => {
    expect(
      readPageOptions("?kiosk&stats&nurlive&previews=0&datensparen=0&syncTarget=0.2&syncMax=x&chaseMax=-1"),
    ).toEqual({
      kiosk: true,
      stats: true,
      liveOnly: true,
      previews: false,
      dataSaver: false,
      tuning: { syncTarget: 0.2 },
    });
    expect(readPageOptions("")).toEqual({
      kiosk: false,
      stats: false,
      liveOnly: false,
      previews: true,
      dataSaver: undefined,
      tuning: {},
    });
    expect(readPageOptions("?datensparen").dataSaver).toBe(true);
    expect(readPageOptions("?datensparen=1").dataSaver).toBe(true);
  });
});

describe("wall layout", () => {
  it("fills a landscape screen as squarely as possible", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map((n) => wallLayout(n).landscape)).toEqual([
      { cols: 1, rows: 1 },
      { cols: 2, rows: 1 },
      { cols: 2, rows: 2 },
      { cols: 2, rows: 2 },
      { cols: 3, rows: 2 },
      { cols: 3, rows: 2 },
      { cols: 3, rows: 3 },
      { cols: 3, rows: 3 },
    ]);
  });

  it("stacks up to three drones on an upright tablet", () => {
    expect(wallLayout(3).portrait).toEqual({ cols: 1, rows: 3 });
    expect(wallLayout(5).portrait).toEqual({ cols: 2, rows: 3 });
  });
});

describe("player status", () => {
  it("never shows an overlay while playing and reports permanent faults at once", () => {
    expect(describeStatus("playing", "x").overlay).toBeUndefined();
    expect(describeStatus("stalled", "x")).toMatchObject({ tone: "nosignal", immediate: false });
    expect(describeStatus("unknown-drone", "m30t-09")).toMatchObject({ tone: "fault", immediate: true });
    expect(describeStatus("unknown-drone", "m30t-09").overlay?.detail).toContain("m30t-09");
  });
});
