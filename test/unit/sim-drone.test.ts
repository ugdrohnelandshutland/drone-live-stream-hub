import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, overlayText, type DroneStreamOptions } from "../../src/sim/drone.js";
import { parseFfmpegMajor, quoteFilterPath } from "../../src/sim/ffmpeg.js";
import { PROFILES, colourForIndex, resolutionFor } from "../../src/sim/profiles.js";

const profile = PROFILES["1080p30"]!;
const base: DroneStreamOptions = {
  id: "m30t-01",
  output: "rtmp://127.0.0.1:1935/live/m30t-01",
  profile,
  camera: "wide",
  colour: colourForIndex(0),
  fontFile: "/fonts/mono.ttf",
  overlayTextFile: "/tmp/m30t-01-wide.txt",
  audio: false,
};

function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("buildFfmpegArgs", () => {
  it("pushes H.264 High without B-frames to the RTMP URL, video only", () => {
    const args = buildFfmpegArgs(base);
    expect(args.at(-1)).toBe(base.output);
    expect(argAfter(args, "-f")).toBe("flv");
    expect(argAfter(args, "-c:v")).toBe("libx264");
    expect(argAfter(args, "-profile:v")).toBe("high");
    expect(argAfter(args, "-bf")).toBe("0");
    expect(argAfter(args, "-g")).toBe("60");
    expect(argAfter(args, "-b:v")).toBe("6000k");
    expect(args).toContain("-an");
  });

  it("uses the camera resolution", () => {
    expect(argAfter(buildFfmpegArgs(base), "-filter_complex")).toContain("s=1920x1080");
    expect(argAfter(buildFfmpegArgs({ ...base, camera: "thermal" }), "-filter_complex")).toContain(
      "s=640x512",
    );
    expect(resolutionFor(profile, "zoom")).toEqual({ width: 1280, height: 720 });
  });

  it("stamps wall-clock time into the frames and restores constant frame timing", () => {
    const graph = argAfter(buildFfmpegArgs(base), "-filter_complex") ?? "";
    expect(graph).toMatch(/realtime,settb=1\/1000,setpts=RTCTIME\/1000,.*drawtext=.*setpts=N\/30\/TB/);
  });

  it("adds an AAC track on request", () => {
    const args = buildFfmpegArgs({ ...base, audio: true });
    expect(argAfter(args, "-c:a")).toBe("aac");
    expect(args).not.toContain("-an");
  });

  it("loops a source file instead of the test pattern", () => {
    const args = buildFfmpegArgs({ ...base, source: "clip.mp4" });
    expect(argAfter(args, "-i")).toBe("clip.mp4");
    expect(args).toContain("-stream_loop");
    expect(argAfter(args, "-filter_complex")).not.toContain("testsrc2");
  });
});

describe("overlayText", () => {
  it("contains id, camera, size, frame counter and a millisecond clock", () => {
    const text = overlayText("m30t-01", "zoom", 1280, 720);
    expect(text).toContain("M30T-01   ZOOM   1280x720");
    expect(text).toContain("%{frame_num}");
    expect(text).toContain("%{eif:mod(floor(t*1000),1000):d:3}");
  });
});

describe("quoteFilterPath", () => {
  it("escapes drive-letter colons and quotes", () => {
    expect(quoteFilterPath("C:/Windows/Fonts/arial.ttf")).toBe("'C\\:/Windows/Fonts/arial.ttf'");
    expect(quoteFilterPath("/tmp/it's.txt")).toBe("'/tmp/it'\\''s.txt'");
  });
});

describe("parseFfmpegMajor", () => {
  it.each([
    ["ffmpeg version n8.1.3-16-ge0a878dd70-20261009 Copyright (c) 2000-2026", 8],
    ["ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021", 4],
    ["ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024", 7],
    ["ffmpeg version N-117000-g1234abcd Copyright", undefined],
  ])("parses %j", (line, major) => {
    expect(parseFfmpegMajor(line)).toBe(major);
  });
});
