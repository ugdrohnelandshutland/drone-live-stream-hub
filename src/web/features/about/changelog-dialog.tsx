import { Dialog } from "../../components/dialog";
import { formatDate } from "../../lib/format";
import { t } from "../../strings";
import { changelog } from "./changelog";
import "./about.css";

/** "Neuigkeiten": what changed per release, newest first; the running one is marked. */
export function ChangelogDialog({ current, onClose }: { current: string; onClose: () => void }) {
  return (
    <Dialog title={t.about.changelogTitle} onClose={onClose}>
      <div className="about-sections">
        {changelog.map((release) => (
          <section key={release.version} className="about-section">
            <h3>
              {t.about.version(release.version)}
              <span className="about-quiet"> · {formatDate(release.date)}</span>
              {release.version === current && <span className="about-current">{t.about.installed}</span>}
            </h3>
            <ul className="about-list">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
