import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { DroneStatus } from "../../../shared/api";
import { DroneStrip } from "../../components/drone-strip";
import { BackIcon, CameraIcon, RecordIcon, StopIcon } from "../../components/icons";
import { PictureOverlay } from "../../components/picture-overlay";
import { Toast, useToast } from "../../components/toast";
import { downloadBlob } from "../../lib/download";
import {
  droneFacts,
  formatFileSize,
  formatRecordingTime,
  snapshotCaption,
  snapshotFileName,
} from "../../lib/format";
import { captureSnapshot } from "../../lib/snapshot";
import { navigateOnClick } from "../../navigation";
import type { PlayerStatus } from "../../player/live-player";
import { LiveVideo } from "../../player/live-video";
import {
  describeStatus,
  LIVE_WITHOUT_PREVIEW,
  offlineView,
  pausedView,
  type StatusView,
} from "../../player/player-status";
import { useSettledStatus } from "../../player/use-settled-status";
import { droneHref, overviewHref, type PageOptions } from "../../routes";
import { liveStreamUrl } from "../../service/http";
import { t } from "../../strings";
import { FullscreenButton } from "./fullscreen-button";
import { useFullscreenStrip, useIsFullscreen } from "./use-fullscreen-strip";
import { StatsPanel } from "./stats-panel";
import { useRecording, type Recording } from "./use-recording";
import "./recording.css";

interface DroneMonitorProps {
  drone: DroneStatus;
  /** Position in the config; undefined while the list is still loading. */
  slot: number | undefined;
  /** Shown alone and large (single view) instead of as a tile of the wall. */
  focused: boolean;
  /** "Datensparen": as a tile, play only keyframes (ADR 0009). */
  dataSaver: boolean;
  /** An admin paused this device (ADR 0012): no player, a notice instead of the picture. */
  paused: boolean;
  options: PageOptions;
}

/**
 * One drone: picture plus label strip. The same component — and so the same <video>, player
 * and WebSocket — is a tile of the wall and, focused, the single view. Switching between the
 * two changes the layout and the controls, never the elements above the video, so the
 * picture keeps running without a reconnect. With "Datensparen" the stream itself changes
 * (keyframes as a tile, full when focused), so the player is rebuilt on the same element.
 */
export function DroneMonitor({ drone, slot, focused, dataSaver, paused, options }: DroneMonitorProps) {
  const rootRef = useRef<HTMLLIElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>("connecting");
  const status = useSettledStatus(playerStatus);
  const [toast, showToast] = useToast();
  const live = drone.state === "live";
  useExitFullscreenWhenUnfocused(rootRef, focused);
  const fullscreen = useIsFullscreen(rootRef) && focused;
  const strip = useFullscreenStrip(fullscreen);
  // No file handling on the fixed kiosk touchscreen.
  const files = focused && !options.kiosk;
  const recording = useRecording(drone.id, files, showToast);

  // Focused: always connected — the server holds the socket until the drone is up, so the
  // picture appears the moment it is. Tiles connect only while the drone is live.
  const runPlayer = !paused && (focused || (live && options.previews));
  const mode = !focused && dataSaver ? "keyframes" : "full";
  const view = paused
    ? pausedView()
    : monitorView({ live, focused, previews: options.previews, status, droneId: drone.id });

  return (
    <li
      className="monitor"
      ref={rootRef}
      data-tone={view.tone}
      data-focused={focused || undefined}
      data-fullscreen={fullscreen || undefined}
      {...(fullscreen && {
        // A tap on the picture shows or hides the strip; using the strip keeps it shown.
        onClick: (event) => {
          const onStrip = (event.target as Element).closest(".strip");
          if (onStrip) strip.keep();
          else strip.toggle();
        },
        // Mouse or pen in the top area (as high as the strip) shows it; elsewhere it stays away.
        onPointerMove: (event) => {
          if (event.pointerType === "touch") return;
          const height = event.currentTarget.querySelector<HTMLElement>(".strip")?.offsetHeight ?? 0;
          strip.hover(event.clientY - event.currentTarget.getBoundingClientRect().top <= height);
        },
        onPointerLeave: () => strip.hover(false),
      })}
    >
      <div className="monitor-picture">
        <LiveVideo
          ref={setVideo}
          url={runPlayer ? liveStreamUrl(drone.id, mode) : undefined}
          mode={mode}
          tuning={options.tuning}
          onStatus={setPlayerStatus}
          onStreamEvent={recording.onStreamEvent}
        />
        <PictureOverlay view={view} />
        {files && recording.state !== "idle" && <RecordingIndicator recording={recording} />}
        {focused && options.stats && video && (
          <StatsPanel video={video} playing={playerStatus === "playing"} />
        )}
        {focused && <Toast toast={toast} />}
      </div>
      <DroneStrip
        slot={slot}
        name={drone.name}
        view={view}
        state={status}
        facts={droneFacts(drone)}
        hidden={strip.hidden}
        {...(focused
          ? {
              leading: !options.kiosk && <BackLink />,
              actions: (
                <>
                  {files && (
                    <>
                      <SnapshotButton
                        video={video}
                        drone={drone}
                        enabled={status === "playing"}
                        onDone={showToast}
                      />
                      <RecordButton recording={recording} enabled={status === "playing"} />
                    </>
                  )}
                  <FullscreenButton target={rootRef} active={fullscreen} />
                </>
              ),
            }
          : {})}
      />
      {/* The whole tile is the link: a sibling, so the picture never changes its parent. */}
      {!focused && (
        <a
          className="monitor-open"
          href={droneHref(drone.id)}
          aria-label={t.overview.open(drone.name)}
          onClick={navigateOnClick}
        />
      )}
    </li>
  );
}

