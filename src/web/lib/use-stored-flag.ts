import { useState } from "react";

function readStored(key: string): boolean | undefined {
  try {
    const value = localStorage.getItem(key);
    return value === "1" ? true : value === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An on/off choice stored per device. `fromUrl` (kiosk) wins for this page without being
 * stored; then the stored choice; `fallback` until the device has made one. Switching stores
 * the new state.
 */
export function useStoredFlag(
  key: string,
  fallback: boolean,
  fromUrl: boolean | undefined,
): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => fromUrl ?? readStored(key) ?? fallback);
  const choose = (next: boolean) => {
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // not stored; still applies to this page
    }
    setOn(next);
  };
  return [on, choose];
}
