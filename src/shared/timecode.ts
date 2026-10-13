/**
 * Machine-readable wall-clock timecode burnt into simulated drone video, for latency
 * measurement in the browser without OCR.
 *
 * A strip of square cells at the bottom left: [white][black] start marker, then
 * TIMECODE_BITS data bits (LSB first, white = 1) of the frame's wall-clock time in
 * milliseconds modulo 2^TIMECODE_BITS, then one even-parity cell.
 * The simulator draws it (src/sim/drone.ts), the web page reads it (src/web/player/latency-meter.ts).
 */

export const TIMECODE_BITS = 24;
export const TIMECODE_MODULO = 2 ** TIMECODE_BITS;
export const TIMECODE_CELLS = 2 + TIMECODE_BITS + 1;

export interface TimecodeLayout {
  /** Edge length of one cell in video pixels. */
  cell: number;
  x: number;
  y: number;
  width: number;
}

export function timecodeLayout(videoWidth: number, videoHeight: number): TimecodeLayout {
  const cell = Math.max(8, Math.round(videoHeight / 45));
  return {
    cell,
    x: cell,
    y: videoHeight - 2 * cell,
    width: Math.min(TIMECODE_CELLS * cell, videoWidth - cell),
  };
}

/** Decodes cell values (true = white) into the timecode, or undefined if marker/parity fail. */
export function decodeTimecode(cells: readonly boolean[]): number | undefined {
  if (cells.length !== TIMECODE_CELLS || cells[0] !== true || cells[1] !== false) return undefined;
  let value = 0;
  let ones = 0;
  for (let bit = 0; bit < TIMECODE_BITS; bit++) {
    if (cells[2 + bit]) {
      value += 2 ** bit;
      ones++;
    }
  }
  const parity = cells[2 + TIMECODE_BITS] === true;
  return (ones % 2 === 1) === parity ? value : undefined;
}

/** Latency in ms between a decoded timecode and "now" (same clock), or undefined if implausible. */
export function timecodeLatency(timecode: number, nowMs: number): number | undefined {
  const diff = (((Math.round(nowMs) - timecode) % TIMECODE_MODULO) + TIMECODE_MODULO) % TIMECODE_MODULO;
  // More than ~2.3 h "late" means the clocks disagree (frame from the future).
  return diff < TIMECODE_MODULO / 2 ? diff : undefined;
}
