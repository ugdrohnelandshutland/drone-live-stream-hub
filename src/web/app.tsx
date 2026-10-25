import { AdminPage } from "./features/admin/admin-page";
import { DiagnosticsPage } from "./features/diagnostics/diagnostics-page";
import { LivePage } from "./features/live/live-page";
import { useRoute } from "./navigation";
import type { PageOptions } from "./routes";

/**
 * Overview and single view are one page (switching keeps the picture running, ADR 0007);
 * the diagnostics and admin pages are separate.
 */
export function App({ options }: { options: PageOptions }) {
  const route = useRoute();
  if (route.page === "diagnostics") return <DiagnosticsPage />;
  if (route.page === "admin") return <AdminPage />;
  return <LivePage focusId={route.page === "drone" ? route.droneId : undefined} options={options} />;
}
