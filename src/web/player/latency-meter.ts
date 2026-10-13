/**
 * Glass-to-glass latency from the simulator's timecode strip (src/shared/timecode.ts).
 * The simulated drones run on the same PC as the service, so the service clock equals the
 * encoder clock; the page estimates its offset to the service clock via /healthz.
 */
import { TIMECODE_CELLS, decodeTimecode, timecodeLatency, timecodeLayout } from "../../shared/timecode";

export class ServiceClock {
  /** serviceTime ≈ Date.now() + offsetMs */
  offsetMs = 0;
  synced = false;

  async sync(samples = 5): Promise<void> {
    let best: { rtt: number; offset: number } | undefined;
    for (let i = 0; i < samples; i++) {
      const t0 = performance.timeOrigin + performance.now();
      const res = await fetch("/healthz", { cache: "no-store" });
      const t1 = performance.timeOrigin + performance.now();
      const { time } = (await res.json()) as { time: number };
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: time - (t0 + t1) / 2 };
    }
    if (best) {
      this.offsetMs = best.offset;
      this.synced = true;
    }
  }
}

export interface LatencyStats {
  current: number | undefined;
  avg: number | undefined;
  p95: number | undefined;
  min: number | undefined;
  max: number | undefined;
  samples: number;
  unreadable: number;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export class LatencyMeter {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  private window: number[] = [];
  private current: number | undefined;
  private unreadable = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly clock: ServiceClock,
    private readonly windowSize = 300,
  ) {}

  /** Call from requestVideoFrameCallback with the frame's metadata. */
  onFrame(metadata: VideoFrameCallbackMetadata): void {
    if (!this.ctx || !this.clock.synced) return;
    const { width, height } = metadata;
    const layout = timecodeLayout(width, height);
    const stripWidth = TIMECODE_CELLS * layout.cell;
    if (this.canvas.width !== stripWidth || this.canvas.height !== layout.cell) {
      this.canvas.width = stripWidth;
      this.canvas.height = layout.cell;
    }
    this.ctx.drawImage(
      this.video,
      layout.x,
      layout.y,
      stripWidth,
      layout.cell,
      0,
      0,
      stripWidth,
      layout.cell,
    );
    const pixels = this.ctx.getImageData(0, 0, stripWidth, layout.cell).data;
    const row = Math.floor(layout.cell / 2) * stripWidth;
    const cells: boolean[] = [];
    for (let i = 0; i < TIMECODE_CELLS; i++) {
      const p = (row + i * layout.cell + Math.floor(layout.cell / 2)) * 4;
      cells.push(((pixels[p] ?? 0) + (pixels[p + 1] ?? 0) + (pixels[p + 2] ?? 0)) / 3 > 128);
    }
    const timecode = decodeTimecode(cells);
    if (timecode === undefined) {
      this.unreadable++;
      return;
    }
    const displayedAt = performance.timeOrigin + metadata.expectedDisplayTime + this.clock.offsetMs;
    const latency = timecodeLatency(timecode, displayedAt);
    if (latency === undefined) {
      this.unreadable++;
      return;
    }
    this.current = latency;
    this.window.push(latency);
    if (this.window.length > this.windowSize) this.window.shift();
  }

  reset(): void {
    this.window = [];
    this.current = undefined;
    this.unreadable = 0;
  }

  stats(): LatencyStats {
    const sorted = [...this.window].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : undefined;
    return {
      current: this.current,
      avg: avg === undefined ? undefined : Math.round(avg),
      p95: percentile(sorted, 0.95),
      min: sorted[0],
      max: sorted.at(-1),
      samples: sorted.length,
      unreadable: this.unreadable,
    };
  }
}
