import type { DroneStatus } from "../../src/shared/api";
import { SSE_DRONE_UPDATED, SSE_SNAPSHOT } from "../../src/shared/api";

/** Stand-in for the browser's EventSource (missing in jsdom); install with vi.stubGlobal. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  static latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error("no EventSource opened");
    return last;
  }

  static open(): FakeEventSource[] {
    return FakeEventSource.instances.filter((s) => s.readyState !== FakeEventSource.CLOSED);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data: unknown): void {
    if (type !== "error") this.readyState = FakeEventSource.OPEN;
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  snapshot(drones: DroneStatus[]): void {
    this.emit(SSE_SNAPSHOT, { drones });
  }

  updated(drone: DroneStatus): void {
    this.emit(SSE_DRONE_UPDATED, drone);
  }

  /** Network error; `giveUp` = the browser stops retrying (readyState CLOSED). */
  fail(giveUp = false): void {
    this.readyState = giveUp ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.emit("error", "");
  }
}

export function drone(id: string, state: DroneStatus["state"], name = `Drohne ${id}`): DroneStatus {
  return {
    id,
    name,
    state,
    since: "2026-10-10T08:00:00.000Z",
    sessionId: state === "live" ? `s-${id}` : null,
    viewerCount: 0,
    video: null,
  };
}
