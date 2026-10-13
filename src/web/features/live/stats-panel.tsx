import { useEffect, useRef, useState } from "react";
import { LatencyMeter, ServiceClock, type LatencyStats } from "../../player/latency-meter";

interface StatsSample {
  latency: LatencyStats;
  bufferMs: number;
  rate: number;
  width: number;
  height: number;
  dropped: number | undefined;
  total: number | undefined;
}

const SAMPLE_MS = 500;
const CLOCK_SYNC_MS = 60_000;

function ms(value: number | undefined): string {
  return value === undefined ? "–" : `${Math.round(value)} ms`;
}

/**
 * Measurement panel (`?stats`): glass-to-glass latency from the simulator's timecode strip.
 * Self-contained: watches the frames of `video` itself. Also exposes the values as data-*
 * attributes on #stats for scripts/measure-latency.ts.
 */
export function StatsPanel({ video, playing }: { video: HTMLVideoElement; playing: boolean }) {
  const [sample, setSample] = useState<StatsSample>();
  const meterRef = useRef<LatencyMeter>(undefined);

  useEffect(() => {
    let active = true;
    const clock = new ServiceClock();
    const meter = new LatencyMeter(video, clock);
    meterRef.current = meter;

    const syncClock = () => {
      clock.sync().catch((err: unknown) => {
        if (active) console.warn("clock sync failed", err);
      });
    };
    syncClock();
    const syncTimer = window.setInterval(syncClock, CLOCK_SYNC_MS);

    let frameHandle: number | undefined;
    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (!active) return;
      meter.onFrame(metadata);
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    // Missing in older WebKit; the DOM typings assume it always exists.
    if (typeof video.requestVideoFrameCallback === "function") {
      frameHandle = video.requestVideoFrameCallback(onFrame);
    }

    const sampleTimer = window.setInterval(() => {
      const buffered = video.buffered.length
        ? video.buffered.end(video.buffered.length - 1) - video.currentTime
        : 0;
      const quality = video.getVideoPlaybackQuality?.();
      setSample({
        latency: meter.stats(),
        bufferMs: Math.round(buffered * 1000),
        rate: video.playbackRate,
        width: video.videoWidth,
        height: video.videoHeight,
        dropped: quality?.droppedVideoFrames,
        total: quality?.totalVideoFrames,
      });
    }, SAMPLE_MS);

    return () => {
      active = false;
      window.clearInterval(syncTimer);
      window.clearInterval(sampleTimer);
      if (frameHandle !== undefined) video.cancelVideoFrameCallback(frameHandle);
      meterRef.current = undefined;
    };
  }, [video]);

  // A new stream (camera switch, reconnect) starts a new measurement.
  useEffect(() => {
    if (!playing) meterRef.current?.reset();
  }, [playing]);

  if (!sample) return <div className="stats" id="stats" />;
  const { latency } = sample;
  return (
    <div
      className="stats"
      id="stats"
      data-latency-current={latency.current ?? ""}
      data-latency-avg={latency.avg ?? ""}
      data-latency-p95={latency.p95 ?? ""}
      data-latency-min={latency.min ?? ""}
      data-latency-max={latency.max ?? ""}
      data-samples={latency.samples}
      data-unreadable={latency.unreadable}
      data-buffer-ms={sample.bufferMs}
      data-dropped={sample.dropped ?? ""}
    >
      <dl>
        <dt>Latenz</dt>
        <dd>{ms(latency.current)}</dd>
        <dt>Ø / p95</dt>
        <dd>
          {ms(latency.avg)} / {ms(latency.p95)}
        </dd>
        <dt>min / max</dt>
        <dd>
          {ms(latency.min)} / {ms(latency.max)}
        </dd>
        <dt>Puffer</dt>
        <dd>{sample.bufferMs} ms</dd>
        <dt>Rate</dt>
        <dd>{sample.rate.toFixed(2)}×</dd>
        <dt>Auflösung</dt>
        <dd>
          {sample.width}×{sample.height}
        </dd>
        <dt>Verworfen</dt>
        <dd>
          {sample.dropped ?? "–"} / {sample.total ?? "–"}
        </dd>
        <dt>Messwerte</dt>
        <dd>
          {latency.samples} ({latency.unreadable} unlesbar)
        </dd>
      </dl>
    </div>
  );
}
