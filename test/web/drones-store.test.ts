// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDronesStore } from "../../src/web/service/drones-store";
import { drone, FakeEventSource } from "./fake-event-source";

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("drones store", () => {
  it("applies snapshots and updates", () => {
    const store = createDronesStore();
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(store.getSnapshot()).toEqual({
      drones: undefined,
      connection: "connecting",
      lostAt: new Map(),
      paused: false,
    });

    FakeEventSource.latest().snapshot([drone("a", "offline"), drone("b", "live")]);
    FakeEventSource.latest().updated(drone("a", "live"));
    expect(store.getSnapshot().drones?.map((d) => d.state)).toEqual(["live", "live"]);
    expect(store.getSnapshot().connection).toBe("open");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("remembers when a watched drone lost its signal, until it is live again", () => {
    vi.setSystemTime(1000);
    const store = createDronesStore();
    store.subscribe(() => undefined);
    const source = FakeEventSource.latest();
    source.snapshot([drone("a", "offline"), drone("b", "live")]);
    expect(store.getSnapshot().lostAt).toEqual(new Map()); // already offline when opened

    vi.setSystemTime(5000);
    source.updated(drone("b", "offline"));
    expect(store.getSnapshot().lostAt).toEqual(new Map([["b", 5000]]));
    source.updated(drone("a", "offline"));
    expect(store.getSnapshot().lostAt).toEqual(new Map([["b", 5000]]));

    source.updated(drone("b", "live"));
    expect(store.getSnapshot().lostAt).toEqual(new Map());

    // A new snapshot (service restarted) counts as well.
    vi.setSystemTime(9000);
    source.snapshot([drone("a", "offline"), drone("b", "offline")]);
    expect(store.getSnapshot().lostAt).toEqual(new Map([["b", 9000]]));
  });

  it("ignores malformed events", () => {
    const store = createDronesStore();
    store.subscribe(() => undefined);
    const source = FakeEventSource.latest();
    source.snapshot([drone("a", "live")]);
    source.emit("drone-updated", "{not json");
    source.emit("snapshot", { nope: true });
    expect(store.getSnapshot().drones).toEqual([drone("a", "live")]);
  });

  it("shares one connection between subscribers and survives StrictMode's resubscribe", () => {
    const store = createDronesStore();
    const off = store.subscribe(() => undefined);
    off();
    store.subscribe(() => undefined);
    store.subscribe(() => undefined);
    vi.runOnlyPendingTimers();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.open()).toHaveLength(1);
  });

  it("closes the connection after the last subscriber leaves", () => {
    const store = createDronesStore();
    const off = store.subscribe(() => undefined);
    off();
    vi.runOnlyPendingTimers();
    expect(FakeEventSource.open()).toHaveLength(0);
  });

  it("reports reconnecting and builds a new connection when the browser gives up", () => {
    const store = createDronesStore();
    store.subscribe(() => undefined);
    FakeEventSource.latest().snapshot([drone("a", "live")]);

    FakeEventSource.latest().fail(false);
    expect(store.getSnapshot().connection).toBe("reconnecting");
    expect(FakeEventSource.instances).toHaveLength(1); // the browser retries by itself

    FakeEventSource.latest().fail(true);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.latest().snapshot([drone("a", "offline")]);
    expect(store.getSnapshot()).toMatchObject({ connection: "open", drones: [{ state: "offline" }] });
  });
});

describe("drones store, admin events (ADR 0012)", () => {
  it("follows pause and release, and a new snapshot clears a stale pause", () => {
    const store = createDronesStore();
    store.subscribe(() => undefined);
    const source = FakeEventSource.latest();
    source.snapshot([drone("a", "live")]);
    expect(store.getSnapshot().paused).toBe(false);

    source.emit("client-paused", {});
    expect(store.getSnapshot().paused).toBe(true);
    source.emit("client-resumed", {});
    expect(store.getSnapshot().paused).toBe(false);

    source.emit("client-paused", {});
    source.snapshot([drone("a", "live")]); // service restarted: pauses are gone
    expect(store.getSnapshot().paused).toBe(false);
  });

  it("reloads on request", () => {
    const onReload = vi.fn();
    const store = createDronesStore({ onReload });
    store.subscribe(() => undefined);
    FakeEventSource.latest().emit("client-reload", {});
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
