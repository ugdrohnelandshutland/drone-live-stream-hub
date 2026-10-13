import type { ReactNode } from "react";
import "./banner.css";

/** A full-width notice above the content, for conditions that affect the whole page. */
export function Banner({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="banner" role="status">
      {children}
    </div>
  );
}
