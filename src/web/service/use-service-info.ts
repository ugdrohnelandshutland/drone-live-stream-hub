import { useEffect, useState } from "react";
import type { ServiceInfo } from "../../shared/api";
import { apiGet } from "./http";

const CHECK_MS = 60_000;

/**
 * Release information of the running service; undefined while loading or if it failed.
 * Reloads the page when the service reports a different release, so a kiosk that runs for
 * days picks up an update by itself.
 */
export function useServiceInfo(): ServiceInfo | undefined {
  const [info, setInfo] = useState<ServiceInfo>();

  useEffect(() => {
    let active = true;
    let first: ServiceInfo | undefined;
    const check = async () => {
      try {
        const current = await apiGet<ServiceInfo>("/api/info");
        if (!active) return;
        if (!first) {
          first = current;
          setInfo(current);
        } else if (current.version !== first.version || current.commit !== first.commit) {
          location.reload();
        }
      } catch {
        // Service restarting or Wi-Fi gone: try again at the next check.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return info;
}
