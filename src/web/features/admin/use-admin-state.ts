import { useRef, useState } from "react";
import { ADMIN_EVENT_LIMIT, type AdminEvent, type AdminState } from "../../../shared/admin";
import { usePolling } from "../../lib/use-polling";
import { apiGet, HttpError } from "../../service/http";

export type AdminView =
  | { kind: "loading" }
  /** No adminPin in the config. */
  | { kind: "off" }
  | { kind: "login" }
  | { kind: "ok"; state: AdminState; events: readonly AdminEvent[] };

const REFRESH_MS = 1000;

/**
 * Polls `/api/admin/state` every second (one admin page, a handful of devices: simpler than a
 * second SSE stream) and keeps the event log, asking only for events it does not have yet.
 * `refresh()` polls again at once, after an action or the login.
 */
export function useAdminState(): { view: AdminView; failed: boolean; refresh: () => void } {
  const events = useRef<{ epoch: string; list: AdminEvent[] }>({ epoch: "", list: [] });
  const [generation, setGeneration] = useState(0);

  const fetchState = async (signal: AbortSignal): Promise<AdminView> => {
    const { epoch, list: known } = events.current;
    const last = known.at(-1)?.seq ?? 0;
    try {
      // With another epoch (service restarted) the server sends its whole log.
      const query = `eventsAfter=${last}&epoch=${encodeURIComponent(epoch)}`;
      const state = await apiGet<AdminState>(`/api/admin/state?${query}`, { signal });
      const kept = state.eventsEpoch === epoch ? known : [];
      const newer = state.events.filter((e) => e.seq > (kept.at(-1)?.seq ?? 0));
      const list = [...kept, ...newer].slice(-ADMIN_EVENT_LIMIT);
      events.current = { epoch: state.eventsEpoch, list };
      return { kind: "ok", state, events: list };
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return { kind: "login" };
      if (err instanceof HttpError && err.status === 404) return { kind: "off" };
      throw err;
    }
  };

  // A new generation restarts the polling loop, so the next request goes out right away.
  const { data, failed } = usePolling(fetchState, REFRESH_MS, true, generation);
  return { view: data ?? { kind: "loading" }, failed, refresh: () => setGeneration((g) => g + 1) };
}
