export const FlvTagType = {
  Audio: 8,
  Video: 9,
  Script: 18,
} as const;
export type FlvTagType = (typeof FlvTagType)[keyof typeof FlvTagType];

/** One FLV tag body with its type and timestamp. `data` is the tag body without the 11-byte tag header. */
export interface FlvTag {
  type: FlvTagType;
  /** Milliseconds, as received from the publisher (32-bit, wraps). */
  timestamp: number;
  data: Buffer;
}
