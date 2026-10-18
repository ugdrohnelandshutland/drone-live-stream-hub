/** The few icons the UI needs, inline (offline, no icon font). Decorative: buttons carry text. */

import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function BackIcon() {
  return (
    <Svg>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function CameraIcon() {
  return (
    <Svg>
      <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  );
}

export function RecordIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StopIcon() {
  return (
    <Svg>
      <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function FullscreenIcon({ exit = false }: { exit?: boolean }) {
  return (
    <Svg>
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </Svg>
  );
}

export function SunIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </Svg>
  );
}

export function MoonIcon() {
  return (
    <Svg>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </Svg>
  );
}
