/**
 * Structure check of the NAL units inside an AVC/HEVC coded frame (ISO/IEC 14496-15: each NAL
 * unit is prefixed with its length in `lengthSize` bytes). Only reports what is wrong; the
 * service still forwards the frame unchanged.
 */

/**
 * - `zero-length`: a length field of 0.
 * - `overrun`: a length larger than the rest of the frame.
 * - `trailing-bytes`: fewer bytes left than a length field needs.
 * - `start-code`: the frame starts with an Annex B start code (00 00 00 01) instead of a length.
 */
export type NalProblem = "zero-length" | "overrun" | "trailing-bytes" | "start-code";

export const NAL_PROBLEMS: readonly NalProblem[] = ["zero-length", "overrun", "trailing-bytes", "start-code"];

export interface NalCheck {
  /** NAL units read before the problem (all of them if there is none). */
  units: number;
  problem?: NalProblem;
  /** Offset of the bad length field inside the payload. */
  offset?: number;
}

/**
 * Size of the NAL length fields from the decoder configuration record (the sequence header
 * payload), or undefined if the record is too short or not version 1.
 */
export function nalLengthSize(config: Uint8Array, codec: "avc" | "hevc"): number | undefined {
  if (config[0] !== 1) return undefined;
  // AVC: lengthSizeMinusOne in byte 4; HEVC: in byte 21 (after the 22-byte fixed header part).
  const byte = codec === "avc" ? config[4] : config.length >= 23 ? config[21] : undefined;
  if (byte === undefined) return undefined;
  const size = (byte & 0x03) + 1;
  return size === 3 ? undefined : size;
}

export function checkNalUnits(payload: Uint8Array, lengthSize: number): NalCheck {
  if (
    lengthSize === 4 &&
    payload.length >= 5 &&
    payload[0] === 0 &&
    payload[1] === 0 &&
    payload[2] === 0 &&
    payload[3] === 1
  ) {
    return { units: 0, problem: "start-code", offset: 0 };
  }
  let offset = 0;
  let units = 0;
  while (offset < payload.length) {
    if (payload.length - offset < lengthSize) return { units, problem: "trailing-bytes", offset };
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = length * 256 + (payload[offset + i] ?? 0);
    if (length === 0) return { units, problem: "zero-length", offset };
    if (length > payload.length - offset - lengthSize) return { units, problem: "overrun", offset };
    offset += lengthSize + length;
    units++;
  }
  return { units };
}
