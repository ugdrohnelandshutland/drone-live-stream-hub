/**
 * Sum of values over a sliding time window, in fixed buckets: constant memory however often
 * `add` is called (once per video message for the bandwidth).
 */
export class WindowCounter {
  private readonly counts: number[];
  /** Bucket number (time / bucketMs) each slot currently holds. */
  private readonly epochs: number[];

  constructor(
    private readonly bucketMs: number,
    private readonly buckets: number,
  ) {
    this.counts = new Array<number>(buckets).fill(0);
    this.epochs = new Array<number>(buckets).fill(-1);
  }

  add(value: number, now: number): void {
    const epoch = Math.floor(now / this.bucketMs);
    const slot = epoch % this.buckets;
    const fresh = this.epochs[slot] !== epoch;
    this.epochs[slot] = epoch;
    this.counts[slot] = (fresh ? 0 : (this.counts[slot] ?? 0)) + value;
  }

  /**
   * Sum of the last `count` buckets (default: all). `complete` leaves out the running bucket,
   * so a rate does not dip at the start of each bucket.
   */
  sum(now: number, count = this.buckets, complete = false): number {
    const current = Math.floor(now / this.bucketMs);
    const newest = complete ? current - 1 : current;
    const oldest = newest - Math.min(count, this.buckets) + 1;
    let total = 0;
    this.epochs.forEach((epoch, i) => {
      if (epoch >= oldest && epoch <= newest) total += this.counts[i] ?? 0;
    });
    return total;
  }
}
