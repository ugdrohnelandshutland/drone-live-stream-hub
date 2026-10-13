/**
 * "Datensparen": overview tiles get only keyframes (about one picture per second) instead of
 * the full stream; the single view always gets the full stream (ADR 0009). On until the device
 * makes a choice, which is then stored; `?datensparen=0|1` fixes it for one page (kiosk).
 */
import { useStoredFlag } from "../../lib/use-stored-flag";

const STORAGE_KEY = "dlsh.dataSaver";

export function useDataSaver(fromUrl: boolean | undefined): [boolean, (on: boolean) => void] {
  return useStoredFlag(STORAGE_KEY, true, fromUrl);
}
