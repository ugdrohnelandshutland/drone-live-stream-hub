import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { FlvStreamParser } from "../server/flv/reader.js";
import type { FlvTag } from "../server/flv/types.js";

export interface ViewerTag extends FlvTag {
  /** Wall-clock arrival time (ms). */
  receivedAt: number;
}

/**
 * Headless viewer: connects to /ws/live/<droneId>, parses the FLV byte stream and reports
 * tags and the close code. Basis for integration tests and the load tester (milestone 5).
 *
 * Events: `open`, `header`, `tag` (ViewerTag), `close` (code, reason), `error` (Error).
 */
export class FlvViewer extends EventEmitter {
  private ws: WebSocket | undefined;
  private parser = new FlvStreamParser();
  readonly tags: ViewerTag[] = [];
  bytes = 0;
  firstByteAt: number | undefined;
  closeCode: number | undefined;
  /** Keep received tags in `tags` (disable for long load tests). */
  recordTags = true;

  constructor(readonly url: string) {
    super();
  }

  connect(): this {
    this.parser = new FlvStreamParser();
    this.closeCode = undefined;
    const ws = new WebSocket(this.url, { perMessageDeflate: false });
    this.ws = ws;
    ws.binaryType = "nodebuffer";
    ws.on("open", () => this.emit("open"));
    ws.on("message", (data: Buffer) => {
      const now = Date.now();
      this.firstByteAt ??= now;
      this.bytes += data.length;
      try {
        const hadHeader = this.parser.header !== undefined;
        const tags = this.parser.push(data);
        if (!hadHeader && this.parser.header) this.emit("header", this.parser.header);
        for (const tag of tags) {
          const viewerTag = { ...tag, receivedAt: now };
          if (this.recordTags) this.tags.push(viewerTag);
          this.emit("tag", viewerTag);
        }
      } catch (err) {
        this.emit("error", err);
        ws.terminate();
      }
    });
    ws.on("close", (code, reason) => {
      this.closeCode = code;
      this.emit("close", code, reason.toString());
    });
    ws.on("error", (err) => this.emit("error", err));
    return this;
  }

  close(): void {
    this.ws?.close();
  }

  /** Resolves with the close code. */
  closed(): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => this.once("close", (code: number) => resolve(code)));
  }
}
