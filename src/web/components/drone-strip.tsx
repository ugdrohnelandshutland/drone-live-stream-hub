import type { ReactNode } from "react";
import type { PlayerStatus } from "../player/live-player";
import type { StatusView } from "../player/player-status";
import { StatusBadge } from "./status-badge";
import "./drone-strip.css";

interface DroneStripProps {
  /** Position in the config; the number people say on the radio. */
  slot: number | undefined;
  name: string;
  view: StatusView;
  state?: PlayerStatus | "offline";
  /** Secondary facts, shown in a quiet line where there is room. */
  facts?: readonly string[];
  /** Before the number, e.g. the back link. */
  leading?: ReactNode;
  /** At the end, e.g. buttons. */
  actions?: ReactNode;
  /** Slid out of view (fullscreen): not reachable by keyboard or screen reader meanwhile. */
  hidden?: boolean;
}

/**
 * The label strip under (overview) or above (single view) a picture, like the under-monitor
 * display of a monitor wall: number, name and status, coloured by status.
 */
export function DroneStrip({ slot, name, view, state, facts, leading, actions, hidden }: DroneStripProps) {
  return (
    <div className="strip" data-tone={view.tone} data-hidden={hidden || undefined} inert={hidden}>
      {leading}
      <span className="strip-slot" aria-hidden={slot === undefined}>
        {slot ?? "–"}
      </span>
      <span className="strip-text">
        <span className="strip-name">{name}</span>
        {facts && facts.length > 0 && (
          <span className="strip-facts">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
        )}
      </span>
      <StatusBadge view={view} {...(state ? { state } : {})} />
      {actions && <span className="strip-actions">{actions}</span>}
    </div>
  );
}
