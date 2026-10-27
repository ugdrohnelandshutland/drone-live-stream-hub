import { useCallback, useState, type Ref } from "react";
import type { LatencyTuning, PlayerStatus, StreamEvent, StreamMode } from "./live-player";
import { useLivePlayer } from "./use-live-player";

interface LiveVideoProps {
  /** WebSocket URL of the stream; undefined shows no picture and runs no player. */
  url: string | undefined;
  /** Must match the URL: "keyframes" for a `?keyframes=1` stream. */
  mode?: StreamMode | undefined;
  tuning?: Partial<LatencyTuning> | undefined;
  /** The hub reports that the drone sends no video (DroneStatus.stalledSince). */
  sourceStalled?: boolean | undefined;
  onStatus: (status: PlayerStatus) => void;
  /** Raw WebSocket events of the player (recording). */
  onStreamEvent?: ((event: StreamEvent) => void) | undefined;
  /** The <video> element, for callers that read frames from it (still image, stats). */
  ref?: Ref<HTMLVideoElement>;
  className?: string;
}

/**
 * A muted live <video> with its own player. Owning the element here keeps element and player
 * in step: a new element always gets a new player.
 */
export function LiveVideo(props: LiveVideoProps) {
  const { url, mode, tuning, sourceStalled, onStatus, onStreamEvent, ref, className } = props;
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  useLivePlayer(video, { url, mode, tuning, sourceStalled, onStatus, onStreamEvent });

  const attach = useCallback(
    (node: HTMLVideoElement | null) => {
      setVideo(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return <video ref={attach} className={className} muted playsInline autoPlay />;
}
