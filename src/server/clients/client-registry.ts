import type { AdminClient, AdminEventKind } from "../../shared/admin.js";
import { SSE_CLIENT_PAUSED, SSE_CLIENT_RELOAD, SSE_CLIENT_RESUMED } from "../../shared/api.js";
import { CloseCode, CloseReason } from "../../shared/close-codes.js";
import type { ViewerMode } from "../delivery/live-channel.js";
import type { ClientNameStore } from "./client-names.js";
import { describeUserAgent } from "./user-agent.js";
import { WindowCounter } from "./window-counter.js";

/** Who is connecting; `clientId` from the device cookie, undefined for scripts and simulators. */
export interface ClientIdentity {
  clientId: string | undefined;
  address: string;
  userAgent: string | undefined;
}

export interface StreamOpen extends ClientIdentity {
  droneId: string;
  mode: ViewerMode;
  close(code: number, reason: string): void;
}

/** How a video socket ended, for the connection quality. */
export type StreamEnd = "normal" | "slow" | "abort";

/** Reports one open video socket's traffic back to its device. */
export interface StreamTracker {
  sent(bytes: number): void;
  dropped(): void;
  closed(end: StreamEnd): void;
}

export interface EventsOpen extends ClientIdentity {
  send(event: string, data: unknown): void;
}

export interface ClientEvent {
  kind: Extract<AdminEventKind, `client-${string}`>;
  clientId: string;
  client: string;
  address: string;
  detail?: string;
}

export interface ClientRegistryOptions {
  names: ClientNameStore;
  now?: () => number;
  onEvent?: (event: ClientEvent) => void;
  /** A device counts as gone only after being without connections this long (page reload). */
  offlineGraceMs?: number;
}

interface Socket {
  droneId: string;
  mode: ViewerMode;
  since: number;
  close(code: number, reason: string): void;
}

interface Device {
  id: string;
  anonymous: boolean;
  device: string;
  address: string;
  paused: boolean;
  sockets: Map<number, Socket>;
  sinks: Set<EventsOpen["send"]>;
  onlineSince: number | undefined;
  lastSeen: number;
  offlineTimer: NodeJS.Timeout | undefined;
  bytes: WindowCounter;
  dropped: WindowCounter;
  slow: WindowCounter;
  aborts: WindowCounter;
}

const QUALITY_BUCKET_MS = 10_000;
const QUALITY_BUCKETS = 60; // 10 minutes
const RATE_SECONDS = 5;
/** Offline devices stay in the list this long, so a short drop-out stays visible. */
const LIST_OFFLINE_MS = 10 * 60_000;
/** Offline devices are forgotten after this (names stay in the name store; pauses stay). */
const FORGET_MS = 60 * 60_000;

/**
 * Devices watching the service (ADR 0012): one entry per browser, however many sockets it
 * opens. Knows which drones each device watches, how its connection is doing, and whether an
 * admin paused it. Paused devices get no video: their sockets are closed with 4003 and new
 * ones refused until they are released.
 */
export class ClientRegistry {
  private readonly devices = new Map<string, Device>();
  private readonly now: () => number;
  private nextSocket = 0;

