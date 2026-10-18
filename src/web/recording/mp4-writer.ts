/**
 * Writes one H.264 track into a plain (non-fragmented) MP4 file: ftyp, moov, mdat — the moov
 * in front ("fast start"), so every player can open and seek it (ISO/IEC 14496-12 and -15).
 * The samples are the FLV tags' AVCC payloads unchanged; nothing is decoded or re-encoded.
 *
 * Plain instead of fragmented MP4: the file is assembled only when the recording stops, so the
 * crash safety of fragments buys nothing, and some players (Windows, QuickTime) show no
 * duration or cannot seek in fragmented files.
 */

/** ArrayBuffer-backed bytes (what Blob accepts). */
type Bytes = Uint8Array<ArrayBuffer>;

export interface Mp4Track {
  /** AVCDecoderConfigurationRecord, as in the FLV sequence header. */
  avcConfig: Bytes;
  width: number;
  height: number;
}

export interface Mp4Sample {
  /** Length-prefixed NAL units (AVCC), as in an FLV coded-frame tag. */
  data: Bytes;
  /** In milliseconds (the track's timescale). */
  duration: number;
  /** Composition time offset (pts - dts) in milliseconds; 0 without B-frames. */
  compositionOffset: number;
  keyframe: boolean;
}

const TIMESCALE = 1000;
/** stco has 32-bit offsets; the recorder splits parts long before. */
const MAX_FILE_SIZE = 0xffff_ffff;

interface Chunk {
  samples: number;
  /** Offset of the chunk's first byte inside the mdat payload. */
  offset: number;
}

export class Mp4Writer {
  private readonly sizes: number[] = [];
  private readonly durations: number[] = [];
  private readonly offsets: number[] = [];
  private readonly keyframes: number[] = [];
  private readonly chunks: Chunk[] = [];
  /** Finished chunks as blobs, so the browser may keep large recordings out of memory. */
  private readonly chunkBlobs: Blob[] = [];
  private openChunk: Bytes[] = [];
  private payloadBytes = 0;
  private totalDuration = 0;

  constructor(readonly track: Mp4Track) {}

  get sampleCount(): number {
    return this.sizes.length;
  }

  /** Milliseconds of video written so far. */
  get duration(): number {
    return this.totalDuration;
  }

  /** Approximate file size so far (sample data; the boxes add well under 1 %). */
  get byteLength(): number {
    return this.payloadBytes;
  }

  /** Appends a sample. A keyframe starts a new chunk (one chunk per GOP). */
  addSample(sample: Mp4Sample): void {
    if (this.sizes.length === 0 && !sample.keyframe)
      throw new Error("an MP4 track must start with a keyframe");
    if (sample.keyframe) this.closeChunk();
    if (this.openChunk.length === 0) this.chunks.push({ samples: 0, offset: this.payloadBytes });
    const chunk = this.chunks[this.chunks.length - 1];
    if (chunk) chunk.samples++;
    if (sample.keyframe) this.keyframes.push(this.sizes.length + 1);
    this.sizes.push(sample.data.length);
    this.durations.push(sample.duration);
    this.offsets.push(sample.compositionOffset);
    this.openChunk.push(sample.data);
    this.payloadBytes += sample.data.length;
    this.totalDuration += sample.duration;
  }

  /** The complete file. The writer can still be read afterwards, but not extended. */
  finish(): Blob {
    this.closeChunk();
    const ftyp = fileType();
    // The chunk offsets depend on the moov size, which does not depend on their values.
    const moovSize = this.movie(0).length;
    const mdatStart = ftyp.length + moovSize + 8;
    if (mdatStart + this.payloadBytes > MAX_FILE_SIZE) throw new RangeError("MP4 part too large");
    const moov = this.movie(mdatStart);
    const mdatHeader = concat([u32(8 + this.payloadBytes), ascii("mdat")]);
    return new Blob([ftyp, moov, mdatHeader, ...this.chunkBlobs], { type: "video/mp4" });
  }

  private closeChunk(): void {
    if (this.openChunk.length === 0) return;
    this.chunkBlobs.push(new Blob(this.openChunk));
    this.openChunk = [];
  }

