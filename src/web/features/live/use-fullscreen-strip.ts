/**
 * Fullscreen shows only the picture: the strip slides away. It comes back on a tap or click
 * on the picture (and hides again after HIDE_AFTER_MS, or on the next tap) and while the mouse
 * is in the top area where the strip sits. Mouse moves elsewhere and keys leave it hidden.
 */
import { useCallback, useEffect, useState, type RefObject } from "react";

export const HIDE_AFTER_MS = 4000;

/** Whether the element behind `ref` is the fullscreen element. */
export function useIsFullscreen(ref: RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);
  return active;
}

export interface FullscreenStrip {
  /** True while fullscreen and the strip is out of the way. */
  hidden: boolean;
  /** A tap on the picture: show the strip, or hide it if it is shown. */
  toggle: () => void;
  /** Input on the strip itself (a button): keep it shown, restart the hide timer. */
  keep: () => void;
  /** The mouse is (true) or is no longer (false) in the top area of the strip. */
  hover: (inTopArea: boolean) => void;
}

export function useFullscreenStrip(fullscreen: boolean): FullscreenStrip {
  const [tapped, setTapped] = useState(false);
  /** Counts uses of the strip, to restart the hide timer. */
  const [uses, setUses] = useState(0);
  const [hovering, setHovering] = useState(false);

  // Entering or leaving fullscreen starts with the strip hidden (state adjusted during render).
  const [wasFullscreen, setWasFullscreen] = useState(fullscreen);
  if (wasFullscreen !== fullscreen) {
    setWasFullscreen(fullscreen);
    setTapped(false);
    setHovering(false);
  }

  const shown = tapped || hovering;

  const keep = useCallback(() => {
    setTapped(true);
    setUses((n) => n + 1);
  }, []);

  const toggle = useCallback(() => {
    if (shown) {
      setTapped(false);
      setHovering(false);
    } else {
      keep();
    }
  }, [shown, keep]);

  // Same value again does not re-render, so this can be called on every mouse move.
  const hover = useCallback((inTopArea: boolean) => setHovering(inTopArea), []);

  useEffect(() => {
    if (!fullscreen || !tapped || hovering) return;
    const timer = window.setTimeout(() => setTapped(false), HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [fullscreen, tapped, hovering, uses]);

  return { hidden: fullscreen && !shown, toggle, keep, hover };
}
