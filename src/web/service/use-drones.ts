import { createContext, useContext, useSyncExternalStore } from "react";
import type { DroneStatus } from "../../shared/api";
import type { DronesSnapshot, DronesStore } from "./drones-store";

/** One store per page, created in main.tsx; tests pass their own. */
export const DronesContext = createContext<DronesStore | undefined>(undefined);

function useStore(): DronesStore {
  const store = useContext(DronesContext);
  if (!store) throw new Error("DronesContext missing");
  return store;
}

export function useDrones(): DronesSnapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export interface DroneLookup {
  /** Undefined while loading or if the id is not configured. */
  drone: DroneStatus | undefined;
  /** 1-based position in the config: the number people use on the radio ("Bild 2"). */
  slot: number | undefined;
  /** True once the list is known and the id is not in it. */
  unknown: boolean;
}

export function useDrone(droneId: string): DroneLookup {
  const { drones } = useDrones();
  const index = drones?.findIndex((d) => d.id === droneId) ?? -1;
  return {
    drone: drones?.[index],
    slot: index >= 0 ? index + 1 : undefined,
    unknown: drones !== undefined && index < 0,
  };
}