/**
 * Fullscreen belongs to the single view. The monitor element outlives the switch back to the
 * wall (that keeps the picture running), so it would otherwise stay fullscreen — alone, in the
 * wall layout. Runs before paint, so that layout never flashes. Covers the back button, the
 * browser's back and swipe alike.
 */
function useExitFullscreenWhenUnfocused(rootRef: RefObject<HTMLLIElement | null>, focused: boolean) {
  useLayoutEffect(() => {
    if (focused) return;
    const element = document.fullscreenElement;
    if (element && rootRef.current?.contains(element)) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [rootRef, focused]);
}

function monitorView(input: {
  live: boolean;
  focused: boolean;
  previews: boolean;
  status: PlayerStatus;
  droneId: string;
}): StatusView {
  const { live, focused, previews, status, droneId } = input;
  if (status === "playing") return describeStatus(status, droneId);
  // Same wording in both layouts while the registry reports the drone offline.
  if (!live) return offlineView(focused ? "Warte auf die Drohne …" : "");
  if (!focused && !previews) return LIVE_WITHOUT_PREVIEW;
  return describeStatus(status, droneId);
}

export function BackLink() {
  return (
    <a className="button strip-button strip-back" href={overviewHref} onClick={navigateOnClick}>
      <BackIcon />
      <span className="button-label">{t.single.back}</span>
    </a>
  );
}

function SnapshotButton(props: {
  video: HTMLVideoElement | null;
  drone: DroneStatus;
  enabled: boolean;
  onDone: (message: string) => void;
}) {
  const { video, drone, enabled, onDone } = props;
  const save = () => {
    if (!video) return;
    const now = new Date();
    captureSnapshot(video, snapshotCaption(drone.name, drone.id, now))
      .then((blob) => {
        downloadBlob(blob, snapshotFileName(drone.id, now));
        onDone(t.single.snapshotSaved);
      })
      .catch((err: unknown) => {
        console.warn("snapshot failed", { droneId: drone.id, err });
        onDone(t.single.snapshotFailed);
      });
  };
  return (
    <button type="button" className="strip-button" disabled={!enabled} onClick={save}>
      <CameraIcon />
      <span className="button-label">{t.single.snapshot}</span>
    </button>
  );
}

/** Start needs a picture; a running recording can always be stopped. */
function RecordButton({ recording, enabled }: { recording: Recording; enabled: boolean }) {
  const active = recording.state !== "idle";
  return (
    <button
      type="button"
      className="strip-button record-button"
      data-recording={active || undefined}
      aria-pressed={active}
      disabled={!active && !enabled}
      onClick={active ? recording.stop : recording.start}
    >
      {active ? <StopIcon /> : <RecordIcon />}
      <span className="button-label">{active ? t.single.recordStop : t.single.record}</span>
    </button>
  );
}

function RecordingIndicator({ recording }: { recording: Recording }) {
  const text =
    recording.state === "waiting"
      ? t.single.recordWaiting
      : t.single.recordRunning(formatRecordingTime(recording.durationMs), formatFileSize(recording.bytes));
  return (
    <div className="recording-indicator" data-state={recording.state}>
      <span className="recording-dot" aria-hidden="true" />
      {text}
    </div>
  );
}
