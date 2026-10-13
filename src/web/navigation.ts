/**
 * Client-side navigation between the overview and a drone (ADR 0007): the History API instead
 * of page loads, so the drone's player and WebSocket survive the switch. Everything else (the
 * diagnostics page, links opened in a new tab) stays a normal page load.
 */
import { useSyncExternalStore, type MouseEvent } from "react";
import { parseRoute, type Route } from "./routes";

const NAVIGATE_EVENT = "dlsh:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/** The current route; changes on navigate() and on the browser's back/forward. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}

export function navigate(href: string): void {
  if (href === location.pathname) return;
  history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** onClick for <a href>: plain clicks navigate in place, modified clicks behave as usual. */
export function navigateOnClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href") ?? "/");
}
