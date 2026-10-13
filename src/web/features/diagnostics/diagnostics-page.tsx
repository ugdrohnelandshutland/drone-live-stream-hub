import { useState } from "react";
import type { DiagnosticsResponse } from "../../../shared/diagnostics";
import { apiGet } from "../../service/http";
import { Banner } from "../../components/banner";
import { Notice } from "../../components/notice";
import { downloadBlob } from "../../lib/download";
import { usePolling } from "../../lib/use-polling";
import { useDocumentTitle } from "../../lib/use-document-title";
import { t } from "../../strings";
import { dateTime, DroneCard, time } from "./drone-card";
import "./diagnostics.css";

const REFRESH_MS = 1000;

const fetchDiagnostics = (signal: AbortSignal) => apiGet<DiagnosticsResponse>("/api/diagnostics", { signal });

/**
 * `/diagnose` — what each RC actually sends, compared with the simulator profile. For tests
 * with real hardware; not linked from the UI.
 */
export function DiagnosticsPage() {
  useDocumentTitle(t.diagnostics.title);
  const [paused, setPaused] = useState(false);
  const { data, failed } = usePolling(fetchDiagnostics, REFRESH_MS, !paused);
  const canCopy = window.isSecureContext && navigator.clipboard !== undefined;

  const asJson = () => JSON.stringify(data, null, 2);
  const save = () => {
    if (!data) return;
    const fileName = `diagnose_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    downloadBlob(new Blob([asJson()], { type: "application/json" }), fileName);
  };
  const copy = () => {
    if (data) void navigator.clipboard.writeText(asJson());
  };

  return (
    <main className="page diag">
      <header className="diag-header">
        <h1>{t.diagnostics.title}</h1>
        {data && (
          <span className="quiet diag-meta">
            {data.service.name} {data.service.version}, Stand {time(data.generatedAt)}
          </span>
        )}
        <span className="diag-actions">
          <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? t.diagnostics.resume : t.diagnostics.pause}
          </button>
          {canCopy && (
            <button type="button" onClick={copy} disabled={!data}>
              {t.diagnostics.copy}
            </button>
          )}
          <button type="button" onClick={save} disabled={!data}>
            {t.diagnostics.save}
          </button>
        </span>
      </header>
      <Banner show={failed}>{t.diagnostics.unreachable}</Banner>
      {!data && !failed && <Notice title={t.loading} />}
      {data && data.rejected.length > 0 && (
        <section className="diag-rejected">
          <h2>{t.diagnostics.rejectedTitle}</h2>
          <p className="quiet">{t.diagnostics.rejectedDetail}</p>
          <ol className="events">
            {data.rejected.map((r) => (
              <li key={`${r.streamKey}@${r.remoteHost}`}>
                <time>{dateTime(r.lastAt)}</time> „{r.streamKey}“ von {r.remoteHost} –{" "}
                {r.attempts === 1 ? "1 Versuch" : `${r.attempts} Versuche seit ${time(r.firstAt)}`}
              </li>
            ))}
          </ol>
        </section>
      )}
      {data?.drones.map((d) => (
        <DroneCard key={d.id} drone={d} />
      ))}
    </main>
  );
}
