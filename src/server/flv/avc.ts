/**
 * H.264 decoder configuration record and SPS parsing (ISO/IEC 14496-15, ITU-T H.264 7.3.2.1).
 * Only what we need to report codec info: profile, level and coded picture size.
 */

export interface AvcConfig {
  profileIdc: number;
  levelIdc: number;
  /** RFC 6381 codec string, e.g. "avc1.640028". */
  codecString: string;
  width: number;
  height: number;
}

class BitReader {
  private bitOffset = 0;
  constructor(private readonly data: Buffer) {}

  readBit(): number {
    const byte = this.data[this.bitOffset >> 3];
    if (byte === undefined) throw new RangeError("SPS truncated");
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset++;
    return bit;
  }

  readBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 2 + this.readBit();
    return value;
  }

  readUe(): number {
    let leadingZeros = 0;
    while (this.readBit() === 0) {
      if (++leadingZeros > 31) throw new RangeError("invalid Exp-Golomb code");
    }
    return 2 ** leadingZeros - 1 + this.readBits(leadingZeros);
  }

  readSe(): number {
    const k = this.readUe();
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

/** Removes emulation prevention bytes (00 00 03 → 00 00). */
export function unescapeRbsp(nal: Buffer): Buffer {
  const out = Buffer.allocUnsafe(nal.length);
  let length = 0;
  let zeros = 0;
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out[length++] = byte;
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, length);
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(reader: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let i = 0; i < size; i++) {
    if (next !== 0) next = (last + reader.readSe() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

/** Parses an SPS NAL unit (including its 1-byte NAL header) and returns the cropped picture size. */
export function parseSps(nal: Buffer): {
  profileIdc: number;
  levelIdc: number;
  width: number;
  height: number;
} {
  const reader = new BitReader(unescapeRbsp(nal.subarray(1)));
  const profileIdc = reader.readBits(8);
  reader.readBits(8); // constraint flags + reserved
  const levelIdc = reader.readBits(8);
  reader.readUe(); // seq_parameter_set_id

  let chromaFormatIdc = 1;
  let separateColourPlane = 0;
  if (HIGH_PROFILES.has(profileIdc)) {
    chromaFormatIdc = reader.readUe();
    if (chromaFormatIdc === 3) separateColourPlane = reader.readBit();
    reader.readUe(); // bit_depth_luma_minus8
    reader.readUe(); // bit_depth_chroma_minus8
    reader.readBit(); // qpprime_y_zero_transform_bypass_flag
    if (reader.readBit()) {
      const count = chromaFormatIdc === 3 ? 12 : 8;
      for (let i = 0; i < count; i++) {
        if (reader.readBit()) skipScalingList(reader, i < 6 ? 16 : 64);
      }
    }
  }

  reader.readUe(); // log2_max_frame_num_minus4
  const picOrderCntType = reader.readUe();
  if (picOrderCntType === 0) {
    reader.readUe();
  } else if (picOrderCntType === 1) {
    reader.readBit();
    reader.readSe();
    reader.readSe();
    const cycles = reader.readUe();
    for (let i = 0; i < cycles; i++) reader.readSe();
  }
  reader.readUe(); // max_num_ref_frames
  reader.readBit(); // gaps_in_frame_num_value_allowed_flag
  const picWidthInMbs = reader.readUe() + 1;
  const picHeightInMapUnits = reader.readUe() + 1;
  const frameMbsOnly = reader.readBit();
  if (!frameMbsOnly) reader.readBit(); // mb_adaptive_frame_field_flag
  reader.readBit(); // direct_8x8_inference_flag

  let cropLeft = 0;
  let cropRight = 0;
  let cropTop = 0;
  let cropBottom = 0;
  if (reader.readBit()) {
    cropLeft = reader.readUe();
    cropRight = reader.readUe();
    cropTop = reader.readUe();
    cropBottom = reader.readUe();
  }

  const chromaArrayType = separateColourPlane ? 0 : chromaFormatIdc;
  const subWidthC = chromaArrayType === 1 || chromaArrayType === 2 ? 2 : 1;
  const subHeightC = chromaArrayType === 1 ? 2 : 1;
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC;
  const cropUnitY = (chromaArrayType === 0 ? 1 : subHeightC) * (2 - frameMbsOnly);

  const width = picWidthInMbs * 16 - cropUnitX * (cropLeft + cropRight);
  const height = (2 - frameMbsOnly) * picHeightInMapUnits * 16 - cropUnitY * (cropTop + cropBottom);
  return { profileIdc, levelIdc, width, height };
}

/** Parses an AVCDecoderConfigurationRecord (the payload of an AVC sequence header tag). */
export function parseAvcDecoderConfig(record: Buffer): AvcConfig {
  if (record.length < 7 || record[0] !== 1) throw new RangeError("invalid AVCDecoderConfigurationRecord");
  const numSps = (record[5] ?? 0) & 0x1f;
  if (numSps < 1) throw new RangeError("AVCDecoderConfigurationRecord without SPS");
  const spsLength = record.readUInt16BE(6);
  const sps = record.subarray(8, 8 + spsLength);
  if (sps.length !== spsLength) throw new RangeError("AVCDecoderConfigurationRecord truncated");
  const parsed = parseSps(sps);
  const codecString = `avc1.${sps.subarray(1, 4).toString("hex")}`;
  return { ...parsed, codecString };
}

const AVC_PROFILES: Record<number, string> = {
  66: "Baseline",
  77: "Main",
  88: "Extended",
  100: "High",
  110: "High 10",
  122: "High 4:2:2",
  244: "High 4:4:4",
};

/** "High", or "profile 123" for unknown values. */
export function avcProfileName(profileIdc: number): string {
  return AVC_PROFILES[profileIdc] ?? `profile ${profileIdc}`;
}

/** level_idc 40 → "4.0", 31 → "3.1". */
export function avcLevelName(levelIdc: number): string {
  return (levelIdc / 10).toFixed(1);
}
