import { useEffect, useState } from "react";
import type { PlayerStatus } from "./live-player";
import { describeStatus } from "./player-status";

/** Short interruptions (camera switch, reconnect) should not flash "Kein Signal". */
export const SETTLE_MS = 1000;

/**
 * The status as the UI should show it: "playing" and permanent conditions apply at once, any
 * other status only once it has lasted `delayMs`. Badge and overlay both use this, so they
 * always agree.
 */
export function useSettledStatus(status: PlayerStatus, delayMs = SETTLE_MS): PlayerStatus {
  const [settled, setSettled] = useState(status);
  const immediate = describeStatus(status, "").immediate;

  // Adjusted during render rather than in an effect, so "Live" never lags one frame behind.
  if (immediate && settled !== status) setSettled(status);

  useEffect(() => {
    if (immediate || settled === status) return;
    const timer = window.setTimeout(() => setSettled(status), delayMs);
    return () => window.clearTimeout(timer);
  }, [status, settled, immediate, delayMs]);

  return settled;
}
