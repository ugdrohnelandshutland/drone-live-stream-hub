import { useState } from "react";
import {
  CAPTURE_SECONDS,
  type AdminCapture,
  type AdminCaptureError,
  type AdminDroneLoad,
} from "../../../shared/admin";
import { apiPost, HttpError } from "../../service/http";
import { t } from "../../strings";
import { dayAndTime, formatFileSize } from "./admin-format";

/**
 * Raw stream captures: start one per live drone, download the FLV files. For analysing what a
 * real RC sends; the stream itself is not touched.
 */
export function CapturePanel(props: {
  captures: readonly AdminCapture[] | null;
  drones: readonly AdminDroneLoad[];
  onChanged: () => void;
}) {
  const { captures, drones, onChanged } = props;
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState<string>();
  const droneName = (id: string) => drones.find((d) => d.id === id)?.name ?? id;

  const start = (droneId: string) => {
    setStarting(droneId);
    apiPost("/api/admin/captures", { droneId })
      .then(() => setError(undefined))
      .catch((err: unknown) => {
        const body = err instanceof HttpError ? (err.body as AdminCaptureError | undefined) : undefined;
        setError(
          body?.error === "offline"
            ? t.admin.captureOffline
            : body?.error === "busy"
              ? t.admin.captureBusy
              : t.admin.captureFailed,
        );
      })
      .finally(() => {
        setStarting(undefined);
        onChanged();
      });
  };

  return (
    <section className="admin-section" aria-labelledby="admin-captures">
      <h2 id="admin-captures">{t.admin.capturesTitle}</h2>
      {captures === null ? (
        <p className="quiet">{t.admin.capturesOff}</p>
      ) : (
        <>
          <p className="quiet">{t.admin.capturesDetail(CAPTURE_SECONDS)}</p>
          <div className="admin-capture-actions">
            {drones.map((drone) => {
              const running = captures.some((c) => c.droneId === drone.id && c.recording);
              return (
                <button
                  key={drone.id}
                  type="button"
                  disabled={!drone.live || running || starting === drone.id}
                  onClick={() => start(drone.id)}
                >
                  {drone.name}: {running ? t.admin.captureRunning : t.admin.capture(CAPTURE_SECONDS)}
                </button>
              );
            })}
          </div>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          {captures.length === 0 ? (
            <p className="quiet">{t.admin.noCaptures}</p>
          ) : (
            <table className="admin-table">
              <tbody>
                {captures.map((capture) => (
                  <tr key={capture.file}>
                    <th scope="row">{droneName(capture.droneId)}</th>
                    <td>{dayAndTime(capture.startedAt)}</td>
                    <td>{formatFileSize(capture.bytes)}</td>
                    <td>
                      {capture.recording ? (
                        t.admin.captureRunning
                      ) : (
                        <>
                          <a href={`/api/admin/captures/${encodeURIComponent(capture.file)}`} download>
                            {t.admin.download}
                          </a>
                          {capture.cutShort && (
                            <span className="quiet"> · {t.admin.captureCutShort[capture.cutShort]}</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
