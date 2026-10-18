import type { DroneVideoInfo } from "../../shared/api.js";
import { parseAvcDecoderConfig } from "../../shared/flv/avc.js";
import { parseVideoTag } from "../../shared/flv/video.js";

/**
 * Codec info from a video sequence header tag body, or undefined if `data` is not one.
 * Resolution is parsed for H.264; for other codecs only the codec name is known.
 */
export function describeSequenceHeader(data: Buffer): DroneVideoInfo | undefined {
  const info = parseVideoTag(data);
  if (info?.packetType !== "sequence-header") return undefined;
  if (info.codec !== "avc") return { codec: info.codec };
  try {
    const avc = parseAvcDecoderConfig(data.subarray(info.payloadOffset));
    return { codec: "avc", codecString: avc.codecString, width: avc.width, height: avc.height };
  } catch {
    return { codec: "avc" };
  }
}
