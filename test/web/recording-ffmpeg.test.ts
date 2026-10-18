/// <reference types="node" />
/**
 * Recording end to end with real H.264: ffmpeg encodes FLV like the simulator's Pilot 2
 * profile, the recorder turns it into MP4, ffprobe and a full decode check the files.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/close-codes";
import { ffmpegBinary, probeFfmpeg } from "../../src/sim/ffmpeg";
import { StreamRecorder, type RecordingPart } from "../../src/web/recording/stream-recorder";

const ffmpeg = ffmpegBinary();
const ffprobe = process.env["FFMPEG_PATH"]
  ? path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/ffmpeg/i, "ffprobe"))
  : "ffprobe";
const skipReason =
  (await probeFfmpeg(ffmpeg)) === undefined
    ? `ffmpeg not found (${ffmpeg})`
    : await run(ffprobe, ["-version"]).then(
        () => "",
        () => `ffprobe not found (${ffprobe})`,
      );
// CI sets REQUIRE_FFMPEG=1: fail instead of skipping (as src/sim/ffmpeg.ts does).
if (skipReason && process.env["REQUIRE_FFMPEG"] === "1")
  throw new Error(`ffmpeg prerequisites missing: ${skipReason}`);
if (skipReason) console.warn(`Skipping recording test with ffmpeg: ${skipReason}`);

function run(binary: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${binary} failed: ${stderr.toString()}`));
        else resolve({ stdout, stderr: stderr.toString() });
      },
    );
  });
}

/** FLV with H.264 High, no B-frames, keyframe every second (simulator profile). */
async function encodeFlv(size: string, seconds: number): Promise<Buffer> {
  const { stdout } = await run(ffmpeg, [
    ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30`],
    ...["-t", String(seconds), "-c:v", "libx264", "-profile:v", "high", "-bf", "0", "-g", "30"],
    ...["-pix_fmt", "yuv420p", "-f", "flv", "pipe:1"],
  ]);
  return stdout;
}

interface Probe {
  width: number;
  height: number;
  codec: string;
  frames: number;
  duration: number;
}

async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(ffprobe, [
    ...["-v", "error", "-count_frames", "-select_streams", "v:0"],
    ...[
      "-show_entries",
      "stream=codec_name,width,height,nb_read_frames:format=duration",
      "-of",
      "json",
      file,
    ],
  ]);
  const json = JSON.parse(stdout.toString()) as {
    streams: { codec_name: string; width: number; height: number; nb_read_frames: string }[];
    format: { duration: string };
  };
  const stream = json.streams[0]!;
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_read_frames),
    duration: Number(json.format.duration),
  };
}

/** Feeds the bytes in WebSocket-like chunks that do not respect tag boundaries. */
function feed(recorder: StreamRecorder, bytes: Buffer): void {
  recorder.handle({ type: "open" });
  for (let offset = 0; offset < bytes.length; offset += 50_000) {
    const chunk = bytes.subarray(offset, offset + 50_000);
    recorder.handle({ type: "data", chunk: new Uint8Array(chunk).buffer });
  }
}

describe.skipIf(skipReason !== "")("recording real H.264 to MP4", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dlsh-recording-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes playable files, one per camera, with every frame", async () => {
    const [wide, thermal] = await Promise.all([encodeFlv("1280x720", 4), encodeFlv("640x512", 2)]);
    const recorder = new StreamRecorder();
    const parts: RecordingPart[] = [];
    recorder.setListener({ onPart: (part) => parts.push(part), onUnsupported: () => undefined });

    recorder.start();
    feed(recorder, wide);
    recorder.handle({ type: "close", code: CloseCode.StreamReset });
    feed(recorder, thermal);
    recorder.stop();

    expect(parts.map((p) => p.reason)).toEqual(["camera-switch", "stopped"]);
    const files = await Promise.all(
      parts.map(async (part) => {
        const file = path.join(dir, `part${part.index}.mp4`);
        await writeFile(file, new Uint8Array(await part.blob.arrayBuffer()));
        return file;
      }),
    );

    const [first, second] = await Promise.all(files.map(probe));
    expect(first).toMatchObject({ codec: "h264", width: 1280, height: 720, frames: 120 });
    expect(first!.duration).toBeCloseTo(4, 1);
    expect(second).toMatchObject({ codec: "h264", width: 640, height: 512, frames: 60 });
    expect(second!.duration).toBeCloseTo(2, 1);

    // A full decode reports no errors.
    for (const file of files) {
      const { stderr } = await run(ffmpeg, ["-hide_banner", "-v", "error", "-i", file, "-f", "null", "-"]);
      expect(stderr).toBe("");
    }
  });
});
