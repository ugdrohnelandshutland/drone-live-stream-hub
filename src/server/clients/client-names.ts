import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger.js";

/** Names the admin gave devices, by client id. */
export interface ClientNameStore {
  get(clientId: string): string | undefined;
  /** Undefined removes the name. */
  set(clientId: string, name: string | undefined): void;
}

/** In memory only (tests, or when no data directory is configured). */
export class MemoryClientNames implements ClientNameStore {
  private readonly names = new Map<string, string>();
  get(clientId: string): string | undefined {
    return this.names.get(clientId);
  }
  set(clientId: string, name: string | undefined): void {
    if (name === undefined) this.names.delete(clientId);
    else this.names.set(clientId, name);
  }
}

const fileSchema = z.object({
  version: z.literal(1),
  clients: z.record(z.string(), z.object({ name: z.string().min(1), updatedAt: z.string() })),
});
type NamesFile = z.infer<typeof fileSchema>;

/** Old names beyond this are dropped (devices that are long gone). */
const MAX_NAMES = 500;
const SAVE_DELAY_MS = 1000;

/**
 * `<dataDir>/clients.json`, so names survive restarts and changing IPs. Loaded once at
 * startup; changes are written asynchronously, batched, via a temporary file and rename so a
 * crash never leaves half a file. A missing or broken file means no names, never a failed start.
 */
export class FileClientNames implements ClientNameStore {
  private entries = new Map<string, { name: string; updatedAt: string }>();
  private saveTimer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();
  readonly filePath: string;

  constructor(
    dataDir: string,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.filePath = path.join(dataDir, "clients.json");
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn({ err, file: this.filePath }, "cannot read device names, starting without");
      }
      return;
    }
    try {
      const parsed = fileSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
      this.entries = new Map(Object.entries(parsed.clients));
      this.logger.info({ file: this.filePath, names: this.entries.size }, "device names loaded");
    } catch (err) {
      this.logger.warn({ err, file: this.filePath }, "device names file is invalid, starting without");
    }
  }

  get(clientId: string): string | undefined {
    return this.entries.get(clientId)?.name;
  }

  set(clientId: string, name: string | undefined): void {
    if (name === undefined) this.entries.delete(clientId);
    else this.entries.set(clientId, { name, updatedAt: this.now().toISOString() });
    if (this.entries.size > MAX_NAMES) {
      const oldest = [...this.entries].sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
      for (const [id] of oldest.slice(0, this.entries.size - MAX_NAMES)) this.entries.delete(id);
    }
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      this.saving = this.saving.then(() => this.save());
    }, SAVE_DELAY_MS);
  }

  /** Writes pending changes now (service shutdown). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.saving = this.saving.then(() => this.save());
    }
    await this.saving;
  }

  private async save(): Promise<void> {
    const body: NamesFile = { version: 1, clients: Object.fromEntries(this.entries) };
    const tmp = `${this.filePath}.tmp`;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
      await rename(tmp, this.filePath);
    } catch (err) {
      // Names are a convenience: keep running, they stay in memory until the next restart.
      this.logger.error({ err, file: this.filePath }, "cannot save device names");
    }
  }
}
