import type { StatusView } from "../player/player-status";
import "./picture-overlay.css";

/**
 * Covers the picture while there is none to show. "No signal" gets a diagonal hatch, so a dead
 * monitor is recognisable from across the room — without colour and without reading.
 */
export function PictureOverlay({ view }: { view: StatusView }) {
  const overlay = view.overlay;
  return (
    <div className="picture-overlay" data-tone={view.tone} data-visible={overlay ? true : undefined}>
      {overlay && (
        <div className="picture-overlay-text">
          <span className="picture-overlay-title">{overlay.title}</span>
          {overlay.detail && <span className="picture-overlay-detail">{overlay.detail}</span>}
        </div>
      )}
    </div>
  );
}
