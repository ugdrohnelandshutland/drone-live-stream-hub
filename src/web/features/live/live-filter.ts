/**
 * "Nur live": the wall shows only drones that are live, so their pictures get more room. A
 * drone that loses its signal stays on the wall for GRACE_MS ("Kein Signal"), so a short radio
 * gap does not make the tiles jump around. Off by default; the choice is stored per device,
 * `?nurlive` switches it on for one page (kiosk).
 */
import { useEffect, useState } from "react";
import type { DroneStatus } from "../../../shared/api";
import { useStoredFlag } from "../../lib/use-stored-flag";

export const GRACE_MS = 30_000;
const STORAGE_KEY = "dlsh.liveOnly";

/** Whether a drone has a tile on the filtered wall at `now` (device time). */
export function isShown(drone: DroneStatus, lostAt: number | undefined, now: number): boolean {
  return drone.state === "live" || (lostAt !== undefined && now - lostAt < GRACE_MS);
}

/** The switch state: from `?nurlive`, else the device's stored choice. */
export function useLiveOnly(fromUrl: boolean): [boolean, (on: boolean) => void] {
  return useStoredFlag(STORAGE_KEY, false, fromUrl || undefined);
}

export interface FilteredWall {
  /** Drones with a tile, with their 1-based config position (kept: "Bild 3" stays 3). */
  shown: { drone: DroneStatus; slot: number }[];
  hidden: number;
}

/** Drones on the wall; re-renders by itself when a grace period runs out. */
export function useFilteredWall(
  drones: readonly DroneStatus[],
  lostAt: ReadonlyMap<string, number>,
  liveOnly: boolean,
): FilteredWall {
  const [now, setNow] = useState(() => Date.now());

  // The next moment a tile disappears; a timer then moves `now` past it. `now` only lags
  // behind, so a stale value keeps a tile a little longer, never hides one too early.
  const pending = liveOnly
    ? drones
        .filter((d) => d.state !== "live")
        .map((d) => lostAt.get(d.id))
        .filter((t): t is number => t !== undefined && now - t < GRACE_MS)
    : [];
  const nextExpiry = pending.length > 0 ? Math.min(...pending) + GRACE_MS : undefined;

  useEffect(() => {
    if (nextExpiry === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [nextExpiry]);

  const all = drones.map((drone, index) => ({ drone, slot: index + 1 }));
  if (!liveOnly) return { shown: all, hidden: 0 };
  const shown = all.filter(({ drone }) => isShown(drone, lostAt.get(drone.id), now));
  return { shown, hidden: all.length - shown.length };
}
