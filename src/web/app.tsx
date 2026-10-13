import { DiagnosticsPage } from "./features/diagnostics/diagnostics-page";
import { LivePage } from "./features/live/live-page";
import { useRoute } from "./navigation";
import type { PageOptions } from "./routes";

/**
 * Overview and single view are one page (switching keeps the picture running, ADR 0007);
 * the diagnostics page is separate.
 */
export function App({ options }: { options: PageOptions }) {
  const route = useRoute();
  if (route.page === "diagnostics") return <DiagnosticsPage />;
  return <LivePage focusId={route.page === "drone" ? route.droneId : undefined} options={options} />;
}
