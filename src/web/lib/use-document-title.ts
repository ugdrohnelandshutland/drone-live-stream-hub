import { useEffect } from "react";
import { t } from "../strings";

/** Sets the browser tab title, e.g. "Drohne 1 – Drohnen-Livestream". */
export function useDocumentTitle(prefix?: string): void {
  useEffect(() => {
    document.title = prefix ? `${prefix} – ${t.appTitle}` : t.appTitle;
  }, [prefix]);
}
