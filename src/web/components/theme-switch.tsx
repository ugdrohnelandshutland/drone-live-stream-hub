import { useTheme } from "../lib/theme";
import { t } from "../strings";
import { MoonIcon, SunIcon } from "./icons";
import "./theme-switch.css";

/**
 * Day/night switch: sun left, moon right; the thumb carries the icon of the current scheme and
 * slides to the other side when tapped. Stored per device.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const night = theme === "night";
  return (
    <button
      type="button"
      role="switch"
      className="theme-switch"
      aria-checked={night}
      aria-label={t.theme.label}
      title={night ? t.theme.toDay : t.theme.toNight}
      onClick={() => setTheme(night ? "day" : "night")}
    >
      {/* Both icons faint in the track; the thumb covers the current one with its own. */}
      <span className="theme-switch-track" aria-hidden="true">
        <SunIcon />
        <MoonIcon />
        <span className="theme-switch-thumb">{night ? <MoonIcon /> : <SunIcon />}</span>
      </span>
    </button>
  );
}
