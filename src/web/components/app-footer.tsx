import { useState } from "react";
import { AboutDialog } from "../features/about/about-dialog";
import { ChangelogDialog } from "../features/about/changelog-dialog";
import { buildFacts } from "../lib/format";
import { useServiceInfo } from "../service/use-service-info";
import { t } from "../strings";
import "./app-footer.css";

/**
 * Which release is running; stays empty if /api/info is unreachable. The name opens "Über",
 * the version "Neuigkeiten" — except on the kiosk, which has no dialogs to close again.
 */
export function AppFooter({ kiosk }: { kiosk: boolean }) {
  const info = useServiceInfo();
  const [open, setOpen] = useState<"about" | "changelog">();
  if (!info) return <footer className="app-footer" />;

  const version = t.about.version(info.version);
  return (
    <footer className="app-footer">
      {kiosk ? (
        <>
          <span>{info.name}</span>
          <span>{version}</span>
        </>
      ) : (
        <>
          <button
            type="button"
            className="app-footer-link"
            title={t.about.openAbout}
            onClick={() => setOpen("about")}
          >
            {info.name}
          </button>
          <button
            type="button"
            className="app-footer-link"
            title={t.about.openChangelog}
            onClick={() => setOpen("changelog")}
          >
            {version}
          </button>
        </>
      )}
      {buildFacts(info).map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
      {open === "about" && <AboutDialog info={info} onClose={() => setOpen(undefined)} />}
      {open === "changelog" && <ChangelogDialog current={info.version} onClose={() => setOpen(undefined)} />}
    </footer>
  );
}
