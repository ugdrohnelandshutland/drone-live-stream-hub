import type { ReactNode } from "react";
import "./notice.css";

/** Centred message for a page without content (loading, nothing configured). */
export function Notice({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="notice">
      <p className="notice-title">{title}</p>
      {detail && <p className="notice-detail">{detail}</p>}
      {children}
    </div>
  );
}
