import type { StatusView } from "../player/player-status";
import "./picture-overlay.css";

/**
 * Covers the picture while there is none to show. "No signal" gets a diagonal hatch, so a dead
 * monitor is recognisable from across the room — without colour and without reading. A hint
 * instead sits at the bottom edge and leaves the (last) picture visible.
 */
export function PictureOverlay({ view }: { view: StatusView }) {
  const { overlay, hint } = view;
  return (
    <>
      <div className="picture-overlay" data-tone={view.tone} data-visible={overlay ? true : undefined}>
        {overlay && (
          <div className="picture-overlay-text">
            <span className="picture-overlay-title">{overlay.title}</span>
            {overlay.detail && <span className="picture-overlay-detail">{overlay.detail}</span>}
          </div>
        )}
      </div>
      {hint && (
        <div className="picture-hint" data-tone={view.tone} role="status">
          <span className="picture-hint-title">{hint.title}</span>
          {hint.detail && <span className="picture-hint-detail">{hint.detail}</span>}
        </div>
      )}
    </>
  );
}
