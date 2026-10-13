import type { PlayerStatus } from "../player/live-player";
import type { StatusView } from "../player/player-status";
import "./status-badge.css";

interface StatusBadgeProps {
  view: StatusView;
  /** Raw player status as data-state (scripts/measure-latency.ts reads `.status[data-state]`). */
  state?: PlayerStatus | "offline";
  /** Mark only, label kept for screen readers (narrow strips). */
  compact?: boolean;
}

/** Status word with a mark whose shape differs per tone, so it never relies on colour alone. */
export function StatusBadge({ view, state, compact = false }: StatusBadgeProps) {
  return (
    <span className="status" data-tone={view.tone} data-state={state} data-compact={compact || undefined}>
      <span className="status-mark" aria-hidden="true" />
      <span className="status-label">{view.label}</span>
    </span>
  );
}
