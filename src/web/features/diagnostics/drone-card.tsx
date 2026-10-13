import type { DroneDiagnostics, JsonValue } from "../../../shared/diagnostics";
import { StatusBadge } from "../../components/status-badge";
import type { StatusView } from "../../player/player-status";
import { t } from "../../strings";
import { findings, SIMULATOR_PROFILE } from "./checks";

export function time(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("de-DE");
}

export function dateTime(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("de-DE");
}

function num(value: number | null | undefined, unit = ""): string {
  return value === null || value === undefined ? "–" : `${value.toLocaleString("de-DE")}${unit}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

function json(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** label, value and (optionally) what the simulator sends */
type Row = readonly [label: string, value: string, expected?: string];

function Rows({ rows }: { rows: readonly Row[] }) {
  return rows.map(([label, value, expected]) => (
    <tr key={label}>
      <th>{label}</th>
      <td>{value}</td>
      {expected !== undefined && <td className="expected">{expected}</td>}
    </tr>
  ));
}

function ObjectRows({ object }: { object: Record<string, JsonValue> | null }) {
  if (!object || Object.keys(object).length === 0) {
    return (
      <tr>
        <td colSpan={2} className="quiet">
          keine
        </td>
      </tr>
    );
  }
  return <Rows rows={Object.entries(object).map(([k, v]): Row => [k, json(v)])} />;
}

function StreamTable({ drone }: { drone: DroneDiagnostics }) {
  const v = drone.video;
  const m = drone.measurements;
  const key = m?.keyframeIntervalMs;
  const p = SIMULATOR_PROFILE;
  const rows: Row[] = [
    ["Codec", v ? `${v.codec.toUpperCase()}${v.codecString ? ` (${v.codecString})` : ""}` : "–", p.codec],
    ["Profil / Level", v?.profile ? `${v.profile} / ${v.level ?? "–"}` : "–", p.profile],
    ["Auflösung", v?.width && v.height ? `${v.width}×${v.height}` : "–", p.resolutions],
    ["Bildrate", num(m?.fps, " fps"), p.fps],
    ["Bitrate", m?.kbps == null ? "–" : `${(m.kbps / 1000).toLocaleString("de-DE")} Mbit/s`, p.bitrate],
    [
      "Keyframe-Abstand (Ø / min / max)",
      key ? `${num(key.avg)} / ${num(key.min)} / ${num(key.max)} ms` : "–",
      p.keyframeInterval,
    ],
    [
      "Keyframe-Größe Ø",
      m?.avgKeyframeBytes == null ? "–" : `${Math.round(m.avgKeyframeBytes / 1024)} KB`,
      "",
    ],
    ["B-Frames", m ? (m.bFrames ? "ja" : "nein") : "–", p.bFrames],
    [`Größte Empfangslücke (${num(m?.windowSec)} s)`, num(m?.maxArrivalGapMs, " ms"), p.arrivalGap],
    [
      "Tonspur",
      drone.totals?.audioTags ? `${drone.totals.audioCodec ?? "ja"} (verworfen)` : "keine",
      p.audio,
    ],
  ];
  return (
    <table className="diag-table">
      <thead>
        <tr>
          <th />
          <th>Empfangen</th>
          <th>Simulator</th>
        </tr>
      </thead>
      <tbody>
        <Rows rows={rows} />
      </tbody>
    </table>
  );
}

/** Everything known about one drone's stream, compared with the simulator profile. */
export function DroneCard({ drone }: { drone: DroneDiagnostics }) {
  const state: StatusView = {
    tone: drone.live ? "live" : "idle",
    label: drone.live ? "Live" : drone.publisher ? "Offline" : "Noch nie verbunden",
    overlay: undefined,
    immediate: true,
  };
  const list = findings(drone);
  const { totals, delivery, publisher } = drone;
  const { flashVer, tcUrl, ...otherConnect } = publisher?.connect ?? {};

  return (
    <article className="diag-card" data-state={drone.live ? "live" : "offline"}>
      <header className="diag-card-header">
        <h2>
          {drone.name} <span className="quiet">{drone.id}</span>
        </h2>
        <StatusBadge view={state} />
      </header>
      {list.length > 0 ? (
        <ul className="findings">
          {list.map((f) => (
            <li key={f.text} className={f.level}>
              {f.text}
            </li>
          ))}
        </ul>
      ) : (
        publisher && <p className="ok">{t.diagnostics.noFindings}</p>
      )}
      {publisher && (
        <div className="diag-grid">
          <section>
            <h3>Stream</h3>
            <StreamTable drone={drone} />
          </section>
          <section>
            <h3>Verbindung</h3>
            <table className="diag-table">
              <tbody>
                <Rows
                  rows={[
                    ["Fernsteuerung", publisher.remoteAddress],
                    ["Verbunden seit", dateTime(publisher.startedAt)],
                    ["Beendet", dateTime(publisher.endedAt)],
                    ["Sender (flashVer)", flashVer === undefined ? "–" : json(flashVer)],
                    ["tcUrl", tcUrl === undefined ? "–" : json(tcUrl)],
                  ]}
                />
                <ObjectRows object={otherConnect} />
              </tbody>
            </table>
            <h3>Zähler</h3>
            <table className="diag-table">
              <tbody>
                <Rows
                  rows={[
                    ["Bilder / Keyframes", totals ? `${num(totals.frames)} / ${num(totals.keyframes)}` : "–"],
                    ["Daten", totals ? megabytes(totals.bytes) : "–"],
                    ["Sequence Header", num(totals?.sequenceHeaders)],
                    ["Zeitstempel-Sprünge", num(totals?.timestampJumps)],
                  ]}
                />
              </tbody>
            </table>
            <h3>Auslieferung</h3>
            <table className="diag-table">
              <tbody>
                <Rows
                  rows={[
                    ["Zuschauer", num(delivery?.viewers)],
                    ["Verworfene Bilder (langsame Zuschauer)", num(delivery?.droppedTags)],
                    ["Getrennte langsame Zuschauer", num(delivery?.slowViewerClosures)],
                    ["Zwischenspeicher", delivery ? megabytes(delivery.cacheBytes) : "–"],
                  ]}
                />
              </tbody>
            </table>
          </section>
          <section>
            <h3>Metadaten (onMetaData)</h3>
            <table className="diag-table">
              <tbody>
                <ObjectRows object={drone.metadata} />
              </tbody>
            </table>
          </section>
          <section>
            <h3>Ereignisse</h3>
            <ol className="events">
              {drone.events.map((e, i) => (
                <li key={i}>
                  <time>{time(e.at)}</time> {e.text}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </article>
  );
}
