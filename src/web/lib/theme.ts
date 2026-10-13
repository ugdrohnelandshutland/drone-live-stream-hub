/**
 * Day/night colour scheme. Without a choice the device setting applies (prefers-color-scheme,
 * see styles/tokens.css); a choice is stored per device, or fixed by `?theme=` for the kiosk.
 * index.html applies the stored choice before the first paint; keep STORAGE_KEY in sync.
 */
import { useState } from "react";
import type { ThemeChoice } from "../routes";

export const STORAGE_KEY = "dlsh.theme";

export function applyTheme(theme: ThemeChoice | undefined): void {
  if (theme) document.documentElement.dataset["theme"] = theme;
  else delete document.documentElement.dataset["theme"];
}

/** The scheme currently on screen, including the device default. */
export function effectiveTheme(): ThemeChoice {
  const chosen = document.documentElement.dataset["theme"];
  if (chosen === "day" || chosen === "night") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function useTheme(): [ThemeChoice, (theme: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(effectiveTheme);
  const choose = (next: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not stored; still applies to this page
    }
    applyTheme(next);
    setTheme(next);
  };
  return [theme, choose];
}
