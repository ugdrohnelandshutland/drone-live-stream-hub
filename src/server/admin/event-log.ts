import { ADMIN_EVENT_LIMIT, type AdminEvent } from "../../shared/admin.js";

export type EventInput = Omit<AdminEvent, "seq" | "at">;

/**
 * Recent events for the admin page, in memory only (the service log has everything). Keeps
 * the newest `limit`; readers ask for what is newer than the last one they have.
 */
export class EventLog {
  private readonly entries: AdminEvent[] = [];
  private seq = 0;

  constructor(
    private readonly limit = ADMIN_EVENT_LIMIT,
    private readonly now: () => Date = () => new Date(),
  ) {}

  add(input: EventInput): void {
    this.entries.push({ seq: ++this.seq, at: this.now().toISOString(), ...input });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  /** Events with a higher number than `seq`, oldest first. */
  after(seq: number): AdminEvent[] {
    const index = this.entries.findIndex((e) => e.seq > seq);
    return index < 0 ? [] : this.entries.slice(index);
  }
}