  constructor(private readonly options: ClientRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Undefined: the device is paused; close the socket with 4003. */
  openStream(open: StreamOpen): StreamTracker | undefined {
    const device = this.touch(open);
    if (device.paused) return undefined;
    const key = this.nextSocket++;
    device.sockets.set(key, { droneId: open.droneId, mode: open.mode, since: this.now(), close: open.close });
    this.wentOnline(device);
    return {
      sent: (bytes) => device.bytes.add(bytes, this.now()),
      dropped: () => device.dropped.add(1, this.now()),
      closed: (end) => {
        if (!device.sockets.delete(key)) return;
        if (end === "slow") device.slow.add(1, this.now());
        if (end === "abort") device.aborts.add(1, this.now());
        this.connectionGone(device);
      },
    };
  }

  /** The device's SSE connection (`/api/events`): carries pause, release and reload to it. */
  openEvents(open: EventsOpen): () => void {
    const device = this.touch(open);
    device.sinks.add(open.send);
    this.wentOnline(device);
    if (device.paused) open.send(SSE_CLIENT_PAUSED, {});
    return () => {
      if (device.sinks.delete(open.send)) this.connectionGone(device);
    };
  }

  pause(clientId: string): boolean {
    const device = this.controllable(clientId);
    if (!device) return false;
    if (!device.paused) {
      device.paused = true;
      this.event("client-paused", device);
    }
    for (const send of device.sinks) send(SSE_CLIENT_PAUSED, {});
    for (const socket of [...device.sockets.values()])
      socket.close(CloseCode.Paused, CloseReason[CloseCode.Paused]);
    return true;
  }

  resume(clientId: string): boolean {
    const device = this.controllable(clientId);
    if (!device) return false;
    if (device.paused) {
      device.paused = false;
      this.event("client-resumed", device);
    }
    for (const send of device.sinks) send(SSE_CLIENT_RESUMED, {});
    return true;
  }

  /** False if the device is unknown or has no event connection to receive it. */
  reload(clientId: string): boolean {
    const device = this.controllable(clientId);
    if (!device || device.sinks.size === 0) return false;
    this.event("client-reload", device);
    for (const send of device.sinks) send(SSE_CLIENT_RELOAD, {});
    return true;
  }

  /** Empty or undefined removes the name. */
  rename(clientId: string, name: string | undefined): boolean {
    const device = this.controllable(clientId);
    if (!device) return false;
    const trimmed = name?.trim() || undefined;
    this.options.names.set(clientId, trimmed);
    this.event("client-renamed", device, trimmed ?? "");
    return true;
  }

  /** Online devices, paused ones and those seen in the last minutes; online first. */
  list(): AdminClient[] {
    const now = this.now();
    this.forgetOld(now);
    const shown = [...this.devices.values()].filter(
      (d) => this.online(d) || d.paused || now - d.lastSeen < LIST_OFFLINE_MS,
    );
    return shown
      .map((d): AdminClient => ({
        id: d.id,
        anonymous: d.anonymous,
        name: d.anonymous ? null : (this.options.names.get(d.id) ?? null),
        device: d.device,
        address: d.address,
        online: this.online(d),
        paused: d.paused,
        onlineSince: d.onlineSince === undefined ? null : new Date(d.onlineSince).toISOString(),
        lastSeen: new Date(this.online(d) ? now : d.lastSeen).toISOString(),
        streams: [...d.sockets.values()]
          .sort((a, b) => a.droneId.localeCompare(b.droneId))
          .map((s) => ({ droneId: s.droneId, mode: s.mode, since: new Date(s.since).toISOString() })),
        quality: {
          kbps: this.kbps(d, now),
          droppedFrames: d.dropped.sum(now),
          slowClosures: d.slow.sum(now),
          aborts: d.aborts.sum(now),
        },
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.address.localeCompare(b.address));
  }

  /** Sent to all devices over the last seconds. */
  outKbps(): number {
    const now = this.now();
    let total = 0;
    for (const device of this.devices.values()) total += this.kbps(device, now);
    return total;
  }

  get onlineCount(): number {
    let count = 0;
    for (const device of this.devices.values()) if (this.online(device)) count++;
    return count;
  }

  stop(): void {
    for (const device of this.devices.values()) clearTimeout(device.offlineTimer);
  }

  private touch(who: ClientIdentity): Device {
    const id = who.clientId ?? `anon:${who.address}`;
    let device = this.devices.get(id);
    if (!device) {
      device = {
        id,
        anonymous: who.clientId === undefined,
        device: describeUserAgent(who.userAgent),
        address: who.address,
        paused: false,
        sockets: new Map(),
        sinks: new Set(),
        onlineSince: undefined,
        lastSeen: this.now(),
        offlineTimer: undefined,
        bytes: new WindowCounter(1000, RATE_SECONDS + 1),
        dropped: new WindowCounter(QUALITY_BUCKET_MS, QUALITY_BUCKETS),
        slow: new WindowCounter(QUALITY_BUCKET_MS, QUALITY_BUCKETS),
        aborts: new WindowCounter(QUALITY_BUCKET_MS, QUALITY_BUCKETS),
      };
      this.devices.set(id, device);
    }
    // A socket that closed before we looked has no address any more; keep the known one.
    if (who.address !== "?") device.address = who.address;
    if (who.userAgent) device.device = describeUserAgent(who.userAgent);
    device.lastSeen = this.now();
    return device;
  }

  private controllable(clientId: string): Device | undefined {
    const device = this.devices.get(clientId);
    return device && !device.anonymous ? device : undefined;
  }

  private online(device: Device): boolean {
    return device.sockets.size > 0 || device.sinks.size > 0;
  }

  private wentOnline(device: Device): void {
    if (device.offlineTimer) {
      // Back within the grace period (reload, switching pages): no offline/online events.
      clearTimeout(device.offlineTimer);
      device.offlineTimer = undefined;
    }
    if (device.onlineSince === undefined) {
      device.onlineSince = this.now();
      this.event("client-online", device);
    }
  }

  private connectionGone(device: Device): void {
    device.lastSeen = this.now();
    if (this.online(device) || device.offlineTimer) return;
    device.offlineTimer = setTimeout(() => {
      device.offlineTimer = undefined;
      if (this.online(device) || device.onlineSince === undefined) return;
      device.onlineSince = undefined;
      this.event("client-offline", device);
    }, this.options.offlineGraceMs ?? 5000);
    device.offlineTimer.unref();
  }

  private forgetOld(now: number): void {
    for (const [id, device] of this.devices) {
      if (!this.online(device) && !device.paused && now - device.lastSeen > FORGET_MS) {
        clearTimeout(device.offlineTimer);
        this.devices.delete(id);
      }
    }
  }

  private kbps(device: Device, now: number): number {
    return Math.round((device.bytes.sum(now, RATE_SECONDS, true) * 8) / RATE_SECONDS / 1000);
  }

  private label(device: Device): string {
    return (device.anonymous ? undefined : this.options.names.get(device.id)) ?? device.device;
  }

  private event(kind: ClientEvent["kind"], device: Device, detail?: string): void {
    this.options.onEvent?.({
      kind,
      clientId: device.id,
      client: this.label(device),
      address: device.address,
      ...(detail !== undefined ? { detail } : {}),
    });
  }
}
