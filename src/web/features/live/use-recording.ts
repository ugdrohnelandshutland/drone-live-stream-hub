import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { downloadBlob } from "../../lib/download";
import { recordingFileName } from "../../lib/format";
import type { StreamEvent } from "../../player/live-player";
import { StreamRecorder, type RecorderProgress, type RecordingPart } from "../../recording/stream-recorder";
import { t } from "../../strings";

export interface Recording extends RecorderProgress {
  start(): void;
  stop(): void;
  /** Feed for the drone's player (LiveVideo onStreamEvent). */
  onStreamEvent(event: StreamEvent): void;
}

const PROGRESS_INTERVAL_MS = 500;

/**
 * Video recording of one drone in the browser (ADR 0011). The recorder always reads along, so
 * it knows the current sequence header when the user presses "Aufnahme". Every finished part
 * is downloaded at once. The recording ends when `enabled` turns false (back to the wall), the
 * monitor unmounts, or the page is hidden (screen locked, other app): the device may suspend
 * the page, and with it the recording, at any moment then.
 */
export function useRecording(droneId: string, enabled: boolean, notify: (text: string) => void): Recording {
  const [recorder] = useState(() => new StreamRecorder());
  const [progress, setProgress] = useState<RecorderProgress>(() => recorder.progress());
  const startedAt = useRef(new Date());

  const savePart = useEffectEvent((part: RecordingPart) => {
    downloadBlob(part.blob, recordingFileName(droneId, startedAt.current, part.index));
    notify(part.reason === "stopped" ? t.single.recordSaved : t.single.recordPartSaved(part.index));
  });
  const reportUnsupported = useEffectEvent(() => notify(t.single.recordUnsupported));

  useEffect(() => {
    recorder.setListener({
      onPart: (part) => savePart(part),
      onUnsupported: () => reportUnsupported(),
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") recorder.stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      recorder.stop();
      recorder.setListener(undefined);
    };
  }, [recorder]);

  useEffect(() => {
    if (!enabled) recorder.stop();
  }, [enabled, recorder]);

  // While recording, refresh time and size; the last tick also picks up a stop from outside.
  const recording = progress.state !== "idle";
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setProgress(recorder.progress()), PROGRESS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [recording, recorder]);

  const start = useCallback(() => {
    startedAt.current = new Date();
    recorder.start();
    setProgress(recorder.progress());
  }, [recorder]);

  const stop = useCallback(() => {
    recorder.stop();
    setProgress(recorder.progress());
  }, [recorder]);

  const onStreamEvent = useCallback((event: StreamEvent) => recorder.handle(event), [recorder]);

  return { ...progress, start, stop, onStreamEvent };
}
