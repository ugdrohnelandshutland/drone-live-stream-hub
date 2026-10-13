import { useEffect, useState } from "react";
import type { ServiceInfo } from "../../../shared/api";
import type { ThirdPartyNotices, ThirdPartyPackage } from "../../../shared/third-party";
import { Dialog } from "../../components/dialog";
import { buildFacts } from "../../lib/format";
import { apiGet } from "../../service/http";
import { t } from "../../strings";
import "./about.css";

type Notices = ThirdPartyNotices | "loading" | "failed";

/** Written next to the web UI by the build (scripts/lib/third-party.ts). */
function useThirdPartyNotices(): Notices {
  const [notices, setNotices] = useState<Notices>("loading");
  useEffect(() => {
    let active = true;
    apiGet<ThirdPartyNotices>("/third-party.json").then(
      (result) => active && setNotices(result),
      () => active && setNotices("failed"),
    );
    return () => {
      active = false;
    };
  }, []);
  return notices;
}

/** "Über": publisher, the running release and the open-source licenses. */
export function AboutDialog({ info, onClose }: { info: ServiceInfo; onClose: () => void }) {
  const notices = useThirdPartyNotices();
  return (
    <Dialog title={t.about.aboutTitle} onClose={onClose}>
      <div className="about-sections">
        <section className="about-section">
          <h3>{info.name}</h3>
          <p className="about-quiet">{[t.about.version(info.version), ...buildFacts(info)].join(" · ")}</p>
        </section>
        <section className="about-section">
          <h3>{t.about.publisherTitle}</h3>
          <address className="about-address">
            {t.about.publisher.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
        </section>
        <section className="about-section">
          <h3>{t.about.licensesTitle}</h3>
          <p className="about-quiet">{t.about.licensesIntro}</p>
          <Licenses notices={notices} />
          <p className="about-quiet">{t.about.licensesWindows}</p>
        </section>
      </div>
    </Dialog>
  );
}

function Licenses({ notices }: { notices: Notices }) {
  if (notices === "loading") return <p>{t.about.licensesLoading}</p>;
  if (notices === "failed") return <p>{t.about.licensesFailed}</p>;
  // A package used by both bundles is listed once.
  const byKey = new Map<string, ThirdPartyPackage>();
  for (const pkg of [...notices.web, ...notices.service]) byKey.set(`${pkg.name}@${pkg.version}`, pkg);
  const packages = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (packages.length === 0) return <p>{t.about.licensesDev}</p>;
  return (
    <ul className="about-licenses">
      {packages.map((pkg) => (
        <li key={`${pkg.name}@${pkg.version}`}>
          <details>
            <summary>
              {pkg.name} <span className="about-quiet">{pkg.version}</span>
              <span className="about-license">{pkg.license}</span>
            </summary>
            <pre>{pkg.licenseText || t.about.noLicenseText}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}
