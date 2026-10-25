/**
 * Live drone list from /api/events (SSE), shared by every component of a page. Framework-free:
 * React reads it through useSyncExternalStore (use-drones.ts).
 */
import {
  SSE_CLIENT_PAUSED,
  SSE_CLIENT_RELOAD,
  SSE_CLIENT_RESUMED,
  SSE_DRONE_UPDATED,
  SSE_SNAPSHOT,
  type DroneStatus,
  type DronesResponse,
} from "../../shared/api";
import { openEventSource } from "./http";

export type Connection = "connecting" | "open" | "reconnecting";

export interface DronesSnapshot {
  /** Undefined until the first snapshot has arrived; then in config order. */
  drones: readonly DroneStatus[] | undefined;
  connection: Connection;
  /**
   * Device time (Date.now) at which a drone went from live to not live while this page was
   * watching; removed when it is live again. Local clock, so a tablet with a wrong time does
   * not matter. Drones that were already offline when the page opened have no entry.
   */
  lostAt: ReadonlyMap<string, number>;
  /** An admin paused this device (ADR 0012): run no players until released. */
  paused: boolean;
}

export interface DronesStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): DronesSnapshot;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15_000;

function parse<T>(data: unknown, isValid: (value: unknown) => boolean): T | undefined {
  try {
    const value: unknown = JSON.parse(String(data));
    return isValid(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

const isDrone = (v: unknown): boolean =>
  typeof v === "object" && v !== null && typeof (v as DroneStatus).id === "string";
const isDronesResponse = (v: unknown): boolean =>
  typeof v === "object" && v !== null && Array.isArray((v as DronesResponse).drones);

export interface DronesStoreOptions {
  path?: string;
  /** An admin asked this device to reload (stuck kiosk screen). */
  onReload?: () => void;
}

export function createDronesStore({
  path = "/api/events",
  onReload = () => location.reload(),
}: DronesStoreOptions = {}): DronesStore {
  let snapshot: DronesSnapshot = {
    drones: undefined,
    connection: "connecting",
    lostAt: new Map(),
    paused: false,
  };
  const listeners = new Set<() => void>();
  let source: EventSource | undefined;
  let retryTimer: number | undefined;
  let closeTimer: number | undefined;
  let retryMs = RETRY_MIN_MS;

  const set = (next: Partial<DronesSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };

  /** New drone list, keeping track of which drones just lost their signal. */
  const setDrones = (drones: readonly DroneStatus[], extra: Partial<DronesSnapshot> = {}) => {
    const lostAt = new Map(snapshot.lostAt);
    const now = Date.now();
    for (const drone of drones) {
      const before = snapshot.drones?.find((d) => d.id === drone.id);
      if (drone.state === "live") lostAt.delete(drone.id);
      else if (before?.state === "live") lostAt.set(drone.id, now);
    }
    set({ ...extra, drones, lostAt });
  };

  const connect = () => {
    const es = openEventSource(path);
    source = es;
    es.addEventListener(SSE_SNAPSHOT, (event) => {
      const body = parse<DronesResponse>((event as MessageEvent).data, isDronesResponse);
      if (!body) return;
      retryMs = RETRY_MIN_MS;
      // A pause is repeated right after the snapshot; after a service restart there is none.
      setDrones(body.drones, { connection: "open", paused: false });
    });
    es.addEventListener(SSE_CLIENT_PAUSED, () => set({ paused: true }));
    es.addEventListener(SSE_CLIENT_RESUMED, () => set({ paused: false }));
    es.addEventListener(SSE_CLIENT_RELOAD, () => onReload());
    es.addEventListener(SSE_DRONE_UPDATED, (event) => {
      const drone = parse<DroneStatus>((event as MessageEvent).data, isDrone);
      if (!drone || !snapshot.drones) return;
      setDrones(snapshot.drones.map((d) => (d.id === drone.id ? drone : d)));
    });
    es.addEventListener("error", () => {
      set({ connection: "reconnecting" });
      // CONNECTING: the browser retries by itself. CLOSED (e.g. HTTP 502 from a proxy): it
      // has given up, so build a new one.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    });
  };

  const disconnect = () => {
    window.clearTimeout(retryTimer);
    source?.close();
    source = undefined;
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      window.clearTimeout(closeTimer);
      if (!source) connect();
      return () => {
        listeners.delete(onChange);
        // Deferred, so StrictMode's unsubscribe/subscribe does not reconnect.
        if (listeners.size === 0) closeTimer = window.setTimeout(disconnect, 0);
      };
    },
    getSnapshot: () => snapshot,
  };
}
