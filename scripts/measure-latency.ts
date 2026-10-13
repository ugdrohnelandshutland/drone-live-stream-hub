/**
 * Measures glass-to-glass latency in a real Chrome: opens the single view with `?stats`,
 * which decodes the simulator's timecode strip per presented frame (src/web/player/latency-meter.ts),
 * and samples the result via the Chrome DevTools Protocol.
 *
 *   npm run measure:latency -- --drone m30t-01 --duration 30
 *
 * Uses only Node built-ins and erasable TypeScript, so it also runs with plain
 * `node --experimental-strip-types` — e.g. with Windows node.exe from WSL, where the
 * Windows Chrome's debugging port is not reachable from Linux:
 *   node.exe --experimental-strip-types \\wsl.localhost\<distro>\<repo>\scripts\measure-latency.ts
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "localhost:8080" },
    drone: { type: "string", default: "m30t-01" },
    duration: { type: "string", default: "30" },
    warmup: { type: "string", default: "5" },
    chrome: { type: "string" },
    port: { type: "string", default: "9333" },
    headful: { type: "boolean", default: false },
    out: { type: "string" },
    /** Extra query string for the page, e.g. "syncTarget=0.15&syncMax=0.3". */
    params: { type: "string", default: "" },
  },
});

function findChrome(): string {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env["PROGRAMFILES"] ?? "C:\\Program Files",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(process.env["LOCALAPPDATA"] ?? "", "Google\\Chrome\\Application\\chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  const found = [values.chrome, process.env["CHROME_PATH"], ...candidates].find((p) => p && existsSync(p));
  if (!found) throw new Error("Chrome not found; pass --chrome <path> or set CHROME_PATH");
  return found;
}

interface CdpResponse {
  id?: number;
  result?: { result?: { value?: unknown }; data?: string };
  error?: { message: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, (msg: CdpResponse) => void>();
  private readonly ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as CdpResponse;
      if (msg.id !== undefined) this.pending.get(msg.id)?.(msg);
    };
    // Chrome gone: fail every open request instead of waiting forever.
    this.ws.onclose = () => {
      for (const resolve of this.pending.values())
        resolve({ error: { message: "Chrome DevTools connection closed" } });
      this.pending.clear();
    };
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("CDP connection failed"));
    });
  }

  send(method: string, params: object = {}, timeoutMs = 15_000): Promise<CdpResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    avg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : undefined,
    p95: at(0.95),
    max: sorted.at(-1),
  };
}

async function main(): Promise<void> {
  const url = `http://${values.host}/drone/${encodeURIComponent(values.drone)}?stats${values.params ? `&${values.params}` : ""}`;
  const port = Number(values.port);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "dlsh-chrome-"));
  const chrome = spawn(
    findChrome(),
    [
      ...(values.headful ? [] : ["--headless=new"]),
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1920,1080",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("exit", (code) => {
    if (code !== null && code !== 0) console.error(`Chrome exited with code ${code}`);
  });

  try {
    let wsUrl: string | undefined;
    for (let i = 0; i < 50 && !wsUrl; i++) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {
        await sleep(200);
      }
    }
    if (!wsUrl) throw new Error("Chrome DevTools endpoint not reachable");

    const cdp = new Cdp(wsUrl);
    await cdp.opened();
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });
    console.log(`Measuring ${url} for ${values.duration}s (warm-up ${values.warmup}s) …`);
    await sleep(Number(values.warmup) * 1000);

    const read = async () => {
      const res = await cdp.send("Runtime.evaluate", {
        expression:
          "JSON.stringify({ ...document.getElementById('stats')?.dataset, status: document.querySelector('.status')?.dataset.state, video: [document.querySelector('video')?.videoWidth, document.querySelector('video')?.videoHeight] })",
        returnByValue: true,
      });
      return JSON.parse(String(res.result?.result?.value ?? "{}")) as Record<string, string | number[]>;
    };

    const current: number[] = [];
    const buffers: number[] = [];
    const statuses: Record<string, number> = {};
    const timeline: { atSec: number; status: string }[] = [];
    const startedAt = Date.now();
    const end = startedAt + Number(values.duration) * 1000;
    let last: Record<string, string | number[]> = {};
    while (Date.now() < end) {
      last = await read();
      const status = String(last["status"]);
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (timeline.at(-1)?.status !== status) {
        timeline.push({ atSec: Math.round((Date.now() - startedAt) / 100) / 10, status });
      }
      const latency = Number(last["latencyCurrent"]);
      if (last["latencyCurrent"] !== "" && Number.isFinite(latency)) current.push(latency);
      if (last["bufferMs"] !== undefined) buffers.push(Number(last["bufferMs"]));
      await sleep(250);
    }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const report = {
      url,
      measuredAt: new Date().toISOString(),
      durationSec: Number(values.duration),
      latencyMs: summarize(current),
      lastWindow: {
        avg: last["latencyAvg"],
        p95: last["latencyP95"],
        min: last["latencyMin"],
        max: last["latencyMax"],
        frames: last["samples"],
        unreadable: last["unreadable"],
      },
      bufferMs: summarize(buffers),
      droppedFrames: last["dropped"],
      video: last["video"],
      statusSamples: statuses,
      statusTimeline: timeline,
    };
    console.log(JSON.stringify(report, null, 2));
    if (values.out) {
      await mkdir(path.dirname(values.out), { recursive: true });
      await writeFile(values.out, JSON.stringify(report, null, 2));
      if (shot.result?.data)
        await writeFile(values.out.replace(/\.json$/, ".png"), Buffer.from(shot.result.data, "base64"));
    }
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(500);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