  private movie(mdatStart: number): Bytes {
    const { width, height, avcConfig } = this.track;
    const duration = this.totalDuration;
    const sampleTable = box(
      "stbl",
      fullBox("stsd", 0, 0, u32(1), visualSampleEntry(width, height, avcConfig)),
      timeToSample(this.durations),
      ...compositionOffsets(this.offsets),
      ...(this.keyframes.length < this.sizes.length ? [syncSamples(this.keyframes)] : []),
      sampleToChunk(this.chunks),
      fullBox("stsz", 0, 0, u32(0), u32(this.sizes.length), u32s(this.sizes)),
      fullBox("stco", 0, 0, u32(this.chunks.length), u32s(this.chunks.map((c) => mdatStart + c.offset))),
    );
    return box(
      "moov",
      fullBox(
        "mvhd",
        0,
        0,
        u32(0),
        u32(0),
        u32(TIMESCALE),
        u32(duration),
        u32(0x0001_0000),
        u16(0x0100),
        zeros(10),
        MATRIX,
        zeros(24),
        u32(2),
      ),
      box(
        "trak",
        fullBox(
          "tkhd",
          0,
          0x000003,
          u32(0),
          u32(0),
          u32(1),
          zeros(4),
          u32(duration),
          zeros(8),
          u16(0),
          u16(0),
          u16(0),
          zeros(2),
          MATRIX,
          u32(width * 0x1_0000),
          u32(height * 0x1_0000),
        ),
        box(
          "mdia",
          fullBox("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(LANGUAGE_UND), u16(0)),
          fullBox("hdlr", 0, 0, u32(0), ascii("vide"), zeros(12), ascii("VideoHandler\0")),
          box(
            "minf",
            fullBox("vmhd", 0, 1, zeros(8)),
            box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
            sampleTable,
          ),
        ),
      ),
    );
  }
}

/** ISO 639-2 "und", packed as three 5-bit letters. */
const LANGUAGE_UND = 0x55c4;
const MATRIX = u32s([0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000]);

function fileType(): Bytes {
  return box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));
}

function visualSampleEntry(width: number, height: number, avcConfig: Bytes): Bytes {
  return box(
    "avc1",
    zeros(6),
    u16(1), // data_reference_index
    zeros(16),
    u16(width),
    u16(height),
    u32(0x0048_0000), // 72 dpi
    u32(0x0048_0000),
    zeros(4),
    u16(1), // frame_count
    zeros(32), // compressorname
    u16(0x0018), // depth
    u16(0xffff), // pre_defined = -1
    box("avcC", avcConfig),
  );
}

/** stts: runs of equal durations. */
function timeToSample(durations: readonly number[]): Bytes {
  const runs = runLengths(durations);
  return fullBox("stts", 0, 0, u32(runs.length), u32s(runs.flatMap((r) => [r.count, r.value])));
}

/** ctts, only if any sample has an offset; version 1 allows negative offsets. */
function compositionOffsets(offsets: readonly number[]): Bytes[] {
  if (offsets.every((o) => o === 0)) return [];
  const runs = runLengths(offsets);
  const version = offsets.some((o) => o < 0) ? 1 : 0;
  return [fullBox("ctts", version, 0, u32(runs.length), u32s(runs.flatMap((r) => [r.count, r.value >>> 0])))];
}

function syncSamples(keyframes: readonly number[]): Bytes {
  return fullBox("stss", 0, 0, u32(keyframes.length), u32s(keyframes));
}

/** stsc: one entry whenever the number of samples per chunk changes. */
function sampleToChunk(chunks: readonly Chunk[]): Bytes {
  const entries: number[] = [];
  let previous = -1;
  chunks.forEach((chunk, index) => {
    if (chunk.samples === previous) return;
    entries.push(index + 1, chunk.samples, 1);
    previous = chunk.samples;
  });
  return fullBox("stsc", 0, 0, u32(entries.length / 3), u32s(entries));
}

function runLengths(values: readonly number[]): { count: number; value: number }[] {
  const runs: { count: number; value: number }[] = [];
  for (const value of values) {
    const last = runs[runs.length - 1];
    if (last && last.value === value) last.count++;
    else runs.push({ count: 1, value });
  }
  return runs;
}

// --- byte helpers ---

function box(type: string, ...content: Bytes[]): Bytes {
  const size = 8 + content.reduce((sum, part) => sum + part.length, 0);
  return concat([u32(size), ascii(type), ...content]);
}

function fullBox(type: string, version: number, flags: number, ...content: Bytes[]): Bytes {
  return box(type, u32(((version & 0xff) << 24) | (flags & 0xff_ffff)), ...content);
}

function concat(parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value: number): Bytes {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u32(value: number): Bytes {
  return u32s([value]);
}

function u32s(values: readonly number[]): Bytes {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0));
  return out;
}

function zeros(length: number): Bytes {
  return new Uint8Array(length);
}

function ascii(text: string): Bytes {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
