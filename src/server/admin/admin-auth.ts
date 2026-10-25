import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type LoginResult = { ok: true; token: string } | { ok: false; lockedForMs: number | undefined };

export interface AdminAuthOptions {
  pin: string;
  now?: () => number;
  /** Wrong PINs in a row from one address before it is locked out. */
  maxFailures?: number;
  lockMs?: number;
}

/** Sessions beyond this push out the oldest (each login creates one). */
const MAX_SESSIONS = 50;

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * PIN check for the admin page (ADR 0012). Sessions live in memory until the service
 * restarts. Wrong PINs lock the address out for a while. Plain HTTP in an offline LAN: this
 * guards against mistakes and curious users, not against someone sniffing the Wi-Fi.
 */
export class AdminAuth {
  private readonly pinDigest: Buffer;
  private readonly sessions = new Set<string>();
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  private readonly now: () => number;

  constructor(private readonly options: AdminAuthOptions) {
    this.pinDigest = digest(options.pin);
    this.now = options.now ?? Date.now;
  }

  login(pin: string, address: string): LoginResult {
    const now = this.now();
    const entry = this.failures.get(address);
    if (entry && entry.lockedUntil > now) return { ok: false, lockedForMs: entry.lockedUntil - now };

    // Compare digests: equal length, so timingSafeEqual does not leak the PIN length.
    if (!timingSafeEqual(digest(pin), this.pinDigest)) {
      // The count starts again after a lock-out (it is reset when locking).
      const count = (entry?.count ?? 0) + 1;
      const locked = count >= (this.options.maxFailures ?? 5);
      const lockMs = this.options.lockMs ?? 60_000;
      this.failures.set(address, { count: locked ? 0 : count, lockedUntil: locked ? now + lockMs : 0 });
      return { ok: false, lockedForMs: locked ? lockMs : undefined };
    }

    this.failures.delete(address);
    const token = randomBytes(24).toString("base64url");
    this.sessions.add(token);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.values().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    return { ok: true, token };
  }

  check(token: string | undefined): boolean {
    return token !== undefined && this.sessions.has(token);
  }

  logout(token: string | undefined): void {
    if (token !== undefined) this.sessions.delete(token);
  }
}
