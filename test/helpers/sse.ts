export interface SseEvent {
  event: string;
  data: string;
}

/** Minimal SSE client on fetch streams, for tests and simulators. */
export class SseClient {
  readonly events: SseEvent[] = [];
  private readonly controller = new AbortController();
  readonly done: Promise<void>;

  constructor(url: string) {
    this.done = this.run(url).catch((err: unknown) => {
      if ((err as Error).name !== "AbortError") throw err;
    });
  }

  private async run(url: string): Promise<void> {
    const res = await fetch(url, { signal: this.controller.signal });
    if (!res.body) throw new Error("no SSE body");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data.push(line.slice(6));
        }
        if (data.length > 0) this.events.push({ event, data: data.join("\n") });
      }
    }
  }

  close(): void {
    this.controller.abort();
  }
}
