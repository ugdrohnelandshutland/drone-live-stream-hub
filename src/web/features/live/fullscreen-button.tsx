import type { RefObject } from "react";
import { FullscreenIcon } from "../../components/icons";
import { t } from "../../strings";

/**
 * The whole monitor goes fullscreen; there the strip hides until the picture is tapped
 * (use-fullscreen-strip.ts). `active`: the monitor is fullscreen right now.
 */
export function FullscreenButton({
  target,
  active,
}: {
  target: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  // iPhone: no Fullscreen API for elements other than <video> (iPad has it since iPadOS 16.4).
  if (!document.fullscreenEnabled) return null;

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.current?.requestFullscreen().catch(() => undefined);
  };
  const label = active ? t.single.fullscreenExit : t.single.fullscreen;
  return (
    <button type="button" className="strip-button" onClick={toggle} aria-label={label}>
      <FullscreenIcon exit={active} />
      <span className="button-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
