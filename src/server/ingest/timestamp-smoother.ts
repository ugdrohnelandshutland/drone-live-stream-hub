/**
 * Evens out the video timestamps of one publisher session (ADR 0013). Pilot 2 stamps frames
 * 2–37 ms apart instead of every 33 ms; Chrome then shows only the last of several frames per
 * screen refresh and drops about a third of them. The smoother puts pictures on an even grid
 * at the measured frame rate and follows the publisher's clock slowly, so it never drifts
 * away. Real pauses and jumps keep their length. Works tag by tag, without lookahead, so it
 * adds no latency.
 */

/** Pictures used to measure the frame interval (about two seconds at 30 fps). */
const INTERVAL_WINDOW = 60;
/** Below this many measured intervals the default is used. */
const MIN_INTERVAL_SAMPLES = 10;
const DEFAULT_INTERVAL_MS = 1000 / 30;
const MIN_INTERVAL_MS = 16;
const MAX_INTERVAL_MS = 50;
/** Share of the deviation from the publisher's clock corrected per picture. */
const FOLLOW = 0.05;
/** Further away from the publisher's clock than this: start again from it. */
const MAX_DEVIATION_MS = 300;
/** A gap this many frame intervals long is a real pause, kept as it is. */
const PAUSE_INTERVALS = 8;
/** Pictures are never closer together than this share of the frame interval. */
const MIN_SPACING = 0.5;

export interface SmootherStats {
  /** Times the smoother started again from the publisher's clock (pause, jump, drift). */
  resyncs: number;
  /** Largest distance between an output and its input timestamp, in ms. */
  maxDeviationMs: number;
}

export class TimestampSmoother {
  /** Input timestamps of the recent pictures, oldest first. */
  private history: number[] = [];
  private lastIn: number | undefined;
  /** Unrounded output of the last picture. */
  private lastOut: number | undefined;
  /** Set once a picture has a composition time offset: then timestamps only get shifted. */
  private passthroughOffset: number | undefined;
  readonly stats: SmootherStats = { resyncs: 0, maxDeviationMs: 0 };

  /**
   * Output timestamp for a picture (a coded frame with picture data). `compositionTime` is the
   * pts - dts offset: with B-frames the dts spacing must stay as it is, so the smoother then
   * only keeps its current offset.
   */
  picture(timestamp: number, compositionTime: number): number {
    if (this.lastIn === undefined || this.lastOut === undefined) return this.restart(timestamp);
    if (compositionTime !== 0 && this.passthroughOffset === undefined) {
      this.passthroughOffset = this.lastOut - this.lastIn;
    }
    if (this.passthroughOffset !== undefined) {
      return this.take(timestamp, Math.max(this.lastOut, timestamp + this.passthroughOffset));
    }

    const delta = timestamp - this.lastIn;
    // Several tags of one picture time (Pilot 2 sends SEI tags separately).
    if (delta === 0) return Math.round(this.lastOut);

    // The publisher's clock jumped back (as it did before smoothing, viewers see the jump).
    if (delta < 0) {
      this.stats.resyncs++;
      return this.restart(timestamp, timestamp);
    }
    const interval = this.interval();
    const earliest = this.lastOut + interval * MIN_SPACING;
    if (delta > PAUSE_INTERVALS * interval) return this.resync(timestamp, earliest);
    this.history.push(timestamp);
    if (this.history.length > INTERVAL_WINDOW + 1) this.history.shift();

    let out = this.lastOut + interval;
    const deviation = timestamp - out;
    if (Math.abs(deviation) > MAX_DEVIATION_MS) return this.resync(timestamp, earliest);
    out += deviation * FOLLOW;
    return this.take(timestamp, Math.max(out, earliest));
  }

  /**
   * Output timestamp for any other video tag (sequence header, SEI-only frame): the time of
   * the last picture, so the output never goes backwards.
   */
  other(timestamp: number): number {
    return this.lastOut === undefined ? timestamp : Math.round(this.lastOut);
  }

  private interval(): number {
    const samples = this.history.length - 1;
    if (samples < MIN_INTERVAL_SAMPLES) return DEFAULT_INTERVAL_MS;
    const measured = ((this.history.at(-1) ?? 0) - (this.history[0] ?? 0)) / samples;
    return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, measured));
  }

  /** Starts again from the publisher's clock, but never before `earliest` (output order). */
  private resync(timestamp: number, earliest: number): number {
    this.stats.resyncs++;
    return this.restart(timestamp, Math.max(timestamp, earliest));
  }

  private restart(timestamp: number, out = timestamp): number {
    this.history = [timestamp];
    return this.take(timestamp, out);
  }

  private take(timestamp: number, out: number): number {
    this.lastIn = timestamp;
    this.lastOut = out;
    const rounded = Math.round(out);
    this.stats.maxDeviationMs = Math.max(this.stats.maxDeviationMs, Math.abs(rounded - timestamp));
    return rounded;
  }
}
