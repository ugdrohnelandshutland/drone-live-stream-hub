import { describe, expect, it } from "vitest";
import type { DroneStatus } from "../../src/shared/api";
import {
  countLive,
  droneFacts,
  buildFacts,
  formatDate,
  formatSince,
  formatVideo,
  snapshotCaption,
  snapshotFileName,
} from "../../src/web/lib/format";

const now = new Date(2026, 9, 9, 15, 30);
const live: DroneStatus = {
  id: "m30t-01",
  name: "Drohne 1",
  state: "live",
  since: new Date(2026, 9, 9, 14, 3).toISOString(),
  sessionId: "s",
  viewerCount: 2,
  video: { codec: "avc", codecString: "avc1.640028", width: 1920, height: 1080 },
};

describe("web format helpers", () => {
  it("formats times today and on other days", () => {
    expect(formatSince(new Date(2026, 9, 9, 14, 3).toISOString(), now)).toBe("seit 14:03 Uhr");
    expect(formatSince(new Date(2026, 9, 8, 9, 5).toISOString(), now)).toBe("seit 08.10. 09:05 Uhr");
  });

  it("formats video info", () => {
    expect(formatVideo(live.video)).toBe("1920×1080 H.264");
    expect(formatVideo({ codec: "hevc" })).toBe("H.265");
    expect(formatVideo(null)).toBeUndefined();
  });

  it("lists strip facts for live and offline drones", () => {
    expect(droneFacts(live, now)).toEqual(["seit 14:03 Uhr", "1920×1080 H.264", "2 Zuschauer"]);
    expect(droneFacts({ ...live, state: "offline", since: null, video: null }, now)).toEqual([
      "noch kein Signal",
    ]);
  });

  it("counts live drones", () => {
    expect(countLive([live, { ...live, id: "b", state: "offline" }])).toBe(1);
  });

  it("lists build facts for the footer", () => {
    const builtAt = new Date(2026, 9, 10, 8, 5).toISOString();
    expect(buildFacts({ name: "Hub", version: "0.2.0", commit: "1a2b3c4", builtAt })).toEqual([
      "Commit 1a2b3c4",
      "Build 10.10.2026 08:05 Uhr",
    ]);
    expect(buildFacts({ name: "Hub", version: "0.2.0", commit: null, builtAt: null })).toEqual([
      "Entwicklungsstand",
    ]);
  });

  it("formats a calendar date", () => {
    expect(formatDate("2026-10-09")).toBe("09.10.2026");
  });

  it("captions and names still images", () => {
    const at = new Date(2026, 9, 10, 9, 5, 7);
    expect(snapshotCaption("Drohne 1", "m30t-01", at)).toBe("Drohne 1 (m30t-01) · 10.10.2026 09:05:07 Uhr");
    expect(snapshotCaption("m30t-01", "m30t-01", at)).toBe("m30t-01 · 10.10.2026 09:05:07 Uhr");
    expect(snapshotFileName("m30t-01", at)).toBe("2026-10-10_09-05-07_m30t-01.png");
  });
});
