import { useEffect, useEffectEvent, useState } from "react";
import {
  LivePlayer,
  type LatencyTuning,
  type PlayerStatus,
  type StreamEvent,
  type StreamMode,
} from "./live-player";

export interface LivePlayerHookOptions {
  /** WebSocket URL of the stream; undefined keeps no player running. */
  url: string | undefined;
  mode?: StreamMode | undefined;
  tuning?: Partial<LatencyTuning> | undefined;
  onStatus?: ((status: PlayerStatus) => void) | undefined;
  /** Raw WebSocket events (recording). */
  onStreamEvent?: ((event: StreamEvent) => void) | undefined;
}

/**
 * Runs one LivePlayer on `video` while `url` is set and returns its status. The player is
 * recreated only when the element, the URL, the mode or the tuning changes — not when a callback does.
 */
export function useLivePlayer(
  video: HTMLVideoElement | null,
  { url, mode = "full", tuning, onStatus, onStreamEvent }: LivePlayerHookOptions,
): PlayerStatus {
  const [status, setStatus] = useState<PlayerStatus>("connecting");
  const reportStatus = useEffectEvent((next: PlayerStatus) => onStatus?.(next));
  const reportStreamEvent = useEffectEvent((event: StreamEvent) => onStreamEvent?.(event));

  // Compare by value: callers usually build the tuning object during render.
  const tuningKey = JSON.stringify(tuning ?? {});

  useEffect(() => {
    if (!url || !video) return;
    const player = new LivePlayer({
      video,
      url,
      mode,
      tuning: JSON.parse(tuningKey) as Partial<LatencyTuning>,
      onStatus: (next) => {
        setStatus(next);
        reportStatus(next);
      },
      onStreamEvent: reportStreamEvent,
    });
    player.start();
    return () => {
      player.destroy();
      // The next player starts from "connecting"; tell the caller too.
      setStatus("connecting");
      reportStatus("connecting");
    };
  }, [video, url, mode, tuningKey]);

  return status;
}
