import { describe, expect, it } from "vitest";
import type { AdminEvent } from "../../src/shared/admin";
import {
  clientLabel,
  eventText,
  formatKbps,
  formatUptime,
  qualityIssues,
} from "../../src/web/features/admin/admin-format";

const event = (e: Omit<AdminEvent, "seq" | "at">): AdminEvent => ({
  seq: 1,
  at: "2026-10-25T10:00:00Z",
  ...e,
});
const names = (id: string) => ({ "m30t-01": "Drohne 1" })[id] ?? id;

describe("admin formatting", () => {
  it("formats bandwidth and uptime", () => {
    expect(formatKbps(850)).toBe("850 kbit/s");
    expect(formatKbps(4200)).toBe("4,2 Mbit/s");
    expect(formatUptime(45)).toBe("45 s");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3 h 05 min");
    expect(formatUptime(2 * 86400 + 4 * 3600)).toBe("2 d 4 h");
  });

  it("labels devices by name, then browser, then a placeholder", () => {
    expect(clientLabel({ name: "ELW", device: "Chrome · Android" })).toBe("ELW");
    expect(clientLabel({ name: null, device: "Chrome · Android" })).toBe("Chrome · Android");
    expect(clientLabel({ name: null, device: "" })).toBe("Unbekanntes Gerät");
  });

  it("lists connection problems, worst first", () => {
    expect(qualityIssues({ kbps: 1, droppedFrames: 0, slowClosures: 0, aborts: 0 })).toEqual([]);
    expect(qualityIssues({ kbps: 1, droppedFrames: 12, slowClosures: 1, aborts: 2 })).toEqual([
      "2 Abbrüche",
      "1× zu langsam",
      "12 Bilder ausgelassen",
    ]);
  });

  it("describes events in German", () => {
    expect(eventText(event({ kind: "drone-live", droneId: "m30t-01" }), names)).toBe("Drohne 1 ist live");
    expect(eventText(event({ kind: "stream-reset", droneId: "m30t-01", detail: "camera" }), names)).toBe(
      "Drohne 1: Kamera oder Bildformat gewechselt",
    );
    expect(
      eventText(event({ kind: "publish-rejected", detail: "m30t-9", address: "10.0.0.5:4242" }), names),
    ).toBe("Abgewiesen: Stream-Key „m30t-9“ (10.0.0.5:4242)");
    expect(eventText(event({ kind: "client-paused", client: "ELW", address: "10.0.0.7" }), names)).toBe(
      "ELW (10.0.0.7) angehalten",
    );
    expect(
      eventText(event({ kind: "client-renamed", client: "ELW", address: "10.0.0.7", detail: "ELW" }), names),
    ).toBe("Gerät (10.0.0.7) heißt jetzt „ELW“");
  });
});
