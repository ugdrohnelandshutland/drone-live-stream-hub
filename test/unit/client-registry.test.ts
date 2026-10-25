import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryClientNames } from "../../src/server/clients/client-names.js";
import {
  ClientRegistry,
  type ClientEvent,
  type StreamOpen,
} from "../../src/server/clients/client-registry.js";
import { WindowCounter } from "../../src/server/clients/window-counter.js";
import { describeUserAgent } from "../../src/server/clients/user-agent.js";
import { CloseCode } from "../../src/shared/close-codes.js";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

describe("WindowCounter", () => {
  it("sums the window and forgets old buckets", () => {
    const counter = new WindowCounter(1000, 5);
    counter.add(1, 0);
    counter.add(2, 999);
    counter.add(4, 1000);
    expect(counter.sum(1500)).toBe(7);
    expect(counter.sum(1500, 5, true)).toBe(3); // only the finished first second
    expect(counter.sum(5500)).toBe(4); // the first bucket fell out
    expect(counter.sum(10_000)).toBe(0);
    counter.add(8, 10_000); // reuses the slot of second 0 and 5
    expect(counter.sum(10_000)).toBe(8);
  });
});

describe("describeUserAgent", () => {
  it.each([
    [ANDROID, "Chrome · Android"],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1",
      "Chrome · iOS",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15",
      "Safari · Mac/iPad",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0",
      "Edge · Windows",
    ],
    [undefined, ""],
  ])("%s", (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label);
  });
});

describe("ClientRegistry", () => {
  let now: number;
  let events: ClientEvent[];
  let registry: ClientRegistry;
  let names: MemoryClientNames;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    events = [];
    names = new MemoryClientNames();
    registry = new ClientRegistry({
      names,
      now: () => now,
      onEvent: (e) => events.push(e),
      offlineGraceMs: 5000,
    });
  });

  afterEach(() => {
    registry.stop();
    vi.useRealTimers();
  });

  function socket(clientId: string | undefined, droneId = "m30t-01", address = "10.0.0.7") {
    const closed: number[] = [];
    const open: StreamOpen = {
      clientId,
      address,
      userAgent: ANDROID,
      droneId,
      mode: "full",
      close: (code) => closed.push(code),
    };
    return { tracker: registry.openStream(open), closed };
  }

  function sse(clientId: string | undefined, address = "10.0.0.7") {
    const sent: string[] = [];
    const leave = registry.openEvents({
      clientId,
      address,
      userAgent: ANDROID,
      send: (event) => sent.push(event),
    });
    return { sent, leave };
  }

  it("groups sockets and the SSE connection of one browser into one device", () => {
    sse("tablet-1");
    socket("tablet-1", "m30t-01");
    socket("tablet-1", "m30t-02");
    const [client, ...rest] = registry.list();
    expect(rest).toEqual([]);
    expect(client).toMatchObject({
      id: "tablet-1",
      anonymous: false,
      device: "Chrome · Android",
      address: "10.0.0.7",
      online: true,
      paused: false,
      streams: [{ droneId: "m30t-01" }, { droneId: "m30t-02" }],
    });
    expect(events.map((e) => e.kind)).toEqual(["client-online"]);
  });

  it("closes a paused device's sockets with 4003, refuses new ones and tells it over SSE", () => {
    const events1 = sse("tablet-1");
    const first = socket("tablet-1");
    const other = socket("tablet-2");

    expect(registry.pause("tablet-1")).toBe(true);
    expect(first.closed).toEqual([CloseCode.Paused]);
    expect(other.closed).toEqual([]);
    expect(events1.sent).toEqual(["client-paused"]);
    first.tracker?.closed("normal");

    expect(socket("tablet-1").tracker).toBeUndefined();
    // A new SSE connection (reload) hears about the pause at once.
    expect(sse("tablet-1").sent).toEqual(["client-paused"]);
    expect(registry.list().find((c) => c.id === "tablet-1")?.paused).toBe(true);

    expect(registry.resume("tablet-1")).toBe(true);
    expect(events1.sent).toEqual(["client-paused", "client-resumed"]);
    expect(socket("tablet-1").tracker).toBeDefined();
    expect(events.map((e) => e.kind)).toEqual([
      "client-online",
      "client-online",
      "client-paused",
      "client-resumed",
    ]);
  });

  it("lists devices without a cookie by address and does not let them be controlled", () => {
    socket(undefined, "m30t-01", "10.0.0.9");
    socket(undefined, "m30t-02", "10.0.0.9");
    const [client] = registry.list();
    expect(client).toMatchObject({ id: "anon:10.0.0.9", anonymous: true, name: null, streams: [{}, {}] });
    expect(registry.pause("anon:10.0.0.9")).toBe(false);
    expect(registry.rename("anon:10.0.0.9", "x")).toBe(false);
    expect(registry.pause("nobody")).toBe(false);
  });

  it("keeps the known address when a connection reports none", () => {
    sse("tablet-1", "10.0.0.7");
    socket("tablet-1", "m30t-01", "?");
    expect(registry.list()[0]?.address).toBe("10.0.0.7");
  });

  it("names devices through the name store", () => {
    sse("tablet-1");
    expect(registry.rename("tablet-1", "  ELW Großbildschirm ")).toBe(true);
    expect(names.get("tablet-1")).toBe("ELW Großbildschirm");
    expect(registry.list()[0]?.name).toBe("ELW Großbildschirm");
    registry.rename("tablet-1", "");
    expect(registry.list()[0]?.name).toBeNull();
  });

  it("reloads only devices with an event connection", () => {
    socket("tablet-1");
    expect(registry.reload("tablet-1")).toBe(false);
    const events1 = sse("tablet-1");
    expect(registry.reload("tablet-1")).toBe(true);
    expect(events1.sent).toEqual(["client-reload"]);
  });

  it("reports going offline only after the grace period, so a reload is no event", () => {
    const first = sse("tablet-1");
    first.leave();
    vi.advanceTimersByTime(1000);
    const second = sse("tablet-1");
    vi.advanceTimersByTime(10_000);
    expect(events.map((e) => e.kind)).toEqual(["client-online"]);

    second.leave();
    now += 5000;
    vi.advanceTimersByTime(5000);
    expect(events.map((e) => e.kind)).toEqual(["client-online", "client-offline"]);
    expect(registry.list()[0]).toMatchObject({ online: false, onlineSince: null });

    // Listed for a while, then gone; a paused device stays.
    now += 11 * 60_000;
    expect(registry.list()).toEqual([]);
  });

  it("keeps a paused device listed while it is away", () => {
    const events1 = sse("tablet-1");
    registry.pause("tablet-1");
    events1.leave();
    now += 2 * 60 * 60_000;
    vi.advanceTimersByTime(10_000);
    expect(registry.list()[0]).toMatchObject({ id: "tablet-1", online: false, paused: true });
  });

  it("measures bandwidth, dropped frames, slow closures and aborts per device", () => {
    const a = socket("tablet-1");
    const b = socket("tablet-1", "m30t-02");
    for (let s = 0; s < 6; s++) {
      a.tracker?.sent(62_500); // 500 kbit per second
      b.tracker?.sent(62_500);
      now += 1000;
    }
    a.tracker?.dropped();
    a.tracker?.dropped();
    a.tracker?.closed("slow");
    b.tracker?.closed("abort");
    const [client] = registry.list();
    expect(client?.quality).toEqual({ kbps: 1000, droppedFrames: 2, slowClosures: 1, aborts: 1 });
    expect(registry.outKbps()).toBe(1000);

    now += 11 * 60_000;
    expect(registry.list()).toEqual([]);
  });
});
