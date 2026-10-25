import { useEffect, useEffectEvent, useState } from "react";

export interface Polled<T> {
  data: T | undefined;
  /** The last request failed; `data` still holds the last good value. */
  failed: boolean;
}

/**
 * Fetches every `intervalMs` while `enabled`, counted from the end of the previous request, so
 * requests never overlap on weak Wi-Fi. Pauses while the tab is hidden.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled: boolean,
  /** A new value starts over with an immediate request (e.g. after an action). */
  restartKey?: unknown,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: undefined, failed: false });
  const fetchNow = useEffectEvent(fetcher);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;

    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const data = await fetchNow(controller.signal);
          setState({ data, failed: false });
        } catch {
          if (controller.signal.aborted) return;
          setState((prev) => ({ ...prev, failed: true }));
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void run(), intervalMs);
    };
    void run();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [intervalMs, enabled, restartKey]);

  return state;
}
